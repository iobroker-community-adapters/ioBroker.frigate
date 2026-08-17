import fs, { existsSync } from 'node:fs';
import https from 'node:https';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import { tmpdir, networkInterfaces } from 'node:os';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

import axios, { type AxiosInstance } from 'axios';
import { Aedes, type Client } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';

import { type AdapterOptions, Adapter, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';

import type { FrigateAdapterConfig, FrigateDockerManager, FrigateMessage, WebUrlReason } from './types.js';
import { createFrigateConfigFile } from './lib/utils.js';
import Json2iob from './lib/json2iob.js';
import { handleMqttMessage, type MessageHandlerContext } from './lib/messageHandler.js';
import { prepareEventNotification, sendNotification, type NotificationContext } from './lib/notifications.js';
import {
    fetchEventHistory,
    createCameraDevices,
    cleanTrackedObjects,
    handleTrackedObjectUpdate,
} from './lib/eventHistory.js';
import { handleStateChange } from './lib/stateHandler.js';
import { ZoneAggregator } from './lib/zoneAggregator.js';

class FrigateAdapter extends Adapter {
    declare config: FrigateAdapterConfig;
    private server!: Server;
    readonly requestClient: AxiosInstance;
    private json2iob: Json2iob;
    private tmpDir = join(tmpdir(), 'iobroker-frigate');
    private notificationMinScore: number | null = null;
    private firstStart = true;
    private deviceArray: string[] = [''];
    private notificationsLog: { [id: string]: boolean } = {};
    private trackedObjectsHistory: FrigateMessage[] = [];
    private notificationExcludeArray: string[] = [];
    private aedes!: Aedes;
    private mqttClient: MqttClient | null = null;
    private fetchEventHistoryTimeout: ioBroker.Timeout | undefined | null = null;
    private zoneAggregator: ZoneAggregator;
    frigateBaseUrl = '';

    constructor(options?: Partial<AdapterOptions>) {
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
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        this.json2iob = new Json2iob(this);
        this.zoneAggregator = new ZoneAggregator({ adapter: this });
        this.setupAuthInterceptor();
    }

    onReady = async (): Promise<void> => {
        await this.setStateAsync('info.connection', false, true);

        this.config.dockerFrigate ||= { enabled: false };
        this.config.dockerFrigate.port = parseInt((this.config.dockerFrigate.port || '5000') as string, 10) || 5000;
        this.config.dockerFrigate.shmSize = parseInt((this.config.dockerFrigate.shmSize || '256') as string, 10) || 256;
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
                        const obj = (await this.getForeignObjectAsync(`system.adapter.${instance}`)) as
                            | ioBroker.InstanceObject
                            | null
                            | undefined;
                        if (obj && obj.common.host !== ownHost) {
                            this.log.warn(
                                `Notification will not work, as the "${instance}" is running on different host ("${obj.common.host}") as frigate("${ownHost}"). Change the host of "${instance}" to "${ownHost}"`,
                            );
                        }
                    }
                }
            }
        }

        if (!this.config.friurl) {
            this.log.warn('No Frigate url set');
        }

        // Build base URL: user can prefix with https:// for TLS, otherwise http://
        if (this.config.friurl?.startsWith('http')) {
            this.frigateBaseUrl = this.config.friurl;
        } else {
            this.frigateBaseUrl = `http://${this.config.friurl}`;
        }

        if (this.config.frigateUsername && this.config.frigatePassword) {
            await this.loginToFrigate();
        } else if (this.config.friurl?.includes(':8971')) {
            this.log.warn(
                'Port 8971 requires authentication. Please enter Frigate username and password in the adapter settings.',
            );
        }
        this.config.notificationMinScore = parseFloat(this.config.notificationMinScore as string) || 0;
        this.config.notificationEventClipWaitTime =
            parseFloat(this.config.notificationEventClipWaitTime as string) || 5;
        this.config.webnum = parseInt(this.config.webnum as string, 10) || 5;
        this.config.mqttPort = parseInt((this.config.mqttPort || '1883') as string, 10) || 1883;
        this.config.mqttMode = this.config.mqttMode || 'broker';
        this.config.mqttTopicPrefix = this.config.mqttTopicPrefix || 'frigate';

        try {
            if (this.config.notificationMinScore) {
                this.notificationMinScore = this.config.notificationMinScore;
                if (this.notificationMinScore > 1) {
                    this.notificationMinScore = this.notificationMinScore / 100;
                    this.log.info(
                        `Notification min score is higher than 1. Recalculated to ${this.notificationMinScore}`,
                    );
                }
            }
        } catch (error) {
            this.log.error(error instanceof Error ? error.message : String(error));
        }

        if (this.config.notificationEventClipWaitTime < 1) {
            this.log.warn('Notification clip wait time is lower than 1. Set to 1');
            this.config.notificationEventClipWaitTime = 1;
        }
        if (this.config.notificationExcludeList) {
            this.notificationExcludeArray = this.config.notificationExcludeList.replace(/\s/g, '').split(',');
        }
        await fs.promises.mkdir(this.tmpDir, { recursive: true }).catch(() => {});
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
            } catch (error) {
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
        } else {
            this.initMqtt();
        }
    };

    private async setupDocker(): Promise<void> {
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
            let oldConfigFile: string | null = null;
            try {
                oldConfigFile = await fs.promises.readFile(configPath, 'utf-8');
            } catch {
                // File does not exist yet
            }
            if (oldConfigFile !== configFile) {
                await fs.promises.writeFile(configPath, configFile);
            }
            dockerManager?.instanceIsReady(oldConfigFile !== configFile);
        } catch (error) {
            this.log.error(
                `Cannot write Frigate config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async cleanOldObjects(): Promise<void> {
        await this.delObjectAsync('reviews.before.data.detections', { recursive: true });
        await this.delObjectAsync('reviews.after.data.detections', { recursive: true });
        const allObjects = await this.getObjectListAsync({
            startkey: `${this.namespace}.`,
            endkey: `${this.namespace}.\u9999`,
        });
        const dataFoldersToDelete = new Set<string>();
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
            } catch {
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

    private initMqtt(): void {
        this.server
            .listen(this.config.mqttPort, () => {
                this.log.info(`MQTT server started and listening on port ${this.config.mqttPort}`);
                this.log.info(
                    `Please enter host: '${this.host}' and port: '${this.config.mqttPort}' in frigate config`,
                );
                this.log.info("If you don't see a new client connected, please restart frigate and adapter.");
            })
            .once('error', err => {
                this.log.error(`MQTT server error: ${err}`);
                this.log.error(
                    `Please check if port ${this.config.mqttPort} is already in use. Use a different port in instance and frigate settings or restart ioBroker.`,
                );
                this.terminate();
            });

        this.aedes.on('client', async (client: Client): Promise<void> => {
            this.log.info(`New client: ${client.id}`);
            await this.setStateAsync('info.connection', true, true);
            this.aedes.publish(
                {
                    cmd: 'publish',
                    qos: 0,
                    topic: 'frigate/onConnect',
                    payload: Buffer.from(''),
                    retain: false,
                    dup: false,
                },
                err => {
                    if (err) {
                        this.log.error(`onConnect publish error: ${err}`);
                    } else {
                        this.log.info('Published frigate/onConnect to trigger camera_activity');
                    }
                },
            );
            await this.doFetchEventHistory();
        });

        this.aedes.on('clientDisconnect', async (client: Client): Promise<void> => {
            this.log.info(`client disconnected ${client.id}`);
            await this.setStateAsync('info.connection', false, true);
            await this.setStateAsync('available', 'offline', true);
        });

        this.aedes.on('publish', async (packet, client) => {
            if (packet.payload) {
                if (packet.topic === 'frigate/stats' || packet.topic.endsWith('snapshot')) {
                    this.log.silly(`publish ${packet.topic} ${packet.payload.toString()}`);
                } else {
                    this.log.debug(`publish ${packet.topic} ${packet.payload.toString()}`);
                }
            } else {
                this.log.debug(JSON.stringify(packet));
            }
            if (client) {
                await handleMqttMessage(this._msgCtx, packet.topic, Buffer.from(packet.payload));
            }
        });

        this.aedes.on('subscribe', (subscriptions, client) => {
            this.log.info(
                `MQTT client ${client ? client.id : client} subscribed to topics: ${subscriptions.map(s => s.topic).join('\n')} from broker ${this.aedes.id}`,
            );
        });
        this.aedes.on('unsubscribe', (subscriptions, client) =>
            this.log.info(
                `MQTT client ${client ? client.id : client} unsubscribed to topics: ${subscriptions.join('\n')} from broker ${this.aedes.id}`,
            ),
        );
        this.aedes.on('clientError', (client, err) =>
            this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`),
        );
        this.aedes.on('connectionError', (client, err) =>
            this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`),
        );
    }

    private initMqttClient(): void {
        if (!this.config.mqttHost) {
            this.log.error(
                'External MQTT broker host is not configured. Please set the MQTT host in the adapter settings.',
            );
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

        const mqttOptions: mqtt.IClientOptions = {
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
            this.mqttClient!.subscribe(`${prefix}/#`, err => {
                if (err) {
                    this.log.error(`Failed to subscribe to ${prefix}/#: ${err.message}`);
                } else {
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
        this.mqttClient.on('message', async (topic: string, payload: Buffer) => {
            if (payload) {
                if (topic === `${this.config.mqttTopicPrefix}/stats` || topic.endsWith('snapshot')) {
                    this.log.silly(`received ${topic} ${payload.toString()}`);
                } else {
                    this.log.debug(`received ${topic} ${payload.toString()}`);
                }
            }
            await handleMqttMessage(this._msgCtx, topic, payload);
        });
    }

    private publishMqtt(topic: string, payload: string | Buffer, callback?: (err?: Error) => void): void {
        if (this.config.mqttMode === 'client') {
            if (!this.mqttClient || !this.mqttClient.connected) {
                const err = new Error('External MQTT client is not connected');
                this.log.warn(`Cannot publish to "${topic}": ${err.message}`);
                callback?.(err);
                return;
            }
            this.mqttClient.publish(topic, payload, { qos: 0, retain: false }, err => callback?.(err || undefined));
        } else {
            this.aedes.publish(
                {
                    cmd: 'publish',
                    qos: 0,
                    topic,
                    payload: typeof payload === 'string' ? Buffer.from(payload) : payload,
                    retain: false,
                    dup: false,
                },
                err => callback?.(err || undefined),
            );
        }
    }

    // --- Cached context objects for extracted modules (avoid re-allocation per message) ---

    private _notifCtx!: NotificationContext;
    private _msgCtx!: MessageHandlerContext;

    private initContexts(): void {
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
            onEvent: async (data: FrigateMessage) => {
                await prepareEventNotification(this._notifCtx, data);
                await this.zoneAggregator.processEvent(data);
            },
            onTrackedObjectUpdate: async (data: FrigateMessage) => {
                this.trackedObjectsHistory = await handleTrackedObjectUpdate(this, this.trackedObjectsHistory, data);
            },
            debouncedFetchEventHistory: () => this.debouncedFetchEventHistory(),
            sendNotification: async msg => sendNotification(this._notifCtx, msg),
        };
        // Make firstStart a live reference to the adapter's property
        Object.defineProperty(this._msgCtx, 'firstStart', {
            get: () => this.firstStart,
        });
    }

    // --- Event History ---

    private debouncedFetchEventHistory(): void {
        if (this.fetchEventHistoryTimeout) {
            this.clearTimeout(this.fetchEventHistoryTimeout);
        }
        this.fetchEventHistoryTimeout = this.setTimeout(async () => {
            this.fetchEventHistoryTimeout = null;
            await this.doFetchEventHistory();
        }, 2000);
    }

    private async doFetchEventHistory(): Promise<void> {
        await fetchEventHistory({
            adapter: this,
            requestClient: this.requestClient,
            json2iob: this.json2iob,
            deviceArray: this.deviceArray,
        });
    }

    // --- Frigate API Authentication ---

    private async loginToFrigate(): Promise<boolean> {
        try {
            const url = `${this.frigateBaseUrl}/api/login`;
            this.log.info(`Logging in to Frigate API at ${url}`);
            const response = await this.requestClient.post(url, {
                user: this.config.frigateUsername,
                password: this.config.frigatePassword,
            });
            if (response.status === 200) {
                this.log.info('Successfully authenticated with Frigate API');
                // Extract Bearer token from cookie if available
                const cookies = response.headers['set-cookie'];
                if (cookies) {
                    for (const cookie of cookies) {
                        const match = cookie.match(/frigate_token=([^;]+)/);
                        if (match) {
                            this.requestClient.defaults.headers.common.Authorization = `Bearer ${match[1]}`;
                            this.log.debug('Set Bearer token from login response');
                        }
                    }
                }
                return true;
            }
            this.log.warn(`Frigate login returned status ${response.status}`);
            return false;
        } catch (error: any) {
            const msg = error instanceof Error ? error.message : String(error);
            if (error.response?.status === 401) {
                this.log.error('Frigate login failed: Invalid username or password');
            } else if (error.code === 'EPROTO' || msg.includes('SSL') || msg.includes('EPROTO')) {
                this.log.error(
                    `Frigate login failed: SSL/TLS error. Port 8971 requires https:// — change the URL to https://${this.config.friurl}`,
                );
            } else if (error.response?.status === 404 || error.response?.status === 400) {
                if (!this.frigateBaseUrl.startsWith('https')) {
                    this.log.error(
                        `Frigate login failed: Login not available at ${this.frigateBaseUrl}. Try adding https:// to the URL`,
                    );
                } else {
                    this.log.error(
                        `Frigate login failed: Login endpoint returned ${error.response.status} at ${this.frigateBaseUrl}`,
                    );
                }
            } else {
                this.log.error(`Frigate login failed: ${msg}`);
            }
            return false;
        }
    }

    private setupAuthInterceptor(): void {
        this.requestClient.interceptors.response.use(
            response => response,
            async error => {
                const originalRequest = error.config;
                if (
                    error.response?.status === 401 &&
                    !originalRequest._retry &&
                    this.config.frigateUsername &&
                    this.config.frigatePassword &&
                    !originalRequest.url?.includes('/api/login')
                ) {
                    originalRequest._retry = true;
                    this.log.debug('Received 401, attempting re-login to Frigate API');
                    const loggedIn = await this.loginToFrigate();
                    if (loggedIn) {
                        return this.requestClient(originalRequest);
                    }
                }
                throw error;
            },
        );
    }

    // --- Adapter lifecycle ---

    async sleep(ms: number): Promise<void> {
        return new Promise<void>(resolve => this.setTimeout(resolve, ms));
    }

    private static isIPv4(value: string): boolean {
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
    }

    private static ipv4ToInt(ip: string): number {
        return ip.split('.').reduce((acc, oct) => ((acc << 8) | parseInt(oct, 10)) >>> 0, 0) >>> 0;
    }

    /**
     * Pick the address a given browser can actually reach.
     *
     * The interfaces are passed in rather than read here, because the host in question is not always
     * our own: the web instance that serves the camera proxy may run somewhere else, and then its
     * addresses come from `system.host.<name>.native.hardware.networkInterfaces`.
     *
     * @param interfaces network interfaces of the host to choose from
     * @param browserIp IPv4 the browser used, already resolved
     * @returns the chosen address, or '' when the host has no usable IPv4
     */
    private static pickReachableIp(interfaces: ReturnType<typeof networkInterfaces>, browserIp: string): string {
        // Prefer the interface whose subnet contains the browser:
        // (interfaceIp & netmask) === (browserIp & netmask)
        if (FrigateAdapter.isIPv4(browserIp)) {
            const browserIpInt = FrigateAdapter.ipv4ToInt(browserIp);
            for (const name of Object.keys(interfaces)) {
                for (const info of interfaces[name] || []) {
                    if (info.family !== 'IPv4' || info.internal) {
                        continue;
                    }
                    const maskInt = FrigateAdapter.ipv4ToInt(info.netmask);
                    if ((FrigateAdapter.ipv4ToInt(info.address) & maskInt) === (browserIpInt & maskInt)) {
                        return info.address;
                    }
                }
            }
        }

        // Nothing in the browser's subnet - fall back to the first non-internal IPv4.
        for (const name of Object.keys(interfaces)) {
            for (const info of interfaces[name] || []) {
                if (info.family === 'IPv4' && !info.internal) {
                    return info.address;
                }
            }
        }

        return '';
    }

    /**
     * Resolve a hostname to an IPv4 address; returns the input unchanged when that is not possible.
     *
     * @param hostname hostname or address as the browser used it
     */
    private async resolveToIPv4(hostname: string): Promise<string> {
        if (FrigateAdapter.isIPv4(hostname)) {
            return hostname;
        }
        try {
            const result = await lookup(hostname, { family: 4 });
            return result.address;
        } catch (error) {
            this.log.debug(
                `DNS lookup for "${hostname}" failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return hostname;
        }
    }

    private async detectIpAddress(hostname: string): Promise<string> {
        const browserIp = await this.resolveToIPv4(hostname);
        if (!FrigateAdapter.isIPv4(browserIp)) {
            return hostname;
        }
        return FrigateAdapter.pickReachableIp(networkInterfaces(), browserIp) || hostname;
    }

    onMessage = (obj: ioBroker.Message): void => {
        if (obj?.command === 'showLink') {
            let data: { href: string; name: string } = { href: '', name: '' };
            // parse href
            if (typeof obj.message === 'string') {
                try {
                    data = JSON.parse(obj.message) as { href: string; name: string };
                } catch (error) {
                    this.log.error('Cannot parse config. Please use valid JSON');
                    this.log.error(error instanceof Error ? error.message : String(error));
                    this.sendTo(
                        obj.from,
                        obj.command,
                        { error: 'Cannot parse config. Please use valid JSON' },
                        obj.callback,
                    );
                    return;
                }
            } else {
                data = obj.message as { href: string; name: string };
            }
            try {
                const url = new URL(data.href);
                this.detectIpAddress(url.hostname)
                    .then(ip => {
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { text: `rtsp://${ip}:8554/${data.name}`, style: { color: 'blue' } },
                            obj.callback,
                        );
                    })
                    .catch(error => {
                        this.log.error('Failed to detect IP address for showLink');
                        this.log.error(error instanceof Error ? error.message : String(error));
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { text: `rtsp://${url.hostname}:8554/${data.name}`, style: { color: 'blue' } },
                            obj.callback,
                        );
                    });
            } catch (error) {
                this.log.error('Invalid URL in showLink command');
                this.log.error(error instanceof Error ? error.message : String(error));
                this.sendTo(obj.from, obj.command, { error: 'Invalid URL in showLink command' }, obj.callback);
                return;
            }
        } else if (obj?.command === 'readConfig') {
            this.log.info('readConfig command received');
            let config: FrigateAdapterConfig;
            if (typeof obj.message === 'string') {
                try {
                    config = JSON.parse(obj.message) as FrigateAdapterConfig;
                } catch (error) {
                    this.log.error('Cannot parse config. Please use valid JSON');
                    this.log.error(error instanceof Error ? error.message : String(error));
                    this.sendTo(
                        obj.from,
                        obj.command,
                        { error: 'Cannot parse config. Please use valid JSON' },
                        obj.callback,
                    );
                    return;
                }
            } else {
                config = obj.message as FrigateAdapterConfig;
            }
            this.sendTo(
                obj.from,
                obj.command,
                {
                    copyDialog: {
                        title: 'Current frigate config.yaml',
                        text: createFrigateConfigFile(config),
                        type: 'yaml',
                    },
                },
                obj.callback,
            );
        } else if (obj?.command === 'recreateContainer') {
            void this.recreateContainer(obj);
        } else if (obj?.command === 'restartContainer') {
            void this.restartContainer(obj);
        } else if (obj?.command === 'frigate:getCameras') {
            void this.sendCameraList(obj);
        } else if (obj?.command === 'frigate:getWebUrl') {
            void this.getWebUrl(obj);
        } else if (obj?.command === 'snapshot') {
            // Deliver a still image over the socket. The device manager widgets use this instead of the
            // HTTP route of the web adapter, because the Devices UI is normally served from admin (8081)
            // where /frigate.0/... does not exist.
            const message = (typeof obj.message === 'string' ? { camera: obj.message } : obj.message) as {
                camera?: string;
                height?: number | string;
                quality?: number | string;
                bbox?: boolean;
                timestamp?: boolean;
            };

            this.getSnapshot(message)
                .then(data => obj.callback && this.sendTo(obj.from, obj.command, data, obj.callback))
                .catch(
                    (e: unknown) =>
                        obj.callback &&
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { error: e instanceof Error ? e.message : String(e) },
                            obj.callback,
                        ),
                );
        }
    };

    /**
     * Read the current frame of one camera from Frigate and return it base64 encoded.
     *
     * Uses the authenticated client of the adapter, so it also works with the login on port 8971.
     *
     * @param message camera name plus the optional parameters of the Frigate endpoint
     */
    async getSnapshot(message: {
        camera?: string;
        height?: number | string;
        quality?: number | string;
        bbox?: boolean;
        timestamp?: boolean;
    }): Promise<{
        data: string;
        contentType: string;
    }> {
        const camera = message?.camera;
        // Camera names are configuration keys - refuse anything that could leave /api/<camera>/
        if (!camera || !/^[A-Za-z0-9_-]+$/.test(camera)) {
            throw new Error(`Invalid camera name: "${camera}"`);
        }
        if (!this.frigateBaseUrl) {
            throw new Error('No Frigate url set');
        }

        const params = new URLSearchParams();
        const height = parseInt(message.height as string, 10);
        const quality = parseInt(message.quality as string, 10);
        if (height) {
            params.append('height', String(height));
        }
        if (quality) {
            params.append('quality', String(quality));
        }
        // Let Frigate draw the detection boxes / the timestamp into the picture
        if (message.bbox) {
            params.append('bbox', '1');
        }
        if (message.timestamp) {
            params.append('timestamp', '1');
        }
        const query = params.toString();

        const response = await this.requestClient.get(
            `${this.frigateBaseUrl}/api/${camera}/latest.jpg${query ? `?${query}` : ''}`,
            { responseType: 'arraybuffer' },
        );

        return {
            data: Buffer.from(response.data as ArrayBuffer).toString('base64'),
            contentType: (response.headers['content-type'] as string) || 'image/jpeg',
        };
    }

    /**
     * Build the base URL of one web instance, as seen from the browser that asked.
     *
     * @param instance the web instance object
     * @param browserIp IPv4 the browser used, already resolved
     * @returns e.g. `http://192.168.1.5:8082`, or '' when the host has no reachable address
     */
    private async buildWebInstanceUrl(instance: ioBroker.InstanceObject, browserIp: string): Promise<string> {
        const native = (instance.native || {}) as {
            port?: number | string;
            secure?: boolean;
            bind?: string;
            publicUrl?: string;
        };

        // Someone who configured a public URL knows better than we can guess - it is the only value
        // that survives a reverse proxy or an external domain.
        if (native.publicUrl) {
            return native.publicUrl.replace(/\/+$/, '');
        }

        const scheme = native.secure ? 'https' : 'http';
        const port = parseInt(native.port as string, 10) || 8082;

        // A concrete bind address is the address the instance really answers on; only the
        // "listen everywhere" values leave the choice to us.
        let host = '';
        if (native.bind && native.bind !== '0.0.0.0' && native.bind !== '::') {
            host = native.bind;
        } else {
            const hostObj = await this.getForeignObjectAsync(`system.host.${instance.common.host}`);
            const interfaces = hostObj?.native?.hardware?.networkInterfaces;
            if (interfaces) {
                host = FrigateAdapter.pickReachableIp(interfaces, browserIp);
            }
            // Last resort: the host name itself, which at least resolves inside many LANs
            host ||= instance.common.host;
        }

        return host ? `${scheme}://${host}:${port}` : '';
    }

    /**
     * Work out where the camera proxy is reachable, so the Live widget does not have to be told by hand.
     *
     * The chain is the one the settings already describe: our own `native.webInstance` names the web
     * instance that loads the extension, that instance object says which host it runs on and on which
     * port, and the host object carries the network interfaces to pick an address from.
     *
     * @param obj the 'frigate:getWebUrl' message; `message.hostname` is the browser's own hostname
     */
    private async getWebUrl(obj: ioBroker.Message): Promise<void> {
        const route = (this.config.route || `${this.namespace}/`).replace(/^\/+/, '');
        // `reason` is a code the widget turns into a translated text; `detail` only reaches the log,
        // so its wording stays free to change
        const reply = (url: string, reason?: WebUrlReason, detail?: string): void => {
            if (detail) {
                this.log.debug(`Camera proxy not available (${reason}): ${detail}`);
            }
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { url, route, reason }, obj.callback);
            }
        };

        const message = (typeof obj.message === 'string' ? { hostname: obj.message } : obj.message || {}) as {
            hostname?: string;
        };

        try {
            const own = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
            const wanted = ((own?.native as { webInstance?: string })?.webInstance || '').trim();
            if (!wanted) {
                reply('', 'disabled');
                return;
            }

            const view = await this.getObjectViewAsync('system', 'instance', {
                startkey: 'system.adapter.web.',
                endkey: 'system.adapter.web.香',
            });

            const candidates = (view?.rows || [])
                .map(row => row.value)
                // The key range ends above '.', so adapters like "web2" fall into it as well - only
                // the name settles which rows are really web instances
                .filter(
                    (instance): instance is ioBroker.InstanceObject =>
                        instance?.common?.name === 'web' && !!instance.common.enabled,
                )
                .filter(instance => {
                    const namespace = instance._id.substring('system.adapter.'.length);
                    return wanted === '*' || wanted === namespace;
                })
                .sort((a, b) => a._id.localeCompare(b._id));

            if (!candidates.length) {
                reply(
                    '',
                    'noInstance',
                    wanted === '*'
                        ? 'No enabled web instance found'
                        : `Web instance "${wanted}" is not enabled or does not exist`,
                );
                return;
            }

            const browserIp = await this.resolveToIPv4(message.hostname || '');
            for (const instance of candidates) {
                const url = await this.buildWebInstanceUrl(instance, browserIp);
                if (url) {
                    this.log.debug(`Camera proxy of ${instance._id} resolved to ${url}/${route}`);
                    reply(url);
                    return;
                }
            }

            reply('', 'noAddress', 'The host of the web instance has no reachable address');
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.log.warn(`Cannot resolve the web URL: ${text}`);
            reply('', 'error', text);
        }
    }

    /**
     * Answer the camera drop-down of the device widgets, see `frigate:getCameras` in src-devices.
     *
     * The reply is the `{ value, label }` array a jsonConfig `selectSendTo` control expects. Three
     * sources are merged, because none of them alone covers every state the adapter can be in:
     * the cameras Frigate reported at startup, the cameras configured for the Docker container (which
     * exist before Frigate has ever answered), and the camera devices left in the object DB.
     *
     * @param obj the 'frigate:getCameras' message
     */
    private async sendCameraList(obj: ioBroker.Message): Promise<void> {
        const cameras = new Set<string>();

        for (const name of this.deviceArray) {
            if (name) {
                cameras.add(name);
            }
        }

        for (const camera of this.config.dockerFrigate?.cameras || []) {
            if (camera?.name) {
                cameras.add(camera.name);
            }
        }

        try {
            // Zones are devices at the very same level, so cameras are told apart by the name that
            // createCameraDevices() gives them ("Camera <key>" vs. the zones' "Zone <key>").
            const devices = await this.getDevicesAsync();
            for (const device of devices || []) {
                const name = typeof device.common?.name === 'string' ? device.common.name : '';
                if (name.startsWith('Camera ')) {
                    cameras.add(device._id.substring(this.namespace.length + 1));
                }
            }
        } catch (error) {
            this.log.warn(`Cannot read the camera devices: ${error instanceof Error ? error.message : String(error)}`);
        }

        const list = [...cameras].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }));
        this.log.debug(`Reporting ${list.length} camera(s) to ${obj.from}`);

        if (obj.callback) {
            this.sendTo(obj.from, obj.command, list, obj.callback);
        }
    }

    /**
     * Look up the Docker manager and the container(s) that belong to this instance.
     *
     * getDefaultContainerName() only returns the prefix (e.g. "iob_frigate_0"). The real container is named
     * "<prefix>_<service>" (e.g. "iob_frigate_0_frigate"), so the containers are resolved dynamically.
     *
     * @param obj The message that triggered the lookup - used to report errors back to the admin GUI
     * @returns The Docker manager together with the containers of this instance, or null if Docker is unavailable
     */
    private async getOwnContainers(obj: ioBroker.Message): Promise<{
        dockerManager: FrigateDockerManager;
        prefix: string;
        ownContainers: { id: string; names: string }[];
    } | null> {
        const dockerPlugin = this.getPluginInstance('docker');
        const dockerManager = dockerPlugin?.getDockerManager?.() as FrigateDockerManager | undefined;
        if (!dockerManager) {
            this.sendTo(obj.from, obj.command, { error: 'Docker plugin is not available' }, obj.callback);
            return null;
        }
        const prefix = dockerManager.getDefaultContainerName();
        const containers = await dockerManager.containerList(true);
        const ownContainers = containers.filter(c => {
            const name = (c.names || '').replace(/^\//, '');
            return name === prefix || name.startsWith(`${prefix}_`);
        });

        return { dockerManager, prefix, ownContainers };
    }

    private async recreateContainer(obj: ioBroker.Message): Promise<void> {
        if (!this.config.dockerFrigate?.enabled) {
            this.sendTo(obj.from, obj.command, { error: 'Docker mode is not enabled for this instance' }, obj.callback);
            return;
        }
        try {
            const found = await this.getOwnContainers(obj);
            if (!found) {
                return;
            }
            const { dockerManager, prefix, ownContainers } = found;
            if (!ownContainers.length) {
                this.log.warn(
                    `No Frigate container found (prefix "${prefix}"). Restarting instance to (re-)create it...`,
                );
            }
            for (const container of ownContainers) {
                const name = (container.names || '').replace(/^\//, '') || container.id;
                this.log.info(`Removing Frigate container "${name}" on user request...`);
                await dockerManager.containerRemove(container.id);
            }
            this.log.info('Restarting instance to re-create the Frigate container...');
            this.sendTo(
                obj.from,
                obj.command,
                {
                    result: 'Frigate container deleted. The instance is restarting and will re-create the container.',
                },
                obj.callback,
            );
            // Give the message time to reach the admin GUI before the instance restarts
            this.setTimeout(() => this.restart(), 1500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(`Cannot re-create Frigate container: ${message}`);
            this.sendTo(obj.from, obj.command, { error: message }, obj.callback);
        }
    }

    /**
     * Restart the Frigate Docker container without deleting it and without restarting the adapter instance.
     *
     * @param obj The 'restartContainer' message from the admin GUI
     */
    private async restartContainer(obj: ioBroker.Message): Promise<void> {
        if (!this.config.dockerFrigate?.enabled) {
            this.sendTo(obj.from, obj.command, { error: 'Docker mode is not enabled for this instance' }, obj.callback);
            return;
        }
        try {
            const found = await this.getOwnContainers(obj);
            if (!found) {
                return;
            }
            const { dockerManager, prefix, ownContainers } = found;
            if (!ownContainers.length) {
                this.log.warn(`No Frigate container found (prefix "${prefix}"), nothing to restart.`);
                this.sendTo(
                    obj.from,
                    obj.command,
                    { error: 'No Frigate container found. Is the container already created?' },
                    obj.callback,
                );
                return;
            }
            for (const container of ownContainers) {
                const name = (container.names || '').replace(/^\//, '') || container.id;
                this.log.info(`Restarting Frigate container "${name}" on user request...`);
                await dockerManager.containerRestart(container.id);
            }
            this.sendTo(obj.from, obj.command, { result: 'Frigate container restarted.' }, obj.callback);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(`Cannot restart Frigate container: ${message}`);
            this.sendTo(obj.from, obj.command, { error: message }, obj.callback);
        }
    }

    onUnload = (callback: () => void): void => {
        try {
            if (this.mqttClient) {
                this.mqttClient.end(true, () => {
                    this.aedes?.close(() => this.server?.close(() => callback?.()));
                });
            } else {
                this.aedes?.close(() => this.server?.close(() => callback?.()));
            }
        } catch (e) {
            this.log.error(`Error onUnload: ${e}`);
            callback();
        }
    };

    onStateChange = async (id: string, state: ioBroker.State | null | undefined): Promise<void> => {
        await handleStateChange(
            {
                adapter: this,
                requestClient: this.requestClient,
                publishMqtt: (topic, payload, cb) => this.publishMqtt(topic, payload, cb),
            },
            id,
            state,
        );
    };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
    new FrigateAdapter();
}

export default function startAdapter(options?: Partial<AdapterOptions>): FrigateAdapter {
    return new FrigateAdapter(options);
}
