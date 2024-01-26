'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const json2iob = require('json2iob');
// const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { sep } = require('path');
const { tmpdir } = require('os');
// @ts-ignore
const axios = require('axios').default;
// @ts-ignore
const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);

class Frigate extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'frigate',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.requestClient = axios.create({
      withCredentials: true,

      headers: {
        'User-Agent': 'ioBroker.frigate',
        accept: '*/*',
      },

      timeout: 3 * 60 * 1000, //3min client timeout
    });
    this.clientId = 'frigate';
    this.json2iob = new json2iob(this);
    this.tmpDir = tmpdir();
    this.notificationMinScore = null;
    this.firstStart = true;
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.setState('info.connection', false, true);
    this.subscribeStates('*_state');
    if (!this.config.friurl) {
      this.log.warn('No Frigate url set');
    }
    try {
      if (this.config.notificationMinScore) {
        this.notificationMinScore = this.config.notificationMinScore;
        if (this.notificationMinScore > 1) {
          this.notificationMinScore = this.notificationMinScore / 100;
          this.log.info('Notification min score is higher than 1. Recalculated to ' + this.notificationMinScore);
        }
      }
    } catch (error) {
      this.log.error(error);
    }

    if (this.config.notificationEventClipWaitTime < 1) {
      this.log.warn('Notification clip wait time is lower than 1. Set to 1');
      this.config.notificationEventClipWaitTime = 1;
    }
    if (this.config.notificationExcludeList) {
      this.notificationExcludeArray = this.config.notificationExcludeList.replace(/ /g, '').split(',');
    }

    await this.cleanOldObjects();
    await this.extendObjectAsync('events', {
      type: 'channel',
      common: {
        name: 'Events current and history',
      },
      native: {},
    });
    await this.extendObjectAsync('remote', {
      type: 'channel',
      common: {
        name: 'Control adapter',
      },
      native: {},
    });
    await this.extendObjectAsync('remote.pauseNotifications', {
      type: 'state',
      common: {
        name: 'Pause All notifications',
        type: 'boolean',
        role: 'switch',
        def: false,
        read: true,
        write: true,
      },
      native: {},
    });
    await this.initMqtt();
  }
  async cleanOldObjects(vin) {
    const remoteState = await this.getObjectAsync('lastidurl');
    if (remoteState) {
      this.log.info('clean old states ' + vin);
      await this.delObjectAsync('', { recursive: true });
    }
    await this.setObjectNotExistsAsync('info.connection', {
      type: 'state',
      common: {
        name: 'connection',
        type: 'boolean',
        role: 'indicator.connected',
        read: true,
        write: false,
      },
      native: {},
    });
  }
  async initMqtt() {
    server
      .listen(this.config.mqttPort, () => {
        this.log.info('MQTT server started and listening on port ' + this.config.mqttPort);
        this.log.info("Please enter host: '" + this.host + "' and port: '" + this.config.mqttPort + "' in frigate config");
        this.log.info("If you don't see a new client connected, please restart frigate and adapter.");
      })
      .once('error', (err) => {
        this.log.error('MQTT server error: ' + err);
        this.log.error(
          'Please check if port ' +
            this.config.mqttPort +
            ' is already in use. Use a different port in instance and frigate settings or restart ioBroker.',
        );
      });
    aedes.on('client', (client) => {
      this.log.info('New client: ' + client.id);
      this.log.info('Filter for message from client: ' + client.id);
      this.clientId = client.id;
      this.setState('info.connection', true, true);
      this.fetchEventHistory();
    });
    aedes.on('clientDisconnect', (client) => {
      this.log.info('client disconnected ' + client.id);
      this.setState('info.connection', false, true);
      this.setState('available', 'offline', true);
    });
    aedes.on('publish', async (packet, client) => {
      if (packet.payload) {
        this.log.debug('publish' + ' ' + packet.topic + ' ' + packet.payload.toString());
      } else {
        this.log.debug(JSON.stringify(packet));
      }
      if (client && client.id === this.clientId) {
        try {
          let pathArray = packet.topic.split('/');
          //remove first element
          pathArray.shift();
          let data = packet.payload.toString();
          let write = false;
          try {
            data = JSON.parse(data);
          } catch (error) {
            //do nothing
          }
          //convert snapshot jpg to base64 with data url
          if (pathArray[pathArray.length - 1] === 'snapshot') {
            data = 'data:image/jpeg;base64,' + packet.payload.toString('base64');
            if (this.config.notificationCamera) {
              this.sendNotification({
                source: pathArray[0],
                type: pathArray[1],
                state: pathArray[pathArray.length - 1],
                image: packet.payload.toString('base64'),
              });
            }
          }
          //if last path state then make it writable
          if (pathArray[pathArray.length - 1] === 'state') {
            write = true;
          }
          // events topic trigger history fetching
          if (pathArray[pathArray.length - 1] === 'events') {
            this.prepareEventNotification(data);

            this.fetchEventHistory();
          }
          // join every path item except the first one to create a flat hierarchy
          if (pathArray[0] !== 'stats' && pathArray[0] !== 'events' && pathArray[0] !== 'available') {
            const cameraId = pathArray.shift();
            pathArray = [cameraId, pathArray.join('_')];
          }

          //create devices state for cameras
          if (pathArray[0] === 'stats') {
            delete data['cpu_usages'];
            if (this.firstStart) {
              this.log.debug('first start create devices');
              if (data.cameras) {
                for (const key in data.cameras) {
                  await this.extendObjectAsync(key, {
                    type: 'device',
                    common: {
                      name: 'Camera ' + key,
                    },
                    native: {},
                  });
                  await this.extendObjectAsync(key + '.remote', {
                    type: 'channel',
                    common: {
                      name: 'Control camera',
                    },
                    native: {},
                  });
                  await this.extendObjectAsync(key + '.remote.pauseNotifications', {
                    type: 'state',
                    common: {
                      name: 'Pause Camera notifications',
                      type: 'boolean',
                      role: 'switch',
                      def: false,
                      read: true,
                      write: true,
                    },
                    native: {},
                  });
                  await this.extendObjectAsync(key + '.remote.notificationText', {
                    type: 'state',
                    common: {
                      name: 'Overwrite the notification text',
                      type: 'string',
                      role: 'text',
                      def: '',
                      read: true,
                      write: true,
                    },
                    native: {},
                  });
                  await this.extendObjectAsync(key + '.remote.notificationMinScore', {
                    type: 'state',
                    common: {
                      name: 'Overwrite notification min score',
                      type: 'number',
                      role: 'value',
                      def: 0,
                      read: true,
                      write: true,
                    },
                    native: {},
                  });
                }

                this.firstStart = false;
              }
            }
          }
          //parse json to iobroker states
          this.json2iob.parse(pathArray.join('.'), data, { write: write });
        } catch (error) {
          this.log.warn(error);
        }
      }
    });
    aedes.on('subscribe', (subscriptions, client) => {
      this.log.info(
        'MQTT client \x1b[32m' +
          (client ? client.id : client) +
          '\x1b[0m subscribed to topics: ' +
          subscriptions.map((s) => s.topic).join('\n') +
          ' ' +
          'from broker' +
          ' ' +
          aedes.id,
      );
    });
    aedes.on('unsubscribe', (subscriptions, client) => {
      this.log.info(
        'MQTT client \x1b[32m' +
          (client ? client.id : client) +
          '\x1b[0m unsubscribed to topics: ' +
          subscriptions.join('\n') +
          ' ' +
          'from broker' +
          ' ' +
          aedes.id,
      );
    });
    aedes.on('clientError', (client, err) => {
      this.log.warn('client error: ' + client.id + ' ' + err.message + ' ' + err.stack);
    });
    aedes.on('connectionError', (client, err) => {
      this.log.warn('client error: ' + client + ' ' + err.message + ' ' + err.stack);
    });
  }

  async prepareEventNotification(data) {
    let state = 'Event Before';
    let camera = data.before.camera;
    let label = data.before.label;
    let score = data.before.top_score;
    const status = data.type;
    //check if only end events should be notified or start and update events
    if ((this.config.notificationEventSnapshot && status === 'end') || this.config.notificationEventSnapshotStart) {
      let imageUrl = '';
      let image = '';
      if (data.before.has_snapshot) {
        state += ' Snapshot';
        imageUrl = `http://${this.config.friurl}/api/events/${data.before.id}/snapshot.jpg`;
      } else {
        this.log.info(`Snapshot sending active but no snapshot available for event ${data.before.id}`);
      }
      if (data.after) {
        // image = data.after.snapshot;
        state = 'Event After';
        camera = data.after.camera;
        label = data.after.label;
        score = data.after.top_score;

        if (data.after.has_snapshot) {
          imageUrl = `http://${this.config.friurl}/api/events/${data.after.id}/snapshot.jpg`;
          state += ' Snapshot';
        }
      }
      if (imageUrl) {
        image = await this.requestClient({
          url: imageUrl,
          method: 'get',
          responseType: 'arraybuffer',
        })
          .then((response) => {
            if (response.data) {
              return Buffer.from(response.data, 'binary').toString('base64');
            }
            this.log.debug('prepareEventNotification no data from ' + imageUrl);
            return '';
          })
          .catch((error) => {
            this.log.warn('prepareEventNotification error from ' + imageUrl);
            if (error.response && error.response.status >= 500) {
              this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
            }
            this.log.warn(error);
            return '';
          });
        data.imageContent = image;
      }
      this.sendNotification({
        source: camera,
        type: label,
        state: state + ' ' + status,
        image: image,
        score: score,
      });
    }
    //check if clip should be notified and event is end
    if (this.config.notificationEventClip) {
      if (data.type === 'end') {
        if (data.before && data.before.has_clip) {
          this.log.debug(`Wait ${this.config.notificationEventClipWaitTime} seconds for clip`);
          await this.sleep(this.config.notificationEventClipWaitTime * 1000);
          let state = 'Event Before Clip';
          let clipUrl = `http://${this.config.friurl}/api/events/${data.before.id}/clip.mp4`;
          if (data.after && data.after.has_clip) {
            state = 'Event After Clip';
            score = data.after.top_score;
            clipUrl = `http://${this.config.friurl}/api/events/${data.after.id}/clip.mp4`;
          }
          const clip = await this.requestClient({
            url: clipUrl,
            method: 'get',
            responseType: 'arraybuffer',
          })
            .then((response) => {
              if (response.data) {
                return Buffer.from(response.data, 'binary').toString('base64');
              }
              this.log.debug('prepareEventNotification no data from ' + clipUrl);
              return '';
            })
            .catch((error) => {
              this.log.warn('prepareEventNotification error from ' + clipUrl);
              if (error.response && error.response.status >= 500) {
                this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
              }
              this.log.warn(error);
              return '';
            });
          this.sendNotification({
            source: camera,
            type: label,
            state: state + ' ' + status,
            clip: clip,
            score: score,
          });
        } else {
          this.log.info(`Clip sending active but no clip available `);
        }
      }
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }
  async fetchEventHistory() {
    await this.requestClient({
      url: 'http://' + this.config.friurl + '/api/events',
      method: 'get',
      params: { limit: this.config.webnum },
    })
      .then(async (response) => {
        if (response.data) {
          this.log.debug('fetchEventHistory ' + JSON.stringify(response.data));
          await this.extendObjectAsync('events.history.json', {
            type: 'state',
            common: {
              name: 'history json',
              type: 'string',
              role: 'json',
              read: true,
              write: false,
            },
            native: {},
          });

          for (const event of response.data) {
            event.websnap = 'http://' + this.config.friurl + '/api/events/' + event.id + '/snapshot.jpg';
            event.webclip = 'http://' + this.config.friurl + '/api/events/' + event.id + '/clip.mp4';
            event.thumbnail = 'data:image/jpeg;base64,' + event.thumbnail;
          }
          this.json2iob.parse('events.history', response.data, { forceIndex: true });
          this.setStateAsync('events.history.json', JSON.stringify(response.data), true);
        }
      })
      .catch((error) => {
        this.log.warn('fetchEventHistory error from http://' + this.config.friurl + '/api/events');
        if (error.response && error.response.status >= 500) {
          this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
        }
        this.log.warn(error);
      });
  }

  async sendNotification(message) {
    const pauseState = await this.getStateAsync('remote.pauseNotifications');
    if (pauseState && pauseState.val) {
      this.log.debug('Notifications paused');
      return;
    }
    const cameraPauseState = await this.getStateAsync(message.source + 'remote.pauseNotifications');
    if (cameraPauseState && cameraPauseState.val) {
      this.log.debug('Notifications paused for camera ' + message.source);
      return;
    }

    if (this.notificationExcludeArray && this.notificationExcludeArray.includes(message.source)) {
      this.log.debug('Notification for ' + message.source + ' is excluded');
      return;
    }

    if (this.config.notificationActive) {
      let imageB64 = message.image;
      let ending = '.jpg';
      let type = 'photo';
      const uuid = uuidv4();

      if (message.clip != null) {
        imageB64 = message.clip;
        ending = '.mp4';
        type = 'video';
      }
      this.log.debug(
        `Notification score ${message.score} type ${message.type} state ${message.state} image/clip ${imageB64.length} format ${type}`,
      );
      const notificationMinScoreState = await this.getStateAsync(message.source + 'remote.notificationMinScore');
      if (notificationMinScoreState && notificationMinScoreState.val) {
        const notificationMinScoreStateValue = notificationMinScoreState.val;
        if (
          notificationMinScoreStateValue != null &&
          notificationMinScoreStateValue > 0 &&
          message.score < notificationMinScoreStateValue
        ) {
          this.log.info(
            `Notification skipped score ${message.score} is lower than ${notificationMinScoreState.val} state  ${message.state} type ${message.type}`,
          );
          return;
        }
      } else if (message.score != null && this.notificationMinScore > 0 && message.score < this.config.notificationMinScore) {
        this.log.info(
          `Notification skipped score ${message.score} is lower than ${this.config.notificationMinScore} state  ${message.state} type ${message.type}`,
        );
        return;
      } else {
        this.log.debug(`Notification score ${message.score} is higher than ${this.config.notificationMinScore} type ${message.type}`);
      }

      const imgBuffer = Buffer.from(imageB64, 'base64');
      const sendInstances = this.config.notificationInstances.replace(/ /g, '').split(',');
      let sendUser = [];
      if (this.config.notificationUsers) {
        sendUser = this.config.notificationUsers.replace(/ /g, '').split(',');
      }
      let messageTextTemplate = this.config.notificationTextTemplate;
      const notificationTextState = await this.getStateAsync(message.source + 'remote.notificationText');
      if (notificationTextState && notificationTextState.val) {
        if (notificationTextState.val != null) {
          messageTextTemplate = notificationTextState.val.toString();
        }
      }
      const messageText = messageTextTemplate
        .replace(/{{source}}/g, message.source)
        .replace(/{{type}}/g, message.type)
        .replace(/{{state}}/g, message.state)
        .replace(/{{score}}/g, message.score);
      this.log.debug('Notification message ' + messageText);
      for (const sendInstance of sendInstances) {
        if (sendUser.length > 0) {
          for (const user of sendUser) {
            if (sendInstance.includes('pushover')) {
              // fs.writeFileSync(`${this.tmpDir}${sep}${uuid}${ending}`, imageBuffer, 'base64');
              await this.sendToAsync(sendInstance, {
                device: user,
                file: { name: `${this.tmpDir}${sep}${uuid}${ending}`, data: imgBuffer },
                title: messageText,
              });
              // try {
              //   fs.unlinkSync(`${this.tmpDir}${sep}${uuid}${ending}`);
              // } catch (error) {
              //   this.log.error(error);
              // }
            } else if (sendInstance.includes('signal-cmb')) {
              await this.sendToAsync(sendInstance, 'send', {
                text: messageText,
                phone: user,
              });
            } else {
              await this.sendToAsync(sendInstance, {
                user: user,
                text: imgBuffer,
                type: type,
                caption: messageText,
              });
            }
          }
        } else {
          if (sendInstance.includes('pushover')) {
            // fs.writeFileSync(`${this.tmpDir}${sep}${uuid}${ending}`, imageB64, 'base64');
            await this.sendToAsync(sendInstance, {
              file: { name: `${this.tmpDir}${sep}${uuid}${ending}`, data: imgBuffer },
              title: messageText,
            });
            // try {
            //   fs.unlinkSync(`${this.tmpDir}${sep}${uuid}${ending}`);
            // } catch (error) {
            //   this.log.error(error);
            // }
          } else if (sendInstance.includes('signal-cmb')) {
            await this.sendToAsync(sendInstance, 'send', {
              text: messageText,
            });
          } else {
            await this.sendToAsync(sendInstance, { text: imgBuffer, type: type, caption: messageText });
          }
        }
      }
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      server.close();
      callback();
    } catch (e) {
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        if (id.endsWith('_state')) {
          //remove adapter name and instance from id
          id = id.replace(this.name + '.' + this.instance + '.', '');
          id = id.replace('_state', '');
          const idArray = id.split('.');
          const pathArray = ['frigate', ...idArray, 'set'];

          const topic = pathArray.join('/');
          this.log.debug('publish' + ' ' + topic + ' ' + state.val);
          aedes.publish(
            {
              cmd: 'publish',
              qos: 0,
              topic: topic,
              payload: state.val,
              retain: false,
            },
            (err) => {
              if (err) {
                this.log.error(err);
              } else {
                this.log.info('published ' + topic + ' ' + state.val);
              }
            },
          );
        }
      }
    } else {
      // The state was deleted
      // this.log.info(`state ${id} deleted`);
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Frigate(options);
} else {
  // otherwise start the instance directly
  new Frigate();
}
