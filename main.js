// @ts-nocheck
'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 */

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
const net = require('net');
const server = net.createServer(aedes.handle);

const https = require('https');
const mqtt = require('mqtt');

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

    // HTTP client (configured later, needs config)
    this.requestClient = null;

    // MQTT
    this.mqttClient = null; // external broker client (mqtt library)
    this.mqttClientConnected = false;

    this.mqttServerStarted = false;
    this.localClientConnected = false;

    // existing fields
    this.clientId = 'frigate';
    this.json2iob = new json2iob(this);
    this.tmpDir = tmpdir();
    this.notificationMinScore = null;
    this.firstStart = true;
    this.deviceArray = [''];
    this.notificationsLog = {};
    this.trackedObjectsHistory = [];

    // --- Frigate API base/auth
    this.baseUrl = null; // http://host:5000 OR https://host:8971
    this.authCookie = null;
    this.authToken = null;
    this.authMode = 'none'; // 'none' | 'frigate'
    this.didLogin = false;

    // Notification exclude list
    this.notificationExcludeArray = null;
  }

  // ----------------------------
  // Helpers: MQTT mode / prefix
  // ----------------------------

  getMqttMode() {
    const mode = (this.config.mqttMode || 'server').toString().trim().toLowerCase();
    return ['server', 'client', 'both'].includes(mode) ? mode : 'server';
  }

  useMqttServer() {
    const mode = this.getMqttMode();
    return mode === 'server' || mode === 'both';
  }

  useMqttClient() {
    const mode = this.getMqttMode();
    return mode === 'client' || mode === 'both';
  }

  getTopicPrefix() {
    return (this.config.mqttTopicPrefix || 'frigate').toString().trim().replace(/\/+$/, '') || 'frigate';
  }

  setConnectionState() {
    const any =
      (this.useMqttServer() && this.mqttServerStarted && this.localClientConnected) || (this.useMqttClient() && this.mqttClientConnected);
    this.setState('info.connection', !!any, true);
  }

  // ----------------------------
  // Frigate API (5000 vs 8971)
  // ----------------------------

  buildBaseUrlFromConfig() {
    // Backwards compatibility: friurl can be "host:port" or "host"
    // New config: frigateProtocol, frigatePort
    const protocol = (this.config.frigateProtocol || '').trim().toLowerCase(); // http|https
    const port = Number(this.config.frigatePort || 0);

    let raw = (this.config.friurl || '').trim();
    if (!raw) return null;

    // already with scheme -> use as-is
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw.replace(/\/$/, '');
    }

    const hasPort = /:\d+$/.test(raw);
    let finalProtocol = protocol || 'http';
    let hostPort = raw;

    if (port && !Number.isNaN(port)) {
      hostPort = raw.replace(/:\d+$/, '');
      hostPort = `${hostPort}:${port}`;
    } else if (!hasPort) {
      hostPort = `${raw}:5000`;
    }

    return `${finalProtocol}://${hostPort}`.replace(/\/$/, '');
  }

  initHttpClient() {
    this.baseUrl = this.buildBaseUrlFromConfig();

    const rejectUnauthorized = this.config.frigateRejectUnauthorized === undefined ? true : !!this.config.frigateRejectUnauthorized;

    const isHttps = this.baseUrl && this.baseUrl.startsWith('https://');

    const httpsAgent = isHttps ? new https.Agent({ rejectUnauthorized }) : undefined;

    this.requestClient = axios.create({
      withCredentials: true,
      headers: {
        'User-Agent': 'ioBroker.frigate',
        accept: '*/*',
      },
      timeout: 3 * 60 * 1000,
      httpsAgent,
      validateStatus: (status) => status >= 200 && status < 500,
    });
  }

  detectAuthMode() {
    if (!this.baseUrl) return 'none';
    const portMatch = this.baseUrl.match(/:(\d+)(\/)?$/);
    const port = portMatch ? Number(portMatch[1]) : null;
    if (port === 8971 || this.baseUrl.startsWith('https://')) return 'frigate';
    return 'none';
  }

  async frigateLogin() {
    const user = (this.config.frigateUsername || '').toString();
    const password = (this.config.frigatePassword || '').toString();

    if (!user || !password) {
      this.log.warn('Frigate HTTPS/Auth enabled but frigateUsername/frigatePassword missing. Cannot login.');
      return false;
    }

    const url = `${this.baseUrl}/api/login`;
    this.log.debug(`Login to Frigate: ${url}`);

    try {
      const res = await this.requestClient({
        url,
        method: 'post',
        data: { user, password },
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status !== 200) {
        this.log.warn(`Frigate login failed: HTTP ${res.status}`);
        res.data && this.log.debug(JSON.stringify(res.data).substring(0, 500));
        return false;
      }

      const setCookie = res.headers && (res.headers['set-cookie'] || res.headers['Set-Cookie']);
      if (setCookie && Array.isArray(setCookie) && setCookie.length > 0) {
        const cookiePairs = setCookie.map((c) => c.split(';')[0]).filter(Boolean);
        this.authCookie = cookiePairs.join('; ');
        this.log.debug(`Stored auth cookie(s): ${cookiePairs.map((c) => c.split('=')[0]).join(', ')}`);

        const tokenPair = cookiePairs.find((c) => /^frigate_token=/.test(c) || /^access_token=/.test(c) || /^token=/.test(c));
        if (tokenPair) this.authToken = tokenPair.split('=')[1];
      } else {
        this.log.warn('Login OK but no Set-Cookie header found. Auth may fail for further API calls.');
      }

      this.didLogin = true;
      return true;
    } catch (e) {
      this.log.warn(`Frigate login error: ${e.message || e}`);
      return false;
    }
  }

  async ensureAuth() {
    if (this.authMode !== 'frigate') return true;
    if (this.authCookie) return true;
    return await this.frigateLogin();
  }

  async apiRequest({ path, method = 'get', params, data, responseType } = {}) {
    if (!this.baseUrl) throw new Error('No baseUrl configured');

    await this.ensureAuth();

    const url = `${this.baseUrl}${path}`;
    const headers = {};
    if (this.authCookie) headers['Cookie'] = this.authCookie;
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const res = await this.requestClient({
      url,
      method,
      params,
      data,
      responseType,
      headers,
    });

    if (this.authMode === 'frigate' && res.status === 401) {
      this.log.info('Frigate API returned 401. Re-login and retry once.');
      this.authCookie = null;
      this.authToken = null;
      this.didLogin = false;

      const ok = await this.frigateLogin();
      if (!ok) return res;

      const headers2 = {};
      if (this.authCookie) headers2['Cookie'] = this.authCookie;
      if (this.authToken) headers2['Authorization'] = `Bearer ${this.authToken}`;

      return await this.requestClient({
        url,
        method,
        params,
        data,
        responseType,
        headers: headers2,
      });
    }

    return res;
  }

  // ----------------------------
  // MQTT: unified in/out
  // ----------------------------

  async handleIncomingMqtt(topic, payloadBuffer, source = 'unknown') {
    try {
      const prefix = this.getTopicPrefix();

      if (payloadBuffer) {
        if (topic === `${prefix}/stats` || topic.endsWith('snapshot')) {
          this.log.silly(`[${source}] publish ${topic} ${payloadBuffer.toString()}`);
        } else {
          this.log.debug(`[${source}] publish ${topic} ${payloadBuffer.toString()}`);
        }
      } else {
        this.log.debug(`[${source}] ${topic} (no payload)`);
      }

      let pathArray = topic.split('/');
      let data = payloadBuffer ? payloadBuffer.toString() : '';
      let write = false;

      try {
        data = JSON.parse(data);
      } catch {
        // string payload ok
      }

      if (pathArray[0] === prefix) {
        pathArray.shift();

        // tracked_object_update
        if (pathArray[0] === 'tracked_object_update') {
          await this.handleTrackedObjectUpdate(data);
          return;
        }

        // snapshot jpg -> base64 data URL
        if (pathArray[pathArray.length - 1] === 'snapshot' && payloadBuffer) {
          data = 'data:image/jpeg;base64,' + payloadBuffer.toString('base64');

          if (this.config.notificationCamera) {
            const uuid = uuidv4();
            const fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
            this.log.debug('Save snapshot image to ' + fileName);
            fs.writeFileSync(fileName, payloadBuffer);

            await this.sendNotification({
              source: pathArray[0],
              type: pathArray[1],
              state: pathArray[pathArray.length - 1],
              image: fileName,
            });

            try {
              fs.unlinkSync(fileName);
            } catch (e) {
              this.log.error(e);
            }
          }
        }

        // writable state
        if (pathArray[pathArray.length - 1] === 'state') {
          write = true;
        }

        // events -> notify + refresh history
        if (pathArray[pathArray.length - 1] === 'events') {
          this.prepareEventNotification(data);
          this.fetchEventHistory();
        }

        // flatten camera topics
        if (
          pathArray[0] !== 'stats' &&
          pathArray[0] !== 'events' &&
          pathArray[0] !== 'available' &&
          pathArray[0] !== 'reviews' &&
          pathArray[0] !== 'camera_activity' &&
          pathArray.length > 1
        ) {
          const cameraId = pathArray.shift();
          pathArray = [cameraId, pathArray.join('_')];
        }

        if (pathArray[0] === 'reviews') {
          if (data?.after?.data?.detections) delete data.after.data.detections;
          if (data?.before?.data?.detections) delete data.before.data.detections;
        }

        if (pathArray[0] === 'events') {
          if (data?.after) delete data.after.path_data;
          if (data?.before) delete data.before.path_data;

          if (data?.after?.snapshot) delete data.after.snapshot.path_data;
          if (data?.before?.snapshot) delete data.before.snapshot.path_data;

          if (data?.history) {
            for (const item of data.history) {
              delete item.path_data;
              if (item.snapshot) delete item.snapshot.path_data;
            }
          }
        }

        if (pathArray[0] === 'stats') {
          if (data?.cpu_usages) delete data.cpu_usages;
          this.createCameraDevices();
        }
      }

      await this.json2iob.parse(pathArray.join('.'), data, { write });
    } catch (error) {
      this.log.warn(error);
    }
  }

  publishToLocalBroker(topic, payload) {
    if (!this.useMqttServer() || !this.mqttServerStarted) return Promise.resolve();
    return new Promise((resolve) => {
      aedes.publish({ cmd: 'publish', qos: 0, topic, payload, retain: false }, (err) => {
        if (err) this.log.error(err);
        resolve();
      });
    });
  }

  publishToExternalBroker(topic, payload) {
    if (!this.useMqttClient() || !this.mqttClient || !this.mqttClientConnected) return Promise.resolve();
    return new Promise((resolve) => {
      this.mqttClient.publish(topic, payload, { qos: 0, retain: false }, (err) => {
        if (err) this.log.error(err);
        resolve();
      });
    });
  }

  async publishCommand(topic, payload) {
    // in 'both': send to both paths
    if (this.useMqttServer()) await this.publishToLocalBroker(topic, payload);
    if (this.useMqttClient()) await this.publishToExternalBroker(topic, payload);
  }

  // ----------------------------
  // onReady lifecycle
  // ----------------------------

  async onReady() {
    this.setState('info.connection', false, true);
    this.subscribeStates('*_state');
    this.subscribeStates('*.remote.*');
    this.subscribeStates('remote.*');

    if (!this.config.friurl) {
      this.log.warn('No Frigate url set');
    }

    // HTTP/HTTPS client + auth mode
    this.initHttpClient();
    this.authMode = this.detectAuthMode();

    if (this.baseUrl) {
      this.log.info(`Using Frigate base URL: ${this.baseUrl}`);
      this.log.info(`Auth mode: ${this.authMode === 'frigate' ? 'Frigate login (8971/https)' : 'none (5000/http)'}`);
    }

    // Notification min score
    try {
      if (this.config.notificationMinScore) {
        this.notificationMinScore = parseFloat(this.config.notificationMinScore);
        if (this.notificationMinScore > 1) {
          this.notificationMinScore = this.notificationMinScore / 100;
          this.log.info('Notification min score > 1. Recalculated to ' + this.notificationMinScore);
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

    // cleanup tmp files
    if (this.config.notificationActive) {
      this.log.debug('Clean old images and clips');
      let count = 0;
      try {
        fs.readdirSync(this.tmpDir).forEach((file) => {
          if (file.endsWith('.jpg') || file.endsWith('.mp4')) {
            this.log.debug('Try to delete ' + file);
            fs.unlinkSync(this.tmpDir + sep + file);
            count++;
          }
        });
        count && this.log.info('Deleted ' + count + ' old images and clips in tmp folder');
      } catch (error) {
        this.log.warn('Cannot delete old images and clips');
        this.log.warn(error);
      }
    }

    await this.cleanOldObjects();
    await this.cleanTrackedObjects();

    // base objects
    await this.extendObjectAsync('events', {
      type: 'channel',
      common: { name: 'Events current and history' },
      native: {},
    });
    await this.extendObjectAsync('events.history.json', {
      type: 'state',
      common: { name: 'Events history', type: 'string', role: 'json', read: true, write: false },
      native: {},
    });
    await this.extendObjectAsync('tracked_objects', {
      type: 'channel',
      common: { name: 'Tracked Object Updates' },
      native: {},
    });
    await this.extendObjectAsync('tracked_objects.history', {
      type: 'state',
      common: { name: 'Tracked Objects History (Last 10)', type: 'string', role: 'json', read: true, write: false },
      native: {},
    });
    await this.extendObjectAsync('remote', {
      type: 'channel',
      common: { name: 'Control adapter' },
      native: {},
    });
    await this.extendObjectAsync('remote.restart', {
      type: 'state',
      common: { name: 'Restart Frigate', type: 'boolean', role: 'button', def: false, read: true, write: true },
      native: {},
    });
    await this.extendObjectAsync('remote.pauseNotifications', {
      type: 'state',
      common: { name: 'Pause All notifications', type: 'boolean', role: 'switch', def: false, read: true, write: true },
      native: {},
    });
    await this.extendObjectAsync('remote.pauseNotificationsForTime', {
      type: 'state',
      common: { name: 'Pause All notifications for time in minutes', type: 'number', role: 'value', def: 10, read: true, write: true },
      native: {},
    });

    // Start MQTT(s)
    await this.initMqttServerIfEnabled();
    await this.initMqttClientIfEnabled();

    this.setConnectionState();
  }

  // ----------------------------
  // MQTT server (aedes) / client (mqtt)
  // ----------------------------

  async initMqttServerIfEnabled() {
    if (!this.useMqttServer()) return;

    server
      .listen(this.config.mqttPort, () => {
        this.mqttServerStarted = true;
        this.log.info('MQTT server started and listening on port ' + this.config.mqttPort);
        this.log.info("Please enter host: '" + this.host + "' and port: '" + this.config.mqttPort + "' in frigate config");
        this.log.info("If you don't see a new client connected, please restart frigate and adapter.");
        this.setConnectionState();
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
      this.localClientConnected = true;
      this.setConnectionState();
      this.fetchEventHistory();
    });

    aedes.on('clientDisconnect', (client) => {
      this.log.info('client disconnected ' + client.id);
      this.localClientConnected = false;
      this.setState('available', 'offline', true);
      this.setConnectionState();
    });

    aedes.on('publish', async (packet, client) => {
      if (!client) return; // ignore internal publishes
      if (!packet || !packet.topic) return;
      await this.handleIncomingMqtt(packet.topic, packet.payload, `server:${client.id}`);
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

  async initMqttClientIfEnabled() {
    if (!this.useMqttClient()) return;

    const brokerUrl = (this.config.mqttBrokerUrl || '').toString().trim();
    if (!brokerUrl) {
      this.log.warn('MQTT client mode enabled, but mqttBrokerUrl is empty.');
      return;
    }

    const clientId = (this.config.mqttClientId || '').toString().trim() || `iobroker-frigate-${uuidv4().slice(0, 8)}`;
    const username = (this.config.mqttUsername || '').toString();
    const password = (this.config.mqttPassword || '').toString();

    const tlsRejectUnauthorized = this.config.mqttRejectUnauthorized === undefined ? true : !!this.config.mqttRejectUnauthorized;

    const opts = {
      clientId,
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: 5000,
    };

    // mqtts TLS handling
    if (brokerUrl.startsWith('mqtts://')) {
      opts.rejectUnauthorized = tlsRejectUnauthorized;
    }

    this.log.info(`MQTT client connecting to ${brokerUrl} as ${clientId}`);
    this.mqttClient = mqtt.connect(brokerUrl, opts);

    this.mqttClient.on('connect', () => {
      this.mqttClientConnected = true;
      this.log.info('MQTT client connected to external broker');
      this.setConnectionState();

      const prefix = this.getTopicPrefix();
      const sub = `${prefix}/#`;

      this.mqttClient.subscribe(sub, { qos: 0 }, (err) => {
        if (err) this.log.error('MQTT client subscribe error: ' + err.message);
        else this.log.info(`MQTT client subscribed: ${sub}`);
      });

      this.fetchEventHistory();
    });

    this.mqttClient.on('reconnect', () => this.log.info('MQTT client reconnecting...'));

    const onDown = (msg) => {
      this.mqttClientConnected = false;
      this.log.warn(msg);
      this.setConnectionState();
    };

    this.mqttClient.on('close', () => onDown('MQTT client connection closed'));
    this.mqttClient.on('offline', () => onDown('MQTT client offline'));
    this.mqttClient.on('error', (err) => {
      this.mqttClientConnected = false;
      this.log.error('MQTT client error: ' + (err?.message || err));
      this.setConnectionState();
    });

    this.mqttClient.on('message', async (topic, payload) => {
      await this.handleIncomingMqtt(topic, payload, 'client');
    });
  }

  // ----------------------------
  // Original functions (with baseUrl/apiRequest)
  // ----------------------------

  async cleanOldObjects() {
    await this.delObjectAsync('reviews.before.data.detections', { recursive: true });
    await this.delObjectAsync('reviews.after.data.detections', { recursive: true });

    // Clean path_data objects - find and delete parent data folder if path_data exists
    const allObjects = await this.getObjectListAsync({
      startkey: this.namespace + '.',
      endkey: this.namespace + '.\u9999',
    });

    const dataFoldersToDelete = new Set();
    for (const obj of allObjects.rows) {
      if (obj.id.includes('.path_data')) {
        const match = obj.id.match(/(.+\.history\.\d+\.data)/);
        if (match) {
          dataFoldersToDelete.add(match[1].replace(this.namespace + '.', ''));
        }
      }
    }

    for (const dataFolder of dataFoldersToDelete) {
      try {
        await this.delObjectAsync(dataFolder, { recursive: true });
      } catch {
        // ignore
      }
    }

    const remoteState = await this.getObjectAsync('lastidurl');
    if (remoteState) {
      this.log.info('clean old states ');
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

  async cleanTrackedObjects() {
    this.log.info('Cleaning old tracked objects');
    try {
      for (let i = 1; i <= 20; i++) {
        const paddedIndex = i.toString().padStart(2, '0');
        try {
          await this.delObjectAsync(`tracked_objects.${paddedIndex}`, { recursive: true });
        } catch {
          // ignore
        }
      }

      const objects = await this.getObjectListAsync({
        startkey: this.namespace + '.tracked_objects.',
        endkey: this.namespace + '.tracked_objects.\u9999',
      });

      for (const obj of objects.rows) {
        if (obj.id !== this.namespace + '.tracked_objects' && obj.id !== this.namespace + '.tracked_objects.history') {
          try {
            await this.delObjectAsync(obj.id.replace(this.namespace + '.', ''), { recursive: true });
          } catch {
            // ignore
          }
        }
      }

      this.trackedObjectsHistory = [];
      this.log.info('Cleaned all tracked objects');
    } catch (error) {
      this.log.warn('Error cleaning tracked objects: ' + error.message);
    }
  }

  /**
   * Handle tracked object update events using JSON-based approach (last 10 updates)
   * @param {object} data - The parsed JSON data from MQTT
   */
  async handleTrackedObjectUpdate(data) {
    try {
      if (!data) {
        this.log.warn('Invalid tracked object update: no data');
        return;
      }

      this.log.debug(`Processing tracked object update: ${JSON.stringify(data).substring(0, 200)}...`);

      // Add timestamp if not present
      if (!data.timestamp) {
        data.timestamp = Date.now() / 1000;
      }

      // Add the new update to the beginning of the array (latest first)
      this.trackedObjectsHistory.unshift(data);

      // Keep only the last 10 entries
      if (this.trackedObjectsHistory.length > 10) {
        this.trackedObjectsHistory = this.trackedObjectsHistory.slice(0, 10);
      }

      // Write the JSON array to the ioBroker state
      await this.setStateAsync('tracked_objects.history', JSON.stringify(this.trackedObjectsHistory), true);

      this.log.debug(`Stored tracked object update. History now contains ${this.trackedObjectsHistory.length} entries`);
    } catch (error) {
      this.log.error(`Error handling tracked object update: ${error.message}`);
      this.log.error(error.stack);
    }
  }

  async createCameraDevices() {
    if (!this.firstStart) return;

    this.log.info('Create Device information and fetch Event History');

    let data;
    try {
      const res = await this.apiRequest({ path: '/api/config', method: 'get' });
      if (res.status !== 200) {
        this.log.warn(`createCameraDevices error HTTP ${res.status} from ${this.baseUrl}/api/config`);
        res.data && this.log.debug(JSON.stringify(res.data).substring(0, 500));
        return;
      }
      data = res.data;
      this.log.debug(JSON.stringify(data));
    } catch (error) {
      this.log.warn('createCameraDevices error from ' + this.baseUrl + '/api/config');
      this.log.error(error);
      return;
    }

    if (!data) return;

    if (data.cameras) {
      for (const key in data.cameras) {
        this.deviceArray.push(key);
        this.log.info('Create device information for: ' + key);

        await this.extendObjectAsync(key, {
          type: 'device',
          common: { name: 'Camera ' + key },
          native: {},
        });

        await this.extendObjectAsync(key + '.history', {
          type: 'channel',
          common: { name: 'Event History' },
          native: {},
        });

        await this.extendObjectAsync(key + '.remote', {
          type: 'channel',
          common: { name: 'Control camera' },
          native: {},
        });

        await this.extendObjectAsync(key + '.remote.createEvent', {
          type: 'state',
          common: {
            name: 'Create Event with label',
            type: 'string',
            role: 'text',
            def: 'Label',
            read: true,
            write: true,
          },
          native: {},
        });

        await this.extendObjectAsync(key + '.remote.createEventBody', {
          type: 'state',
          common: {
            name: 'Body for create Event',
            type: 'string',
            role: 'json',
            def: `{}`,
            read: true,
            write: true,
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

        await this.extendObjectAsync(key + '.remote.pauseNotificationsForTime', {
          type: 'state',
          common: {
            name: 'Pause All notifications for time in minutes',
            type: 'number',
            role: 'value',
            def: 10,
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

        await this.extendObjectAsync(key + '.remote.ptz', {
          type: 'state',
          common: {
            name: 'Send PTZ commands preset_preset1, MOVE_LEFT, ZOOM_IN, STOP etc See docu',
            desc: 'https://docs.frigate.video/integrations/mqtt/#frigatecamera_nameptz',
            type: 'string',
            role: 'text',
            def: 'preset_preset1',
            read: true,
            write: true,
          },
          native: {},
        });
      }
    } else {
      this.log.warn('No cameras found');
      this.log.info(JSON.stringify(data));
    }

    this.log.info('Fetch event history for ' + (this.deviceArray.length - 1) + ' cameras');
    this.fetchEventHistory();
    this.firstStart = false;
    this.log.info('Device information created');
  }

  async prepareEventNotification(data) {
    let state = 'Event Before';
    let camera = data.before.camera;
    let label = data.before.label;
    let score = data.before.top_score;
    let zones = data.before.entered_zones;
    const status = data.type;

    if (
      (this.config.notificationEventSnapshot && status === 'end') ||
      (this.config.notificationEventSnapshotStart && status === 'new') ||
      (this.config.notificationEventSnapshotUpdate && status === 'update') ||
      (this.config.notificationEventSnapshotUpdateOnce && status === 'update' && !this.notificationsLog[data.before.id])
    ) {
      let imagePath = '';
      let fileName = '';

      if (data.before.has_snapshot) {
        imagePath = `/api/events/${data.before.id}/snapshot.jpg`;
      }

      if (data.after) {
        state = 'Event After';
        camera = data.after.camera;
        label = data.after.label;
        score = data.after.top_score;
        zones = data.after.entered_zones;

        if (data.after.has_snapshot) {
          imagePath = `/api/events/${data.after.id}/snapshot.jpg`;
        }
      }

      if (imagePath) {
        const uuid = uuidv4();
        fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
        this.log.debug('create uuid image to ' + fileName);

        try {
          const res = await this.apiRequest({
            path: imagePath,
            method: 'get',
            responseType: 'stream',
          });

          if (res.status === 200 && res.data) {
            this.log.debug('new writer for ' + fileName);
            const writer = fs.createWriteStream(fileName);
            res.data.pipe(writer);
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            }).catch((error) => {
              this.log.error(error);
            });
            this.log.debug('prepareEventNotification saved image to ' + fileName);
          } else {
            this.log.debug(`prepareEventNotification no data from ${this.baseUrl}${imagePath} (HTTP ${res.status})`);
          }
        } catch (error) {
          this.log.warn('prepareEventNotification error from ' + this.baseUrl + imagePath);
          this.log.warn(error);
        }
      } else {
        this.log.info(`Notification sending active but no image available for type ${label} state ${state}`);
      }

      if (fileName) {
        await this.sendNotification({
          source: camera,
          type: label,
          state: state,
          status: status,
          image: fileName,
          score: score,
          zones: zones,
          id: data.before.id,
        });
      }

      try {
        if (fileName) {
          this.log.debug('Try to delete ' + fileName);
          fs.unlinkSync(fileName);
          this.log.debug('Deleted ' + fileName);
        }
      } catch (error) {
        this.log.error(error);
      }
    }

    // Clip notification
    if (this.config.notificationEventClip || this.config.notificationEventClipLink) {
      if (data.type === 'end') {
        if (data.before && data.before.has_clip) {
          let fileName = '';
          let clipState = 'Event Before';
          score = data.before.top_score;
          zones = data.before.entered_zones;

          let clipPath = `/api/events/${data.before.id}/clip.mp4`;
          let clipm3u8 = `${this.baseUrl}/vod/event/${data.before.id}/master.m3u8`;
          let clipUrl = `${this.baseUrl}${clipPath}`;

          if (data.after && data.after.has_clip) {
            clipState = 'Event After';
            score = data.after.top_score;
            zones = data.after.entered_zones;
            clipPath = `/api/events/${data.after.id}/clip.mp4`;
            clipm3u8 = `${this.baseUrl}/vod/event/${data.after.id}/master.m3u8`;
            clipUrl = `${this.baseUrl}${clipPath}`;
          }

          if (this.config.notificationEventClipLink) {
            this.sendNotification({
              source: camera,
              type: label,
              state: clipState,
              status: status,
              clipUrl: clipUrl,
              clipm3u8: clipm3u8,
              score: score,
              zones: zones,
            });
          }

          if (this.config.notificationEventClip) {
            const uuid = uuidv4();
            fileName = `${this.tmpDir}${sep}${uuid}.mp4`;

            this.log.debug(`Wait ${this.config.notificationEventClipWaitTime} seconds for clip`);
            await this.sleep(this.config.notificationEventClipWaitTime * 1000);

            try {
              const res = await this.apiRequest({
                path: clipPath,
                method: 'get',
                responseType: 'stream',
              });

              if (res.status === 200 && res.data) {
                const writer = fs.createWriteStream(fileName);
                res.data.pipe(writer);
                await new Promise((resolve, reject) => {
                  writer.on('finish', resolve);
                  writer.on('error', reject);
                }).catch((error) => {
                  this.log.error(error);
                });
                this.log.debug('prepareEventNotification saved clip to ' + fileName);
              } else {
                this.log.debug(`prepareEventNotification no data from ${this.baseUrl}${clipPath} (HTTP ${res.status})`);
              }
            } catch (error) {
              this.log.warn('prepareEventNotification error from ' + this.baseUrl + clipPath);
              this.log.warn(error);
            }

            await this.sendNotification({
              source: camera,
              type: label,
              state: clipState,
              status: status,
              clip: fileName,
              score: score,
              zones: zones,
            });

            try {
              if (fileName) {
                this.log.debug('Try to delete ' + fileName);
                fs.unlinkSync(fileName);
                this.log.debug('Deleted ' + fileName);
              }
            } catch (error) {
              this.log.error(error);
            }
          }
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
    for (const device of this.deviceArray) {
      const params = { limit: this.config.webnum };
      if (device) params.cameras = device;

      try {
        const res = await this.apiRequest({
          path: '/api/events',
          method: 'get',
          params,
        });

        if (res.status !== 200) {
          this.log.warn(`fetchEventHistory error HTTP ${res.status} from ${this.baseUrl}/api/events`);
          if (res.data) this.log.debug(JSON.stringify(res.data).substring(0, 500));
          continue;
        }

        if (res.data) {
          this.log.debug('fetchEventHistory succesfull ' + device);

          for (const event of res.data) {
            event.websnap = `${this.baseUrl}/api/events/${event.id}/snapshot.jpg`;
            event.webclip = `${this.baseUrl}/api/events/${event.id}/clip.mp4`;
            event.webm3u8 = `${this.baseUrl}/vod/event/${event.id}/master.m3u8`;
            event.thumbnail = 'data:image/jpeg;base64,' + event.thumbnail;

            delete event.path_data;
            if (event.data) delete event.data.path_data;
          }

          let path = 'events.history';
          if (device) path = device + '.history';

          this.json2iob.parse(path, res.data, { forceIndex: true, channelName: 'Events history' });
          this.setStateAsync('events.history.json', JSON.stringify(res.data), true);
        }
      } catch (error) {
        this.log.warn('fetchEventHistory error from ' + this.baseUrl + '/api/events');
        this.log.warn(error);
      }
    }
  }

  async sendNotification(message) {
    const pauseState = await this.getStateAsync('remote.pauseNotifications');
    if (pauseState && pauseState.val) {
      this.log.debug('Notifications paused');
      return;
    }
    const cameraPauseState = await this.getStateAsync(message.source + '.remote.pauseNotifications');
    if (cameraPauseState && cameraPauseState.val) {
      this.log.debug('Notifications paused for camera ' + message.source);
      return;
    }

    if (this.notificationExcludeArray && this.notificationExcludeArray.includes(message.source)) {
      this.log.debug('Notification for ' + message.source + ' is excluded');
      return;
    }

    if (this.config.notificationExcludeZoneList) {
      const excludeZones = this.config.notificationExcludeZoneList.replace(/ /g, '').split(',');
      if (message.zones && message.zones.length > 0) {
        let allExcluded = true;
        this.log.debug(`Check if all zones are excluded ${message.zones} from ${excludeZones}`);
        for (const zone of message.zones) {
          if (!excludeZones.includes(zone)) {
            allExcluded = false;
          }
        }
        if (allExcluded) {
          this.log.debug('Notification for ' + message.source + ' is excluded because all zones are excluded');
          return;
        }
      }
    }

    if (this.config.notificationExcludeEmptyZoneList) {
      const cameras = this.config.notificationExcludeEmptyZoneList.replace(/ /g, '').split(',');
      if (cameras.includes(message.source)) {
        if (!message.zones || message.zones.length == 0) {
          this.log.debug('Notification for ' + message.source + ' is excluded because no zones are entered');
          return;
        }
      }
    }

    if (this.config.notificationActive) {
      let fileName = message.image;
      let type = 'photo';

      if (message.clip != null) {
        fileName = message.clip;
        type = 'video';
      }

      this.log.debug(
        `Notification score ${message.score} type ${message.type} state ${message.state} ${message.status} image/clip file: ${fileName} format ${type}`,
      );

      const notificationMinScoreState = await this.getStateAsync(message.source + '.remote.notificationMinScore');
      if (notificationMinScoreState && notificationMinScoreState.val) {
        if (notificationMinScoreState.val != null && notificationMinScoreState.val > 0 && message.score < notificationMinScoreState.val) {
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
      }

      this.log.debug(`Notification score ${message.score} is higher than ${this.config.notificationMinScore} type ${message.type}`);

      const sendInstances = this.config.notificationInstances.replace(/ /g, '').split(',');
      let sendUser = [];
      if (this.config.notificationUsers) {
        sendUser = this.config.notificationUsers.replace(/ /g, '').split(',');
      }

      let messageTextTemplate = this.config.notificationTextTemplate;
      const notificationTextState = await this.getStateAsync(message.source + '.remote.notificationText');
      if (notificationTextState && notificationTextState.val) {
        if (notificationTextState.val != null) {
          messageTextTemplate = notificationTextState.val.toString();
        }
      }

      let messageText = messageTextTemplate
        .replace(/{{source}}/g, message.source || '')
        .replace(/{{type}}/g, message.type || '')
        .replace(/{{state}}/g, message.state || '')
        .replace(/{{score}}/g, message.score || '')
        .replace(/{{status}}/g, message.status || '')
        .replace(/{{zones}}/g, message.zones || '');

      if (message.clipm3u8) {
        messageText = message.source + ': ' + message.clipm3u8 + '\n' + message.clipUrl;
        fileName = '';
        type = 'typing';
      }

      this.log.debug('Notification message ' + messageText + ' file ' + fileName + ' type ' + type);
      this.notificationsLog[message.id] = true;

      for (const sendInstance of sendInstances) {
        if (!sendInstance) {
          this.log.warn('No notification instance set');
          continue;
        }

        if (sendUser.length > 0) {
          for (const user of sendUser) {
            if (sendInstance.includes('pushover')) {
              if (type === 'video') {
                this.log.info('Pushover does not support video.');
                return;
              }

              await this.sendToAsync(sendInstance, {
                device: user,
                file: fileName,
                message: messageText,
              });
            } else if (sendInstance.includes('signal-cmb')) {
              await this.sendToAsync(sendInstance, 'send', {
                text: messageText,
                phone: user,
              });
            } else if (sendInstance.includes('mail')) {
              await this.sendToAsync(sendInstance, 'send', {
                subject: messageText,
                to: user,
                text: messageText,
                attachments: fileName ? [{ path: fileName }] : [],
              });
            } else {
              await this.sendToAsync(sendInstance, {
                user: user,
                message: fileName || messageText,
                text: fileName || messageText,
                type: type,
                caption: messageText,
                title: messageText,
              });
            }
          }
        } else {
          if (sendInstance.includes('pushover')) {
            if (type === 'video') {
              this.log.info('Pushover does not support video.');
              return;
            }

            await this.sendToAsync(sendInstance, {
              file: fileName,
              message: messageText,
            });
          } else if (sendInstance.includes('signal-cmb')) {
            await this.sendToAsync(sendInstance, 'send', {
              text: messageText,
            });
          } else if (sendInstance.includes('mail')) {
            await this.sendToAsync(sendInstance, 'send', {
              subject: messageText,
              text: messageText,
              attachments: fileName ? [{ path: fileName }] : [],
            });
          } else {
            await this.sendToAsync(sendInstance, {
              message: fileName || messageText,
              text: fileName || messageText,
              type: type,
              caption: messageText,
              title: messageText,
            });
          }
        }
      }
    }
  }

  // ----------------------------
  // onUnload
  // ----------------------------

  onUnload(callback) {
    try {
      try {
        if (this.useMqttServer()) server.close();
      } catch {
        // ignore
      }

      try {
        if (this.mqttClient) {
          this.mqttClient.end(true);
          this.mqttClient = null;
        }
      } catch {
        // ignore
      }

      callback();
    } catch (e) {
      this.log.error('Error onUnload: ' + e);
      callback();
    }
  }

  // ----------------------------
  // onStateChange (publish commands via server/client/both)
  // ----------------------------

  async onStateChange(id, state) {
    if (!state) return;

    if (!state.ack) {
      this.log.debug('state ' + id + ' changed: ' + state.val + ' (ack = ' + state.ack + ')');

      const prefix = this.getTopicPrefix();

      if (id.endsWith('_state')) {
        // remove adapter name and instance from id
        let shortId = id.replace(this.name + '.' + this.instance + '.', '');
        shortId = shortId.replace('_state', '');
        const idArray = shortId.split('.');
        const pathArray = [prefix, ...idArray, 'set'];
        const topic = pathArray.join('/');

        this.log.debug('publish sending to ' + topic + ' ' + state.val);
        await this.publishCommand(topic, String(state.val));
      }

      if (id.endsWith('remote.createEvent')) {
        const cameraId = id.split('.')[2];
        const label = state.val;
        let body = '';
        const createEventBodyState = await this.getStateAsync(id.replace('createEvent', 'createEventBody'));
        if (createEventBodyState && createEventBodyState.val) {
          try {
            body = JSON.parse(createEventBodyState.val);
          } catch (error) {
            this.log.error(
              'Cannot parse createEventBody. Please use valid JSON https://docs.frigate.video/integrations/api/#post-apieventscamera_namelabelcreate',
            );
            this.log.error(error);
          }
        }

        try {
          const res = await this.apiRequest({
            path: `/api/events/${cameraId}/${label}/create`,
            method: 'post',
            data: body || {},
          });

          if (res.status === 200) {
            this.log.info('Create event for ' + cameraId + ' with label ' + label);
            this.log.info(JSON.stringify(res.data));
          } else {
            this.log.warn(`Create event failed: HTTP ${res.status}`);
            res.data && this.log.debug(JSON.stringify(res.data).substring(0, 500));
          }
        } catch (error) {
          this.log.warn('createEvent error from ' + this.baseUrl + '/api/events');
          this.log.error(error);
        }
      }

      if (id.endsWith('remote.restart') && state.val) {
        await this.publishCommand(`${prefix}/restart`, '');
        this.log.info('published ' + `${prefix}/restart`);
      }

      if (id.endsWith('remote.ptz')) {
        const cameraId = id.split('.')[2];
        const command = state.val;
        await this.publishCommand(`${prefix}/${cameraId}/ptz`, String(command));
        this.log.info('published ' + `${prefix}/${cameraId}/ptz` + ' ' + command);
      }

      if (id.endsWith('remote.pauseNotificationsForTime')) {
        const pauseTime = state.val || 10;
        const pauseId = id.replace('pauseNotificationsForTime', 'pauseNotifications').replace(this.name + '.' + this.instance + '.', '');
        this.setState(pauseId, true, true);
        let deviceId = id.split('.')[0];
        if (deviceId === 'remote') {
          deviceId = 'all';
        }
        this.log.info('Pause ' + deviceId + ' notifications for ' + pauseTime + ' minutes');
        this.setTimeout(
          () => {
            this.setState(pauseId, false, true);
            this.log.info('Pause All notifications ended');
          },
          pauseTime * 60 * 1000,
        );
      }
    }
  }
}

if (require.main !== module) {
  module.exports = (options) => new Frigate(options);
} else {
  new Frigate();
}
