// @ts-nocheck
'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.1
 *
 * MQTT:
 * - server:   start local broker (aedes) and accept Frigate connections
 * - client:   connect to an external broker and subscribe to frigate/# (or prefix/#)
 * - both:     do both at the same time
 *
 * Required dependency (package.json):
 *   "mqtt": "^5.0.0"
 */

const utils = require('@iobroker/adapter-core');
const json2iob = require('json2iob');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { sep } = require('path');
const { tmpdir } = require('os');
// @ts-ignore
const axios = require('axios').default;

// MQTT server (local broker)
const aedes = require('aedes')();
const net = require('net');
const server = net.createServer(aedes.handle);

// MQTT client (external broker)
const mqtt = require('mqtt');

class Frigate extends utils.Adapter {
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
      timeout: 3 * 60 * 1000, // 3min client timeout
    });

    // Existing state / vars
    this.clientId = 'frigate';
    this.json2iob = new json2iob(this);
    this.tmpDir = tmpdir();
    this.notificationMinScore = null;
    this.firstStart = true;
    this.deviceArray = [''];
    this.notificationsLog = {};
    this.trackedObjectsHistory = [];

    // NEW: external MQTT client
    /** @type {import('mqtt').MqttClient | null} */
    this.mqttClient = null;
    this.mqttConnected = false;
    this.mqttSubPrefix = 'frigate'; // resolved in onReady
    this.localBrokerHasClient = false;

    // NEW: notification exclude array
    this.notificationExcludeArray = null;
  }

  // ------------------------------
  // Lifecycle
  // ------------------------------
  async onReady() {
    this.setState('info.connection', false, true);

    this.subscribeStates('*_state');
    this.subscribeStates('*.remote.*');
    this.subscribeStates('remote.*');

    if (!this.config.friurl) {
      this.log.warn('No Frigate url set');
    }
    if (this.config.friurl && this.config.friurl.includes(':8971')) {
      this.log.warn('You are using the UI port 8971. Please use the API port 5000');
    }

    // Parse config
    try {
      if (this.config.notificationMinScore) {
        this.notificationMinScore = parseFloat(this.config.notificationMinScore);
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

    // Clean old media
    if (this.config.notificationActive) {
      this.log.debug('Clean old images and clips');
      let count = 0;
      try {
        fs.readdirSync(this.tmpDir).forEach((file) => {
          if (file.endsWith('.jpg') || file.endsWith('.mp4')) {
            this.log.debug('Try to delete ' + file);
            fs.unlinkSync(this.tmpDir + sep + file);
            count++;
            this.log.debug('Deleted ' + file);
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

    // Base objects
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

    // MQTT mode selection: server | client | both
    const mode = (this.config.mqttMode || 'server').toString().toLowerCase();
    this.mqttSubPrefix = (this.config.mqttTopicPrefix || 'frigate').toString().replace(/\/+$/, '') || 'frigate';

    if (mode === 'server' || mode === 'both') {
      await this.initMqttServer();
    }
    if (mode === 'client' || mode === 'both') {
      await this.initMqttClient();
    }

    // If only server-mode, connection state will switch true only when Frigate connects
    // If client/both, connection state will switch true on broker connect
  }

  onUnload(callback) {
    try {
      // Close local broker server
      try {
        server.close();
      } catch {}
      try {
        aedes.close();
      } catch {}

      // Close external MQTT client
      if (this.mqttClient) {
        try {
          this.mqttClient.end(true);
        } catch {}
        this.mqttClient = null;
      }

      callback();
    } catch (e) {
      this.log.error('Error onUnload: ' + e);
      callback();
    }
  }

  // ------------------------------
  // MQTT server (Aedes) + MQTT client (external)
  // ------------------------------
  async initMqttServer() {
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
      this.log.info('New MQTT client (local broker): ' + client.id);
      this.clientId = client.id;
      this.localBrokerHasClient = true;
      this.updateConnectionState();
      this.fetchEventHistory();
    });

    aedes.on('clientDisconnect', (client) => {
      this.log.info('MQTT client disconnected (local broker): ' + client.id);
      this.localBrokerHasClient = false;
      this.updateConnectionState();
      this.setState('available', 'offline', true);
    });

    aedes.on('publish', async (packet, client) => {
      // Only process real client messages (ignore broker internal publishes)
      if (!client) return;
      await this.handleMqttMessage(packet.topic, packet.payload, client.id);
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
      this.log.warn('connection error: ' + client + ' ' + err.message + ' ' + err.stack);
    });
  }

  async initMqttClient() {
    const url = (this.config.mqttBrokerUrl || '').toString().trim();
    if (!url) {
      this.log.warn('mqttMode=client/both, but mqttBrokerUrl is empty');
      return;
    }

    const clientId =
      (this.config.mqttClientId && this.config.mqttClientId.toString().trim()) ||
      `iobroker-frigate-${this.instance}-${Math.random().toString(16).slice(2)}`;

    const rejectUnauthorized = this.config.mqttRejectUnauthorized !== false; // default true
    const options = {
      clientId,
      username: this.config.mqttUsername ? this.config.mqttUsername.toString() : undefined,
      password: this.config.mqttPassword ? this.config.mqttPassword.toString() : undefined,
      reconnectPeriod: 5000,
      rejectUnauthorized,
    };

    this.log.info(`Connecting MQTT client to ${url} (clientId=${clientId})`);
    this.mqttClient = mqtt.connect(url, options);

    this.mqttClient.on('connect', () => {
      this.mqttConnected = true;
      this.updateConnectionState();
      this.log.info('MQTT client connected (external broker)');

      const prefix = (this.config.mqttTopicPrefix || 'frigate').toString().replace(/\/+$/, '') || 'frigate';
      this.mqttSubPrefix = prefix;
      const sub = `${prefix}/#`;

      this.mqttClient.subscribe(sub, { qos: 0 }, (err) => {
        if (err) this.log.warn(`MQTT subscribe error: ${err.message}`);
        else this.log.info(`Subscribed to ${sub}`);
      });

      this.fetchEventHistory();
    });

    this.mqttClient.on('reconnect', () => this.log.info('MQTT client reconnecting...'));

    this.mqttClient.on('close', () => {
      this.mqttConnected = false;
      this.updateConnectionState();
      this.log.info('MQTT client disconnected (external broker)');
    });

    this.mqttClient.on('error', (err) => {
      this.log.warn(`MQTT client error: ${err.message}`);
    });

    this.mqttClient.on('message', async (topic, payload) => {
      // Optional: if your broker uses a different prefix than "frigate", set mqttTopicPrefix accordingly.
      await this.handleMqttMessage(topic, payload, 'external');
    });
  }

  updateConnectionState() {
    // connection true if:
    // - local broker has a connected client (frigate), OR
    // - external mqtt client is connected
    const mode = (this.config.mqttMode || 'server').toString().toLowerCase();

    let connected = false;
    if (mode === 'server') connected = this.localBrokerHasClient;
    else if (mode === 'client') connected = this.mqttConnected;
    else if (mode === 'both') connected = this.localBrokerHasClient || this.mqttConnected;
    else connected = this.localBrokerHasClient || this.mqttConnected;

    this.setState('info.connection', connected, true);
  }

  publishMqtt(topic, payload) {
    const mode = (this.config.mqttMode || 'server').toString().toLowerCase();
    const msg = payload === undefined || payload === null ? '' : payload;

    // publish to local broker (server/both)
    if (mode === 'server' || mode === 'both') {
      aedes.publish(
        {
          cmd: 'publish',
          qos: 0,
          topic,
          payload: msg,
          retain: false,
        },
        (err) => {
          if (err) this.log.error(err);
        },
      );
    }

    // publish to external broker (client/both)
    if ((mode === 'client' || mode === 'both') && this.mqttClient && this.mqttConnected) {
      this.mqttClient.publish(topic, String(msg), { qos: 0, retain: false }, (err) => {
        if (err) this.log.warn(`MQTT client publish error: ${err.message}`);
      });
    }
  }

  // ------------------------------
  // Shared MQTT message handler (used by Aedes publish + external mqtt client)
  // ------------------------------
  async handleMqttMessage(topic, payload, clientId = 'external') {
    // payload can be Buffer
    const packet = {
      topic,
      payload: Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
    };

    if (packet.payload) {
      if (packet.topic === `${this.mqttSubPrefix}/stats` || packet.topic.endsWith('snapshot')) {
        this.log.silly('publish' + ' ' + packet.topic + ' ' + packet.payload.toString());
      } else {
        this.log.debug('publish' + ' ' + packet.topic + ' ' + packet.payload.toString());
      }
    } else {
      this.log.debug(JSON.stringify(packet));
    }

    try {
      let pathArray = packet.topic.split('/');
      let data = packet.payload.toString();
      let write = false;

      try {
        data = JSON.parse(data);
      } catch (error) {
        this.log.debug('Cannot parse ' + data + ' ' + error);
        // do nothing
      }

      // Expect prefix (default "frigate")
      if (pathArray[0] === this.mqttSubPrefix) {
        // remove prefix
        pathArray.shift();

        // Handle tracked_object_update events
        if (pathArray[0] === 'tracked_object_update') {
          await this.handleTrackedObjectUpdate(data);
          return;
        }

        // convert snapshot jpg to base64 with data url
        if (pathArray[pathArray.length - 1] === 'snapshot') {
          data = 'data:image/jpeg;base64,' + packet.payload.toString('base64');

          if (this.config.notificationCamera) {
            const uuid = uuidv4();
            const fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
            this.log.debug('Save ' + pathArray[pathArray.length - 1] + ' image to ' + fileName);
            fs.writeFileSync(fileName, packet.payload);
            await this.sendNotification({
              source: pathArray[0],
              type: pathArray[1],
              state: pathArray[pathArray.length - 1],
              image: fileName,
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
        }

        // if last path state then make it writable
        if (pathArray[pathArray.length - 1] === 'state') {
          write = true;
        }

        // events topic trigger history fetching
        if (pathArray[pathArray.length - 1] === 'events') {
          this.prepareEventNotification(data);
          this.fetchEventHistory();
        }

        // join every path item except the first one to create a flat hierarchy
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
          if (data?.after?.path_data) delete data.after.path_data;
          if (data?.before?.path_data) delete data.before.path_data;
          if (data?.after?.snapshot?.path_data) delete data.after.snapshot.path_data;
          if (data?.before?.snapshot?.path_data) delete data.before.snapshot.path_data;
          if (data?.history) {
            for (const item of data.history) {
              if (item?.path_data) delete item.path_data;
              if (item?.snapshot?.path_data) delete item.snapshot.path_data;
            }
          }
        }

        // create devices state for cameras
        if (pathArray[0] === 'stats') {
          if (data && data['cpu_usages']) delete data['cpu_usages'];
          this.createCameraDevices();
        }
      } else {
        // Not our prefix -> ignore
        return;
      }

      // parse json to iobroker states
      await this.json2iob.parse(pathArray.join('.'), data, { write: write });
    } catch (error) {
      this.log.warn(error);
    }
  }

  // ------------------------------
  // Cleanup helpers
  // ------------------------------
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
        // Extract parent data folder path (e.g., frigate.0.terasse.history.01.data)
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
        // Continue if deletion fails
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
      // Delete all existing tracked object entries (01-20)
      for (let i = 1; i <= 20; i++) {
        const paddedIndex = i.toString().padStart(2, '0');
        try {
          await this.delObjectAsync(`tracked_objects.${paddedIndex}`, { recursive: true });
        } catch {
          // Entry doesn't exist, continue
        }
      }

      // Also clean any other tracked object entries
      const objects = await this.getObjectListAsync({
        startkey: this.namespace + '.tracked_objects.',
        endkey: this.namespace + '.tracked_objects.\u9999',
      });

      for (const obj of objects.rows) {
        if (obj.id !== this.namespace + '.tracked_objects' && obj.id !== this.namespace + '.tracked_objects.history') {
          try {
            await this.delObjectAsync(obj.id.replace(this.namespace + '.', ''), { recursive: true });
          } catch {
            // Continue if deletion fails
          }
        }
      }

      // Reset the history array
      this.trackedObjectsHistory = [];
      this.log.info('Cleaned all tracked objects');
    } catch (error) {
      this.log.warn('Error cleaning tracked objects: ' + error.message);
    }
  }

  // ------------------------------
  // Tracked object updates
  // ------------------------------
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

  // ------------------------------
  // Frigate API parts (unchanged, still use http:// + friurl)
  // NOTE: If you also want HTTPS/8080 here, we can refactor to a baseUrl builder like discussed earlier.
  // ------------------------------
  async createCameraDevices() {
    if (this.firstStart) {
      this.log.info('Create Device information and fetch Event History');
      const data = await this.requestClient({
        url: 'http://' + this.config.friurl + '/api/config',
        method: 'get',
      })
        .then((response) => {
          this.log.debug(JSON.stringify(response.data));
          return response.data;
        })
        .catch((error) => {
          this.log.warn('createCameraDevices error from http://' + this.config.friurl + '/api/config');
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
          return;
        });

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
            common: { name: 'Pause Camera notifications', type: 'boolean', role: 'switch', def: false, read: true, write: true },
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
            common: { name: 'Overwrite the notification text', type: 'string', role: 'text', def: '', read: true, write: true },
            native: {},
          });

          await this.extendObjectAsync(key + '.remote.notificationMinScore', {
            type: 'state',
            common: { name: 'Overwrite notification min score', type: 'number', role: 'value', def: 0, read: true, write: true },
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
      let imageUrl = '';
      let fileName = '';
      if (data.before.has_snapshot) {
        imageUrl = `http://${this.config.friurl}/api/events/${data.before.id}/snapshot.jpg`;
      }
      if (data.after) {
        state = 'Event After';
        camera = data.after.camera;
        label = data.after.label;
        score = data.after.top_score;
        zones = data.after.entered_zones;
        if (data.after.has_snapshot) {
          imageUrl = `http://${this.config.friurl}/api/events/${data.after.id}/snapshot.jpg`;
        }
      }

      if (imageUrl) {
        const uuid = uuidv4();
        fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
        this.log.debug('create uuid image to ' + fileName);
        await this.requestClient({
          url: imageUrl,
          method: 'get',
          responseType: 'stream',
        })
          .then(async (response) => {
            if (response.data) {
              this.log.debug('new writer for ' + fileName);
              const writer = fs.createWriteStream(fileName);
              response.data.pipe(writer);
              await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
              }).catch((error) => this.log.error(error));
              this.log.debug('prepareEventNotification saved image to ' + fileName);
              return;
            }
            this.log.debug('prepareEventNotification no data from ' + imageUrl);
          })
          .catch((error) => {
            this.log.warn('prepareEventNotification error from ' + imageUrl);
            if (error.response && error.response.status >= 500) {
              this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
            }
            this.log.warn(error);
          });
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

    if (this.config.notificationEventClip || this.config.notificationEventClipLink) {
      if (data.type === 'end') {
        if (data.before && data.before.has_clip) {
          let fileName = '';
          let st = 'Event Before';
          score = data.before.top_score;
          zones = data.before.entered_zones;
          let clipUrl = `http://${this.config.friurl}/api/events/${data.before.id}/clip.mp4`;
          let clipm3u8 = `http://${this.config.friurl}/vod/event/${data.before.id}/master.m3u8`;

          if (data.after && data.after.has_clip) {
            st = 'Event After';
            score = data.after.top_score;
            zones = data.after.entered_zones;
            clipUrl = `http://${this.config.friurl}/api/events/${data.after.id}/clip.mp4`;
            clipm3u8 = `http://${this.config.friurl}/vod/event/${data.after.id}/master.m3u8`;
          }

          if (this.config.notificationEventClipLink) {
            this.sendNotification({
              source: camera,
              type: label,
              state: st,
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

            await this.requestClient({
              url: clipUrl,
              method: 'get',
              responseType: 'stream',
            })
              .then(async (response) => {
                if (response.data) {
                  const writer = fs.createWriteStream(fileName);
                  response.data.pipe(writer);
                  await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                  }).catch((error) => this.log.error(error));
                  this.log.debug('prepareEventNotification saved clip to ' + fileName);
                  return;
                }
                this.log.debug('prepareEventNotification no data from ' + clipUrl);
              })
              .catch((error) => {
                this.log.warn('prepareEventNotification error from ' + clipUrl);
                if (error.response && error.response.status >= 500) {
                  this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
                }
                this.log.warn(error);
              });

            await this.sendNotification({
              source: camera,
              type: label,
              state: st,
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

      await this.requestClient({
        url: 'http://' + this.config.friurl + '/api/events',
        method: 'get',
        params: params,
      })
        .then(async (response) => {
          if (response.data) {
            this.log.debug('fetchEventHistory succesfull ' + device);
            for (const event of response.data) {
              event.websnap = 'http://' + this.config.friurl + '/api/events/' + event.id + '/snapshot.jpg';
              event.webclip = 'http://' + this.config.friurl + '/api/events/' + event.id + '/clip.mp4';
              event.webm3u8 = 'http://' + this.config.friurl + '/vod/event/' + event.id + '/master.m3u8';
              event.thumbnail = 'data:image/jpeg;base64,' + event.thumbnail;
              delete event.path_data;
              if (event.data) delete event.data.path_data;
            }

            let path = 'events.history';
            if (device) path = device + '.history';

            this.json2iob.parse(path, response.data, { forceIndex: true, channelName: 'Events history' });
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
  }

  // ------------------------------
  // Notification (unchanged)
  // ------------------------------
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
          if (!excludeZones.includes(zone)) allExcluded = false;
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

      const sendInstances = this.config.notificationInstances.replace(/ /g, '').split(',');
      let sendUser = [];
      if (this.config.notificationUsers) {
        sendUser = this.config.notificationUsers.replace(/ /g, '').split(',');
      }

      let messageTextTemplate = this.config.notificationTextTemplate;
      const notificationTextState = await this.getStateAsync(message.source + '.remote.notificationText');
      if (notificationTextState && notificationTextState.val != null) {
        messageTextTemplate = notificationTextState.val.toString();
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
              await this.sendToAsync(sendInstance, { device: user, file: fileName, message: messageText });
            } else if (sendInstance.includes('signal-cmb')) {
              await this.sendToAsync(sendInstance, 'send', { text: messageText, phone: user });
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
            await this.sendToAsync(sendInstance, { file: fileName, message: messageText });
          } else if (sendInstance.includes('signal-cmb')) {
            await this.sendToAsync(sendInstance, 'send', { text: messageText });
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

  // ------------------------------
  // State changes -> publish MQTT
  // ------------------------------
  async onStateChange(id, state) {
    if (!state) return;

    if (!state.ack) {
      this.log.debug('state ' + id + ' changed: ' + state.val + ' (ack = ' + state.ack + ')');

      if (id.endsWith('_state')) {
        // remove adapter name and instance from id
        id = id.replace(this.name + '.' + this.instance + '.', '');
        id = id.replace('_state', '');
        const idArray = id.split('.');
        const pathArray = [this.mqttSubPrefix, ...idArray, 'set'];
        const topic = pathArray.join('/');

        this.log.debug('publish sending to ' + ' ' + topic + ' ' + state.val);
        this.publishMqtt(topic, state.val);
        this.log.info('published ' + topic + ' ' + state.val);
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

        this.requestClient({
          url: 'http://' + this.config.friurl + '/api/events/' + cameraId + '/' + label + '/create',
          method: 'post',
          data: body,
        })
          .then((response) => {
            this.log.info('Create event for ' + cameraId + ' with label ' + label);
            this.log.info(JSON.stringify(response.data));
          })
          .catch((error) => {
            this.log.warn('createEvent error from http://' + this.config.friurl + '/api/events');
            this.log.error(error);
          });
      }

      if (id.endsWith('remote.restart') && state.val) {
        const topic = `${this.mqttSubPrefix}/restart`;
        this.publishMqtt(topic, '');
        this.log.info('published ' + topic);
      }

      if (id.endsWith('remote.ptz')) {
        const cameraId = id.split('.')[2];
        const command = state.val;
        const topic = `${this.mqttSubPrefix}/${cameraId}/ptz`;
        this.publishMqtt(topic, command);
        this.log.info('published ' + topic + ' ' + command);
      }

      if (id.endsWith('remote.pauseNotificationsForTime')) {
        const pauseTime = state.val || 10;
        const pauseId = id.replace('pauseNotificationsForTime', 'pauseNotifications').replace(this.name + '.' + this.instance + '.', '');
        this.setState(pauseId, true, true);

        let deviceId = id.split('.')[0];
        if (deviceId === 'remote') deviceId = 'all';

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
