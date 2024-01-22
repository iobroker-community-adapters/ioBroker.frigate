'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const json2iob = require('json2iob');
const fs = require('fs');
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
    await this.cleanOldObjects();
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
    server.listen(this.config.mqttPort, () => {
      this.log.info('MQTT server started and listening on port ' + this.config.mqttPort);
      this.log.info("Please enter host: '" + this.host + "' and port: '" + this.config.mqttPort + "' in frigate config");
      this.log.info("If you don't see a new client connected, please restart frigate and adapter.");
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
            this.sendNotification({
              source: pathArray[0],
              type: pathArray[1],
              state: pathArray[pathArray.length - 1],
              image: packet.payload.toString('base64'),
            });
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
          //parse json to iobroker states
          this.json2iob.parse(pathArray.join('.'), data, { write: write });

          //create devices state for cameras
          if (pathArray[0] === 'stats') {
            if (data.cameras) {
              for (const key in data.cameras) {
                await this.extendObjectAsync(key, {
                  type: 'device',
                  common: {
                    name: 'Camera ' + key,
                  },
                  native: {},
                });
              }
            }
          }
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
    let status = data.type;
    if (this.config.notificationEventSnapshot) {
      let imageUrl = '';
      let image = '';
      if (data.before.has_snapshot) {
        state += ' Snapshot';
        imageUrl = `http://${this.config.friurl}/api/events/${data.before.id}/snapshot.jpg`;
      }
      if (data.after) {
        // image = data.after.snapshot;
        state = 'Event After';
        camera = data.after.camera;
        label = data.after.label;

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
      });
    }
    if (this.config.notificationEventClip && data.before && data.before.has_clip) {
      let state = 'Event Before Clip';
      let clipUrl = `http://${this.config.friurl}/api/events/${data.before.id}/clip.mp4`;
      if (data.after && data.after.has_clip) {
        state = 'Event After Clip';
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
      });
    }
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
    if (this.config.notificationActive) {
      this.log.debug('sendNotification ' + JSON.stringify(message));
      let imageBuffer = message.image;
      let ending = '.jpg';
      const uuid = uuidv4();

      if (message.clip) {
        imageBuffer = message.clip;
        ending = '.mp4';
      }
      fs.writeFileSync(`${this.tmpDir}${sep}${uuid}${ending}`, imageBuffer, 'base64');
      const sendInstances = this.config.notificationInstances.replace(/ /g, '').split(',');
      let sendUser = [];
      if (this.config.notificationUsers) {
        sendUser = this.config.notificationUsers.replace(/ /g, '').split(',');
      }
      const messageText = `${message.source} ${message.type} ${message.state}`;
      for (const sendInstance of sendInstances) {
        if (sendUser.length > 0) {
          for (const user of sendUser) {
            if (sendInstance.includes('pushover')) {
              await this.sendToAsync(sendInstance, {
                device: user,
                file: `${this.tmpDir}${sep}${uuid}${ending}`,
                title: messageText,
              });
            } else if (sendInstance.includes('signal-cmb')) {
              await this.sendToAsync(sendInstance, 'send', {
                text: messageText,
                phone: user,
              });
            } else {
              await this.sendToAsync(sendInstance, {
                user: user,
                text: messageText,
              });
              await this.sendToAsync(sendInstance, {
                user: user,
                text: `${this.tmpDir}${sep}${uuid}${ending}`,
              });
            }
          }
        } else {
          if (sendInstance.includes('pushover')) {
            await this.sendToAsync(sendInstance, {
              file: `${this.tmpDir}${sep}${uuid}${ending}`,
              title: messageText,
            });
          } else if (sendInstance.includes('signal-cmb')) {
            await this.sendToAsync(sendInstance, 'send', {
              text: messageText,
            });
          } else {
            await this.sendToAsync(sendInstance, messageText);
            await this.sendToAsync(sendInstance, `${this.tmpDir}${sep}${uuid}${ending}`);
          }
        }
      }
      try {
        fs.unlinkSync(`${this.tmpDir}${sep}${uuid}${ending}`);
      } catch (error) {
        this.log.error(error);
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
