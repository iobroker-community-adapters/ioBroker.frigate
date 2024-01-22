'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const json2iob = require('json2iob');
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
      timeout: 3 * 60 * 1000, //3min client timeout
    });
    this.clientId = 'frigate';
    this.json2iob = new json2iob(this);
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.setState('info.connection', false, true);
    this.subscribeStates('*');
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
      this.log.info(
        "Please enter host: '" + this.host + "' and port: '" + this.config.mqttPort + "' in frigate config",
      );
    });
    aedes.on('client', (client) => {
      this.log.info('New client: ' + client.id);
      this.log.info('Filter for message from client: ' + client.id);
      this.clientId = client.id;
      this.setState('info.connection', true, true);
    });
    aedes.on('clientDisconnect', (client) => {
      this.log.info('client disconnected ' + client.id);
      this.setState('info.connection', false, true);
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
          // join every path item except the first one to create a flat hierarchy
          if (pathArray[0] !== 'stats' || pathArray[0] !== 'events' || pathArray[0] !== 'available') {
            const cameraId = pathArray.shift();
            pathArray = [cameraId, pathArray.join('_')];
          }

          //convert snapshot jpg to base64 with data url
          if (pathArray[pathArray.length - 1] === 'snapshot') {
            data = 'data:image/jpeg;base64,' + packet.payload.toString('base64');
          }
          //if last path state then make it writable
          if (pathArray[pathArray.length - 1] === 'state') {
            write = true;
          }
          this.json2iob.parse(pathArray.join('.'), data, { write: write });

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
      this.log.warn('client error' + client.id + ' ' + err.message + ' ' + err.stack);
    });
    aedes.on('connectionError', (client, err) => {
      this.log.warn('client error ' + client + ' ' + err.message + ' ' + err.stack);
    });
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
      // The state was changed
      // this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
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
