import fs, { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { Adapter, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';
import { createFrigateConfigFile } from './lib/utils.js';
import Json2iob from './lib/json2iob.js';
import { handleMqttMessage } from './lib/messageHandler.js';
import { prepareEventNotification, sendNotification } from './lib/notifications.js';
import { fetchEventHistory, createCameraDevices, cleanTrackedObjects, handleTrackedObjectUpdate, } from './lib/eventHistory.js';
import { handleStateChange } from './lib/stateHandler.js';
import { ZoneAggregator } from './lib/zoneAggregator.js';
class FrigateAdapter extends Adapter {
    server;
    requestClient;
    json2iob;
    tmpDir = join(tmpdir(), 'iobroker-frigate');
    notificationMinScore = null;
    firstStart = true;
    deviceArray = [''];
    notificationsLog = {};
    trackedObjectsHistory = [];
    notificationExcludeArray = [];
    aedes;
    mqttClient = null;
    fetchEventHistoryTimeout = null;
    zoneAggregator;
    constructor(options) {
        super({
            ...options,
            name: 'frigate',
        });
        this.on('ready', this.onReady);
        this.on('stateChange', this.onStateChange);
        this.on('unload', this.onUnload);
        this.on('message', this.onMessage);
        this.requestClient = axios.create({
            withCredentials: true,
            headers: {
                'User-Agent': 'ioBroker.frigate',
                accept: '*/*',
            },
            timeout: 3 * 60 * 1000,
        });
        this.json2iob = new Json2iob(this);
        this.zoneAggregator = new ZoneAggregator({ adapter: this });
    }
    onReady = async () => {
        await this.setStateAsync('info.connection', false, true);
        this.config.dockerFrigate ||= { enabled: false };
        this.config.dockerFrigate.port = parseInt((this.config.dockerFrigate.port || '5000'), 10) || 5000;
        this.config.dockerFrigate.shmSize = parseInt((this.config.dockerFrigate.shmSize || '256'), 10) || 256;
        if (this.config.dockerFrigate.location && !this.config.dockerFrigate.location.endsWith('/')) {
            this.config.dockerFrigate.location += '/';
        }
        if (this.config.dockerFrigate.enabled) {
            this.config.friurl = `${this.config.dockerFrigate.bind}:${this.config.dockerFrigate.port}`;
            if (this.config.notificationInstances?.replace(/ /g, '')) {
                const instances = this.config.notificationInstances.replace(/ /g, '').split(',');
                const ownHost = this.common?.host;
                if (ownHost) {
                    for (const instance of instances) {
                        const obj = (await this.getForeignObjectAsync(`system.adapter.${instance}`));
                        if (obj && obj.common.host !== ownHost) {
                            this.log.warn(`Notification will not work, as the "${instance}" is running on different host ("${obj.common.host}") as frigate("${ownHost}"). Change the host of "${instance}" to "${ownHost}"`);
                        }
                    }
                }
            }
        }
        if (!this.config.friurl) {
            this.log.warn('No Frigate url set');
        }
        else if (this.config.friurl.includes(':8971')) {
            this.log.warn('You are using the UI port 8971. Please use the API port 5000');
        }
        this.config.notificationMinScore = parseFloat(this.config.notificationMinScore) || 0;
        this.config.notificationEventClipWaitTime =
            parseFloat(this.config.notificationEventClipWaitTime) || 5;
        this.config.webnum = parseInt(this.config.webnum, 10) || 5;
        this.config.mqttPort = parseInt((this.config.mqttPort || '1883'), 10) || 1883;
        this.config.mqttMode = this.config.mqttMode || 'broker';
        this.config.mqttTopicPrefix = this.config.mqttTopicPrefix || 'frigate';
        try {
            if (this.config.notificationMinScore) {
                this.notificationMinScore = this.config.notificationMinScore;
                if (this.notificationMinScore > 1) {
                    this.notificationMinScore = this.notificationMinScore / 100;
                    this.log.info(`Notification min score is higher than 1. Recalculated to ${this.notificationMinScore}`);
                }
            }
        }
        catch (error) {
            this.log.error(error instanceof Error ? error.message : String(error));
        }
        if (this.config.notificationEventClipWaitTime < 1) {
            this.log.warn('Notification clip wait time is lower than 1. Set to 1');
            this.config.notificationEventClipWaitTime = 1;
        }
        if (this.config.notificationExcludeList) {
            this.notificationExcludeArray = this.config.notificationExcludeList.replace(/\s/g, '').split(',');
        }
        await fs.promises.mkdir(this.tmpDir, { recursive: true }).catch(() => { });
        if (this.config.notificationActive) {
            this.log.debug('Clean old images and clips');
            let count = 0;
            try {
                const files = await fs.promises.readdir(this.tmpDir);
                for (const file of files) {
                    if (file.endsWith('.jpg') || file.endsWith('.mp4')) {
                        this.log.debug(`Try to delete ${file}`);
                        await fs.promises.unlink(join(this.tmpDir, file));
                        count++;
                        this.log.debug(`Deleted ${file}`);
                    }
                }
                count && this.log.info(`Deleted ${count} old images and clips in tmp folder`);
            }
            catch (error) {
                this.log.warn('Cannot delete old images and clips');
                this.log.warn(error instanceof Error ? error.message : String(error));
            }
        }
        await this.cleanOldObjects();
        await cleanTrackedObjects(this);
        this.trackedObjectsHistory = [];
        this.subscribeStates('*_state');
        this.subscribeStates('*.remote.*');
        this.subscribeStates('remote.*');
        this.subscribeStates('notifications.*');
        if (this.config.dockerFrigate.enabled) {
            await this.setupDocker();
        }
        this.aedes = await Aedes.createBroker();
        this.server = createServer(this.aedes.handle);
        this.initContexts();
        if (this.config.mqttMode === 'client') {
            this.initMqttClient();
        }
        else {
            this.initMqtt();
        }
    };
    async setupDocker() {
        const dockerManager = this.getPluginInstance('docker');
        if (!this.config.dockerFrigate.location) {
            const dataDir = getAbsoluteDefaultDataDir();
            this.config.dockerFrigate.location = `${join(dataDir, this.namespace)}/`;
        }
        for (const subDir of ['config', 'recordings', 'clips']) {
            if (!existsSync(join(this.config.dockerFrigate.location, subDir))) {
                fs.mkdirSync(join(this.config.dockerFrigate.location, subDir), { recursive: true });
            }
        }
        const configFile = createFrigateConfigFile(this.config);
        const configPath = join(this.config.dockerFrigate.location, 'config', 'config.yml');
        try {
            let oldConfigFile = null;
            try {
                oldConfigFile = await fs.promises.readFile(configPath, 'utf-8');
            }
            catch {
                // File does not exist yet
            }
            if (oldConfigFile !== configFile) {
                await fs.promises.writeFile(configPath, configFile);
            }
            dockerManager?.instanceIsReady(oldConfigFile !== configFile);
        }
        catch (error) {
            this.log.error(`Cannot write Frigate config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async cleanOldObjects() {
        await this.delObjectAsync('reviews.before.data.detections', { recursive: true });
        await this.delObjectAsync('reviews.after.data.detections', { recursive: true });
        const allObjects = await this.getObjectListAsync({
            startkey: `${this.namespace}.`,
            endkey: `${this.namespace}.\u9999`,
        });
        const dataFoldersToDelete = new Set();
        for (const obj of allObjects.rows) {
            if (obj.id.includes('.path_data')) {
                const match = obj.id.match(/(.+\.history\.\d+\.data)/);
                if (match) {
                    dataFoldersToDelete.add(match[1].replace(`${this.namespace}.`, ''));
                }
            }
        }
        for (const dataFolder of dataFoldersToDelete) {
            try {
                await this.delObjectAsync(dataFolder, { recursive: true });
            }
            catch {
                // Continue if deletion fails
            }
        }
        // Migration script
        const remoteState = await this.getObjectAsync('lastidurl');
        if (remoteState) {
            this.log.info('clean old states ');
            await this.delObjectAsync('', { recursive: true });
            const obj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
            if (obj) {
                await this.setForeignObjectAsync(obj._id, obj);
            }
        }
    }
    // --- MQTT ---
    initMqtt() {
        this.server
            .listen(this.config.mqttPort, () => {
            this.log.info(`MQTT server started and listening on port ${this.config.mqttPort}`);
            this.log.info(`Please enter host: '${this.host}' and port: '${this.config.mqttPort}' in frigate config`);
            this.log.info("If you don't see a new client connected, please restart frigate and adapter.");
        })
            .once('error', err => {
            this.log.error(`MQTT server error: ${err}`);
            this.log.error(`Please check if port ${this.config.mqttPort} is already in use. Use a different port in instance and frigate settings or restart ioBroker.`);
            this.terminate();
        });
        this.aedes.on('client', async (client) => {
            this.log.info(`New client: ${client.id}`);
            await this.setStateAsync('info.connection', true, true);
            this.aedes.publish({
                cmd: 'publish',
                qos: 0,
                topic: 'frigate/onConnect',
                payload: Buffer.from(''),
                retain: false,
                dup: false,
            }, err => {
                if (err) {
                    this.log.error(`onConnect publish error: ${err}`);
                }
                else {
                    this.log.info('Published frigate/onConnect to trigger camera_activity');
                }
            });
            await this.doFetchEventHistory();
        });
        this.aedes.on('clientDisconnect', async (client) => {
            this.log.info(`client disconnected ${client.id}`);
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('available', 'offline', true);
        });
        this.aedes.on('publish', async (packet, client) => {
            if (packet.payload) {
                if (packet.topic === 'frigate/stats' || packet.topic.endsWith('snapshot')) {
                    this.log.silly(`publish ${packet.topic} ${packet.payload.toString()}`);
                }
                else {
                    this.log.debug(`publish ${packet.topic} ${packet.payload.toString()}`);
                }
            }
            else {
                this.log.debug(JSON.stringify(packet));
            }
            if (client) {
                await handleMqttMessage(this._msgCtx, packet.topic, Buffer.from(packet.payload));
            }
        });
        this.aedes.on('subscribe', (subscriptions, client) => {
            this.log.info(`MQTT client ${client ? client.id : client} subscribed to topics: ${subscriptions.map(s => s.topic).join('\n')} from broker ${this.aedes.id}`);
        });
        this.aedes.on('unsubscribe', (subscriptions, client) => this.log.info(`MQTT client ${client ? client.id : client} unsubscribed to topics: ${subscriptions.join('\n')} from broker ${this.aedes.id}`));
        this.aedes.on('clientError', (client, err) => this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`));
        this.aedes.on('connectionError', (client, err) => this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`));
    }
    initMqttClient() {
        if (!this.config.mqttHost) {
            this.log.error('External MQTT broker host is not configured. Please set the MQTT host in the adapter settings.');
            this.terminate();
            return;
        }
        let brokerUrl = this.config.mqttHost;
        if (!brokerUrl.includes('://')) {
            brokerUrl = `mqtt://${brokerUrl}`;
        }
        const urlWithoutProtocol = brokerUrl.replace(/^.*:\/\//, '');
        if (!urlWithoutProtocol.includes(':')) {
            brokerUrl = `${brokerUrl}:1883`;
        }
        const mqttOptions = {
            clientId: `iobroker_frigate_${this.instance}`,
            clean: true,
            reconnectPeriod: 5000,
        };
        if (this.config.mqttUsername) {
            mqttOptions.username = this.config.mqttUsername;
        }
        if (this.config.mqttPassword) {
            mqttOptions.password = this.config.mqttPassword;
        }
        this.log.info(`Connecting to external MQTT broker at ${brokerUrl}`);
        this.mqttClient = mqtt.connect(brokerUrl, mqttOptions);
        this.mqttClient.on('connect', async () => {
            this.log.info(`Connected to external MQTT broker at ${brokerUrl}`);
            await this.setStateAsync('info.connection', true, true);
            const prefix = this.config.mqttTopicPrefix;
            this.mqttClient.subscribe(`${prefix}/#`, err => {
                if (err) {
                    this.log.error(`Failed to subscribe to ${prefix}/#: ${err.message}`);
                }
                else {
                    this.log.info(`Subscribed to ${prefix}/#`);
                }
            });
            await this.doFetchEventHistory();
        });
        this.mqttClient.on('close', async () => {
            this.log.info('Disconnected from external MQTT broker');
            await this.setStateAsync('info.connection', false, true);
        });
        this.mqttClient.on('error', err => this.log.error(`MQTT client error: ${err.message}`));
        this.mqttClient.on('reconnect', () => this.log.debug('Reconnecting to external MQTT broker...'));
        this.mqttClient.on('message', async (topic, payload) => {
            if (payload) {
                if (topic === `${this.config.mqttTopicPrefix}/stats` || topic.endsWith('snapshot')) {
                    this.log.silly(`received ${topic} ${payload.toString()}`);
                }
                else {
                    this.log.debug(`received ${topic} ${payload.toString()}`);
                }
            }
            await handleMqttMessage(this._msgCtx, topic, payload);
        });
    }
    publishMqtt(topic, payload, callback) {
        if (this.config.mqttMode === 'client') {
            if (!this.mqttClient || !this.mqttClient.connected) {
                const err = new Error('External MQTT client is not connected');
                this.log.warn(`Cannot publish to "${topic}": ${err.message}`);
                callback?.(err);
                return;
            }
            this.mqttClient.publish(topic, payload, { qos: 0, retain: false }, err => callback?.(err || undefined));
        }
        else {
            this.aedes.publish({
                cmd: 'publish',
                qos: 0,
                topic,
                payload: typeof payload === 'string' ? Buffer.from(payload) : payload,
                retain: false,
                dup: false,
            }, err => callback?.(err || undefined));
        }
    }
    // --- Cached context objects for extracted modules (avoid re-allocation per message) ---
    _notifCtx;
    _msgCtx;
    initContexts() {
        this._notifCtx = {
            adapter: this,
            requestClient: this.requestClient,
            tmpDir: this.tmpDir,
            notificationMinScore: this.notificationMinScore,
            notificationsLog: this.notificationsLog,
            notificationExcludeArray: this.notificationExcludeArray,
        };
        this._msgCtx = {
            adapter: this,
            json2iob: this.json2iob,
            requestClient: this.requestClient,
            tmpDir: this.tmpDir,
            get firstStart() {
                return false;
            },
            onFirstStats: async () => {
                const configData = await createCameraDevices({
                    adapter: this,
                    requestClient: this.requestClient,
                    json2iob: this.json2iob,
                    deviceArray: this.deviceArray,
                });
                await this.zoneAggregator.initZones(configData);
                this.firstStart = false;
            },
            onEvent: async (data) => {
                await prepareEventNotification(this._notifCtx, data);
                await this.zoneAggregator.processEvent(data);
            },
            onTrackedObjectUpdate: async (data) => {
                this.trackedObjectsHistory = await handleTrackedObjectUpdate(this, this.trackedObjectsHistory, data);
            },
            debouncedFetchEventHistory: () => this.debouncedFetchEventHistory(),
            sendNotification: async (msg) => sendNotification(this._notifCtx, msg),
        };
        // Make firstStart a live reference to the adapter's property
        Object.defineProperty(this._msgCtx, 'firstStart', {
            get: () => this.firstStart,
        });
    }
    // --- Event History ---
    debouncedFetchEventHistory() {
        if (this.fetchEventHistoryTimeout) {
            this.clearTimeout(this.fetchEventHistoryTimeout);
        }
        this.fetchEventHistoryTimeout = this.setTimeout(async () => {
            this.fetchEventHistoryTimeout = null;
            await this.doFetchEventHistory();
        }, 2000);
    }
    async doFetchEventHistory() {
        await fetchEventHistory({
            adapter: this,
            requestClient: this.requestClient,
            json2iob: this.json2iob,
            deviceArray: this.deviceArray,
        });
    }
    // --- Adapter lifecycle ---
    async sleep(ms) {
        return new Promise(resolve => this.setTimeout(resolve, ms));
    }
    onMessage = (obj) => {
        if (obj?.command === 'readConfig') {
            this.log.info('readConfig command received');
            let config;
            if (typeof obj.message === 'string') {
                try {
                    config = JSON.parse(obj.message);
                }
                catch (error) {
                    this.log.error('Cannot parse config. Please use valid JSON');
                    this.log.error(error instanceof Error ? error.message : String(error));
                    this.sendTo(obj.from, obj.command, { error: 'Cannot parse config. Please use valid JSON' }, obj.callback);
                    return;
                }
            }
            else {
                config = obj.message;
            }
            this.sendTo(obj.from, obj.command, {
                copyDialog: {
                    title: 'Current frigate config.yaml',
                    text: createFrigateConfigFile(config),
                    type: 'yaml',
                },
            }, obj.callback);
        }
    };
    onUnload = (callback) => {
        try {
            if (this.mqttClient) {
                this.mqttClient.end(true, () => {
                    this.aedes?.close(() => this.server?.close(() => callback?.()));
                });
            }
            else {
                this.aedes?.close(() => this.server?.close(() => callback?.()));
            }
        }
        catch (e) {
            this.log.error(`Error onUnload: ${e}`);
            callback();
        }
    };
    onStateChange = async (id, state) => {
        await handleStateChange({
            adapter: this,
            requestClient: this.requestClient,
            publishMqtt: (topic, payload, cb) => this.publishMqtt(topic, payload, cb),
        }, id, state);
    };
}
const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
    new FrigateAdapter();
}
export default function startAdapter(options) {
    return new FrigateAdapter(options);
}
//# sourceMappingURL=main.js.map