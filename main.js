'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const json2iob = require('json2iob');
const mqtt = require('mqtt');
const axios = require('axios').default;

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
    this.mqttClient = null;
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    this.setState('info.connection', false, true);
    this.subscribeStates('*');
    if (!this.config.host) {
      this.log.warn('No host set');
      if (this.config.friurl) {
        this.config.host = this.config.friurl.split(':')[0].replace('http://', '').replace('https://', '');
        this.log.warn('Using friurl instead: ' + this.config.host);
      }
    }
    await this.initMqtt();
  }

  async initMqtt() {
    if (this.mqttClient) {
      this.mqttClient.end();
    }

    this.mqttClient = mqtt.connect('http://' + this.config.host + this.config.mqttPort, {
      username: this.config.mqttUser,
      password: this.config.mqttPassword,
      keepalive: 60,
      reconnectPeriod: 1000,
      connectTimeout: 30 * 1000,
    });
    this.mqttClient.on('connect', () => {
      this.log.info('MQTT connected');
      this.setState('info.connection', true, true);
      if (this.mqttClient) {
        this.mqttClient.subscribe('frigate/available', { qos: 0 });
        this.mqttClient.subscribe('frigate/events', { qos: 0 });
      }
    });
    this.mqttClient.on('close', () => {
      this.log.info('MQTT closed');
      this.setState('info.connection', false, true);
    });
    this.mqttClient.on('error', (error) => {
      this.log.error('MQTT error: ' + error);
      this.setState('info.connection', false, true);
    });
    this.mqttClient.on('message', (topic, message) => {
      this.log.debug('MQTT message: ' + topic + ' ' + message.toString());
      const [frigate, camera, type] = topic.split('/');
      const data = JSON.parse(message.toString());
      //   if (type == 'last_event') {
      //     this.setState(frigate + '.' + camera + '.last_event', data, true);
      //   } else if (type == 'last_thumbnail') {
      //     this.setState(frigate + '.' + camera + '.last_thumbnail', data, true);
      //   } else if (type == 'last_person') {
      //     this.setState(frigate + '.' + camera + '.last_person', data, true);
      //   } else if (type == 'last_snapshot') {
      //     this.setState(frigate + '.' + camera + '.last_snapshot', data, true);
      //   } else if (type == 'last_person_snapshot') {
      //     this.setState(frigate + '.' + camera + '.last_person_snapshot', data, true);
      //   } else if (type == 'last_snapshot_person') {
      //     this.setState(frigate + '.' + camera + '.last_snapshot_person', data, true);
      //   } else if (type == 'snapshot') {
      //     this.setState(frigate + '.' + camera + '.snapshot', data, true);
      //   }
    });
    this.mqttClient.on('offline', () => {
      this.log.info('MQTT offline');
      this.setState('info.connection', false, true);
    });
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.mqttClient && this.mqttClient.end();
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
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      // The state was deleted
      this.log.info(`state ${id} deleted`);
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
