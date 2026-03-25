import fs, { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';

import { v4 as UUID } from 'uuid';
import axios, { type AxiosInstance } from 'axios';
import Aedes, { type Client } from 'aedes';
import mqtt, { type MqttClient } from 'mqtt';

import { type AdapterOptions, Adapter, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';

import type { FrigateAdapterConfig } from './types';
import { createFrigateConfigFile } from './lib/utils';
import Json2iob from './lib/json2iob';

const ON_OFF_STATES = [
    'audio',
    'birdseye',
    'detect',
    'enabled',
    'improve_contrast',
    'motion',
    'object_descriptions',
    'ptz_autotracker',
    'recordings',
    'review_alerts',
    'review_descriptions',
    'review_detections',
    'snapshots',
];

type FrigateMessage = {
    timestamp?: number; // in seconds till 1970
    type: string;
    after: {
        id: string;
        camera: string;
        label: string;
        top_score: number;
        entered_zones: string[];
        data: {
            detections: any;
        };
        snapshot: {
            path_data?: string;
        };
        path_data?: string;
        has_snapshot?: boolean;
        has_clip?: boolean;
    };
    before: {
        id: string;
        camera: string;
        label: string;
        top_score: number;
        entered_zones: string[];
        data: {
            detections: any;
        };
        snapshot: {
            path_data?: string;
        };
        path_data?: string;
        has_snapshot?: boolean;
        has_clip?: boolean;
    };
    history: {
        path_data?: string;
        snapshot: {
            path_data?: string;
        };
    }[];
    cpu_usages: any;
};

class FrigateAdapter extends Adapter {
    declare config: FrigateAdapterConfig;
    private server: Server;
    private readonly requestClient: AxiosInstance;
    private json2iob: Json2iob;
    private tmpDir = tmpdir();
    private notificationMinScore: number | null = null;
    private firstStart = true;
    private deviceArray: string[] = [''];
    private notificationsLog: { [id: string]: boolean } = {};
    private trackedObjectsHistory: FrigateMessage[] = [];
    private notificationExcludeArray: string[] = [];
    private readonly aedes: Aedes;
    private mqttClient: MqttClient | null = null;

    constructor(options?: Partial<AdapterOptions>) {
        super({
            ...options,
            name: 'frigate',
        });
        this.aedes = new Aedes();
        this.server = createServer(this.aedes.handle);
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

            timeout: 3 * 60 * 1000, //3min client timeout
        });
        this.json2iob = new Json2iob(this);
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady = async (): Promise<void> => {
        await this.setStateAsync('info.connection', false, true);

        this.config.dockerFrigate ||= {
            enabled: false,
        };
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
                        // check for every instance if it runs on the same host
                        const obj: ioBroker.InstanceObject | null | undefined = (await this.getForeignObjectAsync(
                            `system.adapter.${instance}`,
                        )) as ioBroker.InstanceObject | null | undefined;
                        if (obj && obj?.common.host !== ownHost) {
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
        } else if (this.config.friurl.includes(':8971')) {
            this.log.warn('You are using the UI port 8971. Please use the API port 5000');
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
            this.log.error(error);
        }

        if (this.config.notificationEventClipWaitTime < 1) {
            this.log.warn('Notification clip wait time is lower than 1. Set to 1');
            this.config.notificationEventClipWaitTime = 1;
        }
        if (this.config.notificationExcludeList) {
            this.notificationExcludeArray = this.config.notificationExcludeList.replace(/\s/g, '').split(',');
        }
        if (this.config.notificationActive) {
            this.log.debug('Clean old images and clips');
            let count = 0;
            try {
                fs.readdirSync(this.tmpDir).forEach(file => {
                    if (file.endsWith('.jpg') || file.endsWith('.mp4')) {
                        this.log.debug(`Try to delete ${file}`);
                        fs.unlinkSync(this.tmpDir + sep + file);
                        count++;
                        this.log.debug(`Deleted ${file}`);
                    }
                });
                count && this.log.info(`Deleted ${count} old images and clips in tmp folder`);
            } catch (error) {
                this.log.warn('Cannot delete old images and clips');
                this.log.warn(error);
            }
        }

        await this.cleanOldObjects();
        await this.cleanTrackedObjects();

        this.subscribeStates('*_state');
        this.subscribeStates('*.remote.*');
        this.subscribeStates('remote.*');

        if (this.config.dockerFrigate.enabled) {
            const dockerManager = this.getPluginInstance('docker');
            // Create config for docker
            if (!this.config.dockerFrigate.location) {
                const dataDir = getAbsoluteDefaultDataDir();
                this.config.dockerFrigate.location = `${join(dataDir, this.namespace)}/`;
            }
            if (!existsSync(join(this.config.dockerFrigate.location, 'config'))) {
                fs.mkdirSync(join(this.config.dockerFrigate.location, 'config'), { recursive: true });
            }
            if (!existsSync(join(this.config.dockerFrigate.location, 'recordings'))) {
                fs.mkdirSync(join(this.config.dockerFrigate.location, 'recordings'), { recursive: true });
            }
            if (!existsSync(join(this.config.dockerFrigate.location, 'clips'))) {
                fs.mkdirSync(join(this.config.dockerFrigate.location, 'clips'), { recursive: true });
            }

            // Create a config file
            const configFile = createFrigateConfigFile(this.config);
            try {
                const oldConfigFile = fs.existsSync(join(this.config.dockerFrigate.location, 'config', 'config.yml'))
                    ? fs.readFileSync(join(this.config.dockerFrigate.location, 'config', 'config.yml'), 'utf-8')
                    : null;
                if (oldConfigFile !== configFile) {
                    fs.writeFileSync(join(this.config.dockerFrigate.location, 'config', 'config.yml'), configFile);
                }
                dockerManager?.instanceIsReady(oldConfigFile !== configFile);
            } catch (error) {
                this.log.error(
                    `Cannot write Frigate config file ${join(this.config.dockerFrigate.location, 'config', 'config.yml')}: ${error}`,
                );
            }
        }

        if (this.config.mqttMode === 'client') {
            this.initMqttClient();
        } else {
            this.initMqtt();
        }
    };

    async cleanOldObjects(): Promise<void> {
        await this.delObjectAsync('reviews.before.data.detections', { recursive: true });
        await this.delObjectAsync('reviews.after.data.detections', { recursive: true });
        // Clean path_data objects - find and delete parent data folder if path_data exists
        const allObjects = await this.getObjectListAsync({
            startkey: `${this.namespace}.`,
            endkey: `${this.namespace}.\u9999`,
        });
        const dataFoldersToDelete = new Set<string>();
        for (const obj of allObjects.rows) {
            if (obj.id.includes('.path_data')) {
                // Extract parent data folder path (e.g., frigate.0.terasse.history.01.data)
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
            // restart adapter to create all states from io-package.json
            const obj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
            if (obj) {
                await this.setForeignObjectAsync(obj._id, obj);
            }
        }
    }

    // Remove path_data and empty objects from the given object recursively
    static removePathData(obj: any): void {
        if (obj && typeof obj === 'object') {
            if (Array.isArray(obj)) {
                for (let i = obj.length - 1; i >= 0; i--) {
                    const item = obj[i];
                    if (item && typeof item === 'object' && Object.keys(item).length === 0) {
                        // Delete empty objects in arrays
                        obj.splice(i, 1);
                    } else if (item && typeof item === 'object') {
                        FrigateAdapter.removePathData(item);
                    }
                }
            } else {
                for (const key in obj) {
                    if (key === 'path_data' || key === 'gpu_usages') {
                        delete obj[key];
                    } else if (Array.isArray(obj[key]) && obj[key].length === 0) {
                        // Delete empty arrays
                        delete obj[key];
                    } else if (obj[key] && typeof obj[key] === 'object' && Object.keys(obj[key]).length === 0) {
                        // Delete empty objects
                        delete obj[key];
                    } else if (obj[key] === null || obj[key] === undefined) {
                        // Delete null or undefined values
                        delete obj[key];
                    } else {
                        FrigateAdapter.removePathData(obj[key]);
                    }
                }
            }
        }
    }

    async cleanTrackedObjects(): Promise<void> {
        this.log.info('Cleaning old tracked objects');
        try {
            // Clean any tracked object entries that might exist
            const objects = await this.getObjectListAsync({
                startkey: `${this.namespace}.tracked_objects.`,
                endkey: `${this.namespace}.tracked_objects.\u9999`,
            });

            for (const obj of objects.rows) {
                if (
                    obj.id !== `${this.namespace}.tracked_objects` &&
                    obj.id !== `${this.namespace}.tracked_objects.history`
                ) {
                    try {
                        await this.delObjectAsync(obj.id.replace(`${this.namespace}.`, ''), { recursive: true });
                    } catch {
                        // Continue if deletion fails
                    }
                }
            }

            // Reset the history array
            this.trackedObjectsHistory = [];
            this.log.info('Cleaned all tracked objects');
        } catch (error) {
            this.log.warn(`Error cleaning tracked objects: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    initMqtt(): void {
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
            this.log.info(`Filter for message from client: ${client.id}`);
            await this.setStateAsync('info.connection', true, true);
            // Trigger camera_activity from Frigate by publishing onConnect
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
            await this.fetchEventHistory();
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
                await this.handleMqttMessage(packet.topic, Buffer.from(packet.payload));
                try {
                    let pathArray = packet.topic.split('/');
                    const dataStr = packet.payload.toString();
                    let write = false;
                    let data: FrigateMessage | string | undefined | number | boolean;
                    if (pathArray[pathArray.length - 1] !== 'snapshot') {
                        if (
                            dataStr === 'ON' &&
                            (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                                pathArray[pathArray.length - 1] === 'motion')
                        ) {
                            data = true;
                        } else if (
                            dataStr === 'OFF' &&
                            (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                                pathArray[pathArray.length - 1] === 'motion')
                        ) {
                            data = false;
                        } else if (
                            !isNaN(Number(dataStr)) ||
                            dataStr.includes('"') ||
                            dataStr.includes('{') ||
                            dataStr.includes('[')
                        ) {
                            try {
                                data = JSON.parse(dataStr);
                            } catch (error) {
                                this.log.debug(`Cannot parse ${dataStr} ${error}`);
                                // do nothing
                            }
                        } else {
                            data = dataStr;
                        }
                    }

                    if (pathArray[0] === 'frigate') {
                        // remove the first element "frigate" from a path array
                        pathArray.shift();
                        const command: string = pathArray[0] as string;
                        const event = pathArray[pathArray.length - 1];

                        // Handle tracked_object_update events
                        if (command === 'tracked_object_update' && typeof data === 'object') {
                            await this.handleTrackedObjectUpdate(data);
                            return;
                        }

                        // Ignore path data for states because they can be very large and are not needed in ioBroker. They are only used to create the snapshot and event history images.
                        FrigateAdapter.removePathData(data);

                        // convert snapshot jpg to base64 with data url
                        if (event === 'snapshot') {
                            data = `data:image/jpeg;base64,${packet.payload.toString('base64')}`;

                            if (this.config.notificationCamera) {
                                const uuid = UUID();
                                const fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
                                this.log.debug(`Save ${event} image to ${fileName}`);
                                fs.writeFileSync(fileName, packet.payload);
                                await this.sendNotification({
                                    source: command,
                                    type: pathArray[1],
                                    state: event,
                                    image: fileName,
                                });
                                try {
                                    if (fileName) {
                                        this.log.debug(`Try to delete ${fileName}`);
                                        fs.unlinkSync(fileName);
                                        this.log.debug(`Deleted ${fileName}`);
                                    }
                                } catch (error) {
                                    this.log.error(error);
                                }
                            }
                        } else if (event === 'state') {
                            // if last path state then make it writable
                            write = true;
                        } else if (event === 'events' && typeof data === 'object') {
                            // events topic trigger history fetching
                            await this.prepareEventNotification(data);
                            await this.fetchEventHistory();
                            // if (data.before?.start_time) {
                            //   data.before.start_time = data.before.start_time.split('.')[0];
                            //   data.before.end_time = data.before.end_time.split('.')[0];
                            // }
                            // if (data.after?.start_time) {
                            //   data.after.start_time = data.after.start_time.split('.')[0];
                            //   data.after.end_time = data.after.end_time.split('.')[0];
                            // }
                        } else if (command === 'reviews' && typeof data === 'object') {
                            delete data.after.data.detections;
                            delete data.before.data.detections;
                        } else if (command === 'events' && typeof data === 'object') {
                            delete data.after.path_data;
                            delete data.before.path_data;
                            if (data.after.snapshot && typeof data === 'object') {
                                delete data.after.snapshot.path_data;
                            }
                            if (data.before.snapshot) {
                                delete data.before.snapshot.path_data;
                            }
                            if (data.history) {
                                for (const item of data.history) {
                                    delete item.path_data;
                                    if (item.snapshot) {
                                        delete item.snapshot.path_data;
                                    }
                                }
                            }
                        } else if (command === 'stats' && typeof data === 'object') {
                            // create devices state for cameras
                            delete data.cpu_usages;

                            await this.createCameraDevices();
                        }

                        if (
                            command !== 'stats' &&
                            command !== 'events' &&
                            command !== 'available' &&
                            command !== 'reviews' &&
                            command !== 'camera_activity' &&
                            pathArray.length > 1
                        ) {
                            // join every path item except the first one to create a flat hierarchy
                            const cameraId = pathArray.shift() || '';
                            pathArray = [cameraId, pathArray.join('_')];
                        }
                    }

                    // parse json to iobroker states
                    await this.json2iob.parse(pathArray.join('.'), data === undefined ? dataStr : data, {
                        write,
                        states: {
                            birdseye_mode_state: {
                                OBJECTS: 'objects',
                                CONTINUOUS: 'continuous',
                                MOTION: 'motion',
                            },
                            review_status: {
                                NONE: 'none',
                                DETECTION: 'detection',
                                ALERT: 'alert',
                            },
                        },
                    });
                } catch (error) {
                    this.log.warn(error);
                }
            }
        });
        this.aedes.on('subscribe', (subscriptions, client) => {
            this.log.info(
                `MQTT client \x1b[32m${client ? client.id : client}\x1b[0m subscribed to topics: ${subscriptions.map(s => s.topic).join('\n')} from broker ${this.aedes.id}`,
            );
        });
        this.aedes.on('unsubscribe', (subscriptions, client) =>
            this.log.info(
                `MQTT client \x1b[32m${client ? client.id : client}\x1b[0m unsubscribed to topics: ${subscriptions.join('\n')} from broker ${this.aedes.id}`,
            ),
        );

        this.aedes.on('clientError', (client, err) =>
            this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`),
        );

        this.aedes.on('connectionError', (client, err) =>
            this.log.warn(`client error: ${client.id} ${err.message} ${err.stack}`),
        );
    }

    initMqttClient(): void {
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
        // If no port specified in URL, append default MQTT port
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

            await this.fetchEventHistory();
        });

        this.mqttClient.on('close', async () => {
            this.log.info('Disconnected from external MQTT broker');
            await this.setStateAsync('info.connection', false, true);
        });

        this.mqttClient.on('error', err => {
            this.log.error(`MQTT client error: ${err.message}`);
        });

        this.mqttClient.on('reconnect', () => {
            this.log.debug('Reconnecting to external MQTT broker...');
        });

        this.mqttClient.on('message', async (topic: string, payload: Buffer) => {
            if (payload) {
                if (topic === `${this.config.mqttTopicPrefix}/stats` || topic.endsWith('snapshot')) {
                    this.log.silly(`received ${topic} ${payload.toString()}`);
                } else {
                    this.log.debug(`received ${topic} ${payload.toString()}`);
                }
            }

            await this.handleMqttMessage(topic, payload);
        });
    }

    /**
     * Publish an MQTT message via either the built-in broker or external client
     */
    private publishMqtt(topic: string, payload: string | Buffer, callback?: (err?: Error) => void): void {
        if (this.config.mqttMode === 'client') {
            if (!this.mqttClient || !this.mqttClient.connected) {
                const err = new Error('External MQTT client is not connected');
                this.log.warn(`Cannot publish to "${topic}": ${err.message}`);
                if (callback) {
                    callback(err);
                }
                return;
            }
            this.mqttClient.publish(topic, payload, { qos: 0, retain: false }, err => {
                if (callback) {
                    callback(err || undefined);
                }
            });
        } else {
            this.aedes.publish(
                {
                    cmd: 'publish',
                    qos: 0,
                    topic,
                    payload: Buffer.from(typeof payload === 'string' ? payload : payload),
                    retain: false,
                    dup: false,
                },
                err => {
                    if (callback) {
                        callback(err || undefined);
                    }
                },
            );
        }
    }

    /**
     * Shared handler for incoming MQTT messages from both built-in broker and external client
     */
    private async handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
        try {
            const prefix = this.config.mqttTopicPrefix || 'frigate';
            let pathArray = topic.split('/');
            const dataStr = payload.toString();
            let write = false;
            let data: FrigateMessage | string | undefined | number | boolean;
            if (pathArray[pathArray.length - 1] !== 'snapshot') {
                if (
                    dataStr === 'ON' &&
                    (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                        pathArray[pathArray.length - 1] === 'motion')
                ) {
                    data = true;
                } else if (
                    (dataStr === 'OFF' && ON_OFF_STATES.includes(pathArray[pathArray.length - 2])) ||
                    pathArray[pathArray.length - 1] === 'motion'
                ) {
                    data = false;
                } else if (
                    !isNaN(Number(dataStr)) ||
                    dataStr.includes('"') ||
                    dataStr.includes('{') ||
                    dataStr.includes('[')
                ) {
                    try {
                        data = JSON.parse(dataStr);
                    } catch (error) {
                        this.log.debug(`Cannot parse ${dataStr} ${error}`);
                        // do nothing
                    }
                } else {
                    data = dataStr;
                }
            }

            if (pathArray[0] === prefix) {
                // remove first element (topic prefix) from path array
                pathArray.shift();
                const command = pathArray[0];
                const event = pathArray[pathArray.length - 1];

                // Handle tracked_object_update events
                if (command === 'tracked_object_update' && typeof data === 'object') {
                    await this.handleTrackedObjectUpdate(data);
                    return;
                }

                // Ignore path data for states because they can be very large and are not needed in ioBroker. They are only used to create the snapshot and event history images.
                FrigateAdapter.removePathData(data);

                // convert snapshot jpg to base64 with data url
                if (event === 'snapshot') {
                    data = `data:image/jpeg;base64,${payload.toString('base64')}`;

                    if (this.config.notificationCamera) {
                        const uuid = UUID();
                        const fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
                        this.log.debug(`Save ${event} image to ${fileName}`);
                        fs.writeFileSync(fileName, payload);
                        await this.sendNotification({
                            source: command,
                            type: pathArray[1],
                            state: event,
                            image: fileName,
                        });
                        try {
                            if (fileName) {
                                this.log.debug(`Try to delete ${fileName}`);
                                fs.unlinkSync(fileName);
                                this.log.debug(`Deleted ${fileName}`);
                            }
                        } catch (error) {
                            this.log.error(error);
                        }
                    }
                } else if (event === 'state') {
                    // if last path state then make it writable
                    write = true;
                } else if (event === 'events' && typeof data === 'object') {
                    // events topic trigger history fetching
                    await this.prepareEventNotification(data);
                    await this.fetchEventHistory();
                } else if (command === 'reviews' && typeof data === 'object') {
                    delete data.after.data.detections;
                    delete data.before.data.detections;
                } else if (command === 'events' && typeof data === 'object') {
                    delete data.after.path_data;
                    delete data.before.path_data;
                    if (data.after.snapshot && typeof data === 'object') {
                        delete data.after.snapshot.path_data;
                    }
                    if (data.before.snapshot) {
                        delete data.before.snapshot.path_data;
                    }
                    if (data.history) {
                        for (const item of data.history) {
                            delete item.path_data;
                            if (item.snapshot) {
                                delete item.snapshot.path_data;
                            }
                        }
                    }
                } else if (command === 'stats' && typeof data === 'object') {
                    // create devices state for cameras
                    delete data.cpu_usages;

                    await this.createCameraDevices();
                }

                if (
                    command !== 'stats' &&
                    command !== 'events' &&
                    command !== 'available' &&
                    command !== 'reviews' &&
                    command !== 'camera_activity' &&
                    pathArray.length > 1
                ) {
                    // join every path item except the first one to create a flat hierarchy
                    const cameraId = pathArray.shift() || '';
                    pathArray = [cameraId, pathArray.join('_')];
                }
            }

            // parse json to iobroker states
            await this.json2iob.parse(pathArray.join('.'), data === undefined ? dataStr : data, {
                write,
                states: {
                    birdseye_mode_state: {
                        OBJECTS: 'objects',
                        CONTINUOUS: 'continuous',
                        MOTION: 'motion',
                    },
                    review_status: {
                        NONE: 'none',
                        DETECTION: 'detection',
                        ALERT: 'alert',
                    },
                },
            });
        } catch (error) {
            this.log.warn(error);
        }
    }

    /**
     * Handle tracked object update events using a JSON-based approach (last 10 updates)
     *
     * @param data - The parsed JSON data from MQTT
     */
    async handleTrackedObjectUpdate(data: FrigateMessage): Promise<void> {
        try {
            if (!data) {
                this.log.warn('Invalid tracked object update: no data');
                return;
            }

            this.log.debug(`Processing tracked object update: ${JSON.stringify(data).substring(0, 200)}...`);

            // Add a timestamp if not present
            data.timestamp ||= Date.now() / 1000;

            // Add the new update to the beginning of the array (latest first)
            this.trackedObjectsHistory.unshift(data);

            // Keep only the last 10 entries
            if (this.trackedObjectsHistory.length > 10) {
                this.trackedObjectsHistory = this.trackedObjectsHistory.slice(0, 10);
            }

            // Write the JSON array to the ioBroker state
            await this.setStateAsync('tracked_objects.history', JSON.stringify(this.trackedObjectsHistory), true);

            this.log.debug(
                `Stored tracked object update. History now contains ${this.trackedObjectsHistory.length} entries`,
            );
        } catch (error) {
            this.log.error(
                `Error handling tracked object update: ${error instanceof Error ? error.message : String(error)}`,
            );
            this.log.error(error instanceof Error ? (error.stack ?? '') : String(error));
        }
    }

    async createCameraDevices(): Promise<void> {
        if (this.firstStart) {
            this.log.info('Create Device information and fetch Event History');
            const data = await this.requestClient({
                url: `http://${this.config.friurl}/api/config`,
                method: 'get',
            })
                .then(response => {
                    this.log.debug(JSON.stringify(response.data));
                    return response.data;
                })
                .catch(error => {
                    this.log.warn(`createCameraDevices error from http://${this.config.friurl}/api/config`);
                    this.log.error(error);
                    error.response && this.log.error(JSON.stringify(error.response.data));
                });
            if (!data) {
                return;
            }

            if (data.cameras) {
                for (const key in data.cameras) {
                    this.deviceArray.push(key);
                    this.log.info(`Create device information for: ${key}`);
                    await this.extendObjectAsync(key, {
                        type: 'device',
                        common: {
                            name: `Camera ${key}`,
                        },
                        native: {},
                    });
                    await this.extendObjectAsync(`${key}.history`, {
                        type: 'channel',
                        common: {
                            name: 'Event History',
                        },
                        native: {},
                    });
                    await this.extendObjectAsync(`${key}.remote`, {
                        type: 'channel',
                        common: {
                            name: 'Control camera',
                        },
                        native: {},
                    });
                    await this.extendObjectAsync(`${key}.remote.createEvent`, {
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
                    await this.extendObjectAsync(`${key}.remote.createEventBody`, {
                        type: 'state',
                        common: {
                            name: 'Body for create Event',
                            type: 'string',
                            role: 'object',
                            def: `{}`,
                            read: true,
                            write: true,
                        },
                        native: {},
                    });
                    await this.extendObjectAsync(`${key}.remote.pauseNotifications`, {
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
                    await this.extendObjectAsync(`${key}.remote.pauseNotificationsForTime`, {
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
                    await this.extendObjectAsync(`${key}.remote.notificationText`, {
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
                    await this.extendObjectAsync(`${key}.remote.notificationMinScore`, {
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
                    await this.extendObjectAsync(`${key}.remote.ptz`, {
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
            this.log.info(`Fetch event history for ${this.deviceArray.length - 1} cameras`);
            await this.fetchEventHistory();
            this.firstStart = false;
            this.log.info('Device information created');
        }
    }

    async prepareEventNotification(data: FrigateMessage): Promise<void> {
        let state = 'Event Before';
        let camera = data.before.camera;
        let label = data.before.label;
        let score = data.before.top_score;
        let zones = data.before.entered_zones;
        const status = data.type;
        // check if only end events should be notified or start and update events
        if (
            (this.config.notificationEventSnapshot && status === 'end') ||
            (this.config.notificationEventSnapshotStart && status === 'new') ||
            (this.config.notificationEventSnapshotUpdate && status === 'update') ||
            (this.config.notificationEventSnapshotUpdateOnce &&
                status === 'update' &&
                !this.notificationsLog[data.before.id])
        ) {
            let imageUrl = '';
            let fileName = '';
            if (data.before.has_snapshot) {
                imageUrl = `http://${this.config.friurl}/api/events/${data.before.id}/snapshot.jpg`;
            }
            if (data.after) {
                // image = data.after.snapshot;
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
                const uuid = UUID();
                fileName = `${this.tmpDir}${sep}${uuid}.jpg`;
                this.log.debug(`create uuid image to ${fileName}`);
                await this.requestClient({
                    url: imageUrl,
                    method: 'get',
                    responseType: 'stream',
                })
                    .then(async response => {
                        if (response.data) {
                            this.log.debug(`new writer for ${fileName}`);
                            const writer = fs.createWriteStream(fileName);
                            await new Promise<void>((resolve, reject) => {
                                // Propagate errors from both the writable and readable streams
                                const onError: (error: Error) => void = (error: Error): void => reject(error);
                                writer.on('finish', () => {
                                    writer.removeListener('error', onError);
                                    // Ensure we also stop listening on the source stream
                                    response.data.removeListener('error', onError);
                                    resolve();
                                });
                                writer.on('error', onError);
                                // Handle errors from the source stream so they don't get dropped
                                response.data.on('error', onError);
                                response.data.pipe(writer);
                            }).catch(error => this.log.error(error));
                            this.log.debug(`prepareEventNotification saved image to ${fileName}`);
                            return;
                        }
                        this.log.debug(`prepareEventNotification no data from ${imageUrl}`);
                    })
                    .catch(error => {
                        this.log.warn(`prepareEventNotification error from ${imageUrl}`);
                        if (error.response && error.response.status >= 500) {
                            this.log.warn(
                                'Cannot reach server. You can ignore this after restarting the frigate server.',
                            );
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
                    state,
                    status,
                    image: fileName,
                    score,
                    zones,
                    id: data.before.id,
                });
            }
            try {
                if (fileName) {
                    this.log.debug(`Try to delete ${fileName}`);
                    fs.unlinkSync(fileName);
                    this.log.debug(`Deleted ${fileName}`);
                }
            } catch (error) {
                this.log.error(error);
            }
        }
        // check if the clip should be notified and the event is ended
        if (this.config.notificationEventClip || this.config.notificationEventClipLink) {
            if (data.type === 'end') {
                if (data.before?.has_clip) {
                    let fileName = '';
                    let state = 'Event Before';
                    score = data.before.top_score;
                    zones = data.before.entered_zones;
                    let clipUrl = `http://${this.config.friurl}/api/events/${data.before.id}/clip.mp4`;
                    let clipm3u8 = `http://${this.config.friurl}/vod/event/${data.before.id}/master.m3u8`;

                    if (data.after?.has_clip) {
                        state = 'Event After';
                        score = data.after.top_score;
                        zones = data.after.entered_zones;
                        clipUrl = `http://${this.config.friurl}/api/events/${data.after.id}/clip.mp4`;
                        clipm3u8 = `http://${this.config.friurl}/vod/event/${data.after.id}/master.m3u8`;
                    }
                    if (this.config.notificationEventClipLink) {
                        await this.sendNotification({
                            source: camera,
                            type: label,
                            state,
                            status,
                            clipUrl,
                            clipm3u8,
                            score,
                            zones,
                        });
                    }
                    if (this.config.notificationEventClip) {
                        const uuid = UUID();
                        fileName = `${this.tmpDir}${sep}${uuid}.mp4`;

                        this.log.debug(`Wait ${this.config.notificationEventClipWaitTime} seconds for clip`);
                        await this.sleep((this.config.notificationEventClipWaitTime as number) * 1000);
                        await this.requestClient({
                            url: clipUrl,
                            method: 'get',
                            responseType: 'stream',
                        })
                            .then(async response => {
                                if (response.data) {
                                    const writer = fs.createWriteStream(fileName);
                                    await new Promise<void>((resolve, reject) => {
                                        // Propagate errors from both the writable and readable streams
                                        const onError = (error: Error): void => {
                                            reject(error);
                                        };
                                        writer.on('finish', () => {
                                            writer.removeListener('error', onError);
                                            // Ensure we also stop listening on the source stream
                                            response.data.removeListener('error', onError);
                                            resolve();
                                        });
                                        writer.on('error', onError);
                                        // Handle errors from the source stream so they don't get dropped
                                        response.data.on('error', onError);
                                        response.data.pipe(writer);
                                    }).catch(error => {
                                        this.log.error(error);
                                    });
                                    this.log.debug(`prepareEventNotification saved clip to ${fileName}`);
                                    return;
                                }
                                this.log.debug(`prepareEventNotification no data from ${clipUrl}`);
                            })
                            .catch(error => {
                                this.log.warn(`prepareEventNotification error from ${clipUrl}`);
                                if (error.response && error.response.status >= 500) {
                                    this.log.warn(
                                        'Cannot reach server. You can ignore this after restarting the frigate server.',
                                    );
                                }
                                this.log.warn(error);
                            });

                        await this.sendNotification({
                            source: camera,
                            type: label,
                            state,
                            status,
                            clip: fileName,
                            score,
                            zones,
                        });
                        try {
                            if (fileName) {
                                this.log.debug(`Try to delete ${fileName}`);
                                fs.unlinkSync(fileName);
                                this.log.debug(`Deleted ${fileName}`);
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

    async sleep(ms: number): Promise<void> {
        return new Promise<void>(resolve => this.setTimeout(resolve, ms));
    }

    async fetchEventHistory(): Promise<void> {
        for (const device of this.deviceArray) {
            const params: {
                limit: number;
                cameras?: string;
            } = { limit: this.config.webnum as number };

            if (device) {
                params.cameras = device;
            }
            try {
                const response = await this.requestClient({
                    url: `http://${this.config.friurl}/api/events`,
                    method: 'get',
                    params,
                });
                if (response.data) {
                    this.log.debug(`fetchEventHistory successful ${device}`);

                    for (const event of response.data) {
                        event.websnap = `http://${this.config.friurl}/api/events/${event.id}/snapshot.jpg`;
                        event.webclip = `http://${this.config.friurl}/api/events/${event.id}/clip.mp4`;
                        event.webm3u8 = `http://${this.config.friurl}/vod/event/${event.id}/master.m3u8`;
                        event.thumbnail = `data:image/jpeg;base64,${event.thumbnail}`;
                        delete event.path_data;
                    }
                    let path = 'events.history';
                    if (device) {
                        path = `${device}.history`;
                    }
                    // Ignore path data for states because they can be very large and are not needed in ioBroker. They are only used to create the snapshot and event history images.
                    FrigateAdapter.removePathData(response.data);

                    await this.json2iob.parse(path, response.data, {
                        forceIndex: true,
                        channelName: 'Events history',
                    });
                    if (!device) {
                        await this.setStateAsync('events.history.json', JSON.stringify(response.data), true);
                    }
                }
            } catch (error) {
                this.log.warn(`fetchEventHistory error from http://${this.config.friurl}/api/events`);
                if (error.response && error.response.status >= 500) {
                    this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
                }
                this.log.warn(error);
            }
        }
    }

    async sendNotification(message: {
        source: string;
        type: string;
        state: string;
        status?: string;
        clip?: string;
        score?: number;
        zones?: string[];
        image?: string;
        clipm3u8?: string;
        clipUrl?: string;
        id?: string;
    }): Promise<void> {
        const pauseState = await this.getStateAsync('remote.pauseNotifications');
        if (pauseState?.val) {
            this.log.debug('Notifications paused');
            return;
        }
        const cameraPauseState = await this.getStateAsync(`${message.source}.remote.pauseNotifications`);
        if (cameraPauseState?.val) {
            this.log.debug(`Notifications paused for camera ${message.source}`);
            return;
        }

        if (this.notificationExcludeArray?.includes(message.source)) {
            this.log.debug(`Notification for ${message.source} is excluded`);
            return;
        }

        if (this.config.notificationExcludeZoneList) {
            const excludeZones = this.config.notificationExcludeZoneList.replace(/ /g, '').split(',');
            if (message.zones?.length) {
                // check if all zones are excluded
                let allExcluded = true;
                this.log.debug(
                    `Check if all zones are excluded ${message.zones.join(', ')} from ${excludeZones.join(', ')}`,
                );
                for (const zone of message.zones) {
                    if (!excludeZones.includes(zone)) {
                        allExcluded = false;
                    }
                }
                if (allExcluded) {
                    this.log.debug(`Notification for ${message.source} is excluded because all zones are excluded`);
                    return;
                }
            }
        }
        if (this.config.notificationExcludeEmptyZoneList) {
            const cameras = this.config.notificationExcludeEmptyZoneList.replace(/ /g, '').split(',');
            if (cameras.includes(message.source)) {
                if (!message.zones?.length) {
                    this.log.debug(`Notification for ${message.source} is excluded because no zones are entered`);
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
            const notificationMinScoreState = await this.getStateAsync(`${message.source}.remote.notificationMinScore`);
            if (notificationMinScoreState?.val) {
                if (
                    notificationMinScoreState.val &&
                    (message.score as number) < (notificationMinScoreState.val as number)
                ) {
                    this.log.info(
                        `Notification skipped score ${message.score} is lower than ${notificationMinScoreState.val} state  ${message.state} type ${message.type}`,
                    );
                    return;
                }
            } else if (
                message.score != null &&
                this.notificationMinScore &&
                message.score < this.notificationMinScore
            ) {
                this.log.info(
                    `Notification skipped score ${message.score} is lower than ${this.notificationMinScore} state  ${message.state} type ${message.type}`,
                );
                return;
            }
            this.log.debug(
                `Notification score ${message.score} is higher than ${this.notificationMinScore} type ${message.type}`,
            );

            const sendInstances = this.config.notificationInstances.replace(/ /g, '').split(',');
            let sendUser: string[] = [];
            if (this.config.notificationUsers) {
                sendUser = this.config.notificationUsers.replace(/ /g, '').split(',');
            }
            let messageTextTemplate = this.config.notificationTextTemplate;
            const notificationTextState = await this.getStateAsync(`${message.source}.remote.notificationText`);
            if (notificationTextState?.val) {
                messageTextTemplate = notificationTextState.val.toString();
            }
            let messageText = messageTextTemplate
                .replace(/{{source}}/g, message.source || '')
                .replace(/{{type}}/g, message.type || '')
                .replace(/{{state}}/g, message.state || '')
                .replace(/{{score}}/g, (message.score || 0).toString() || '')
                .replace(/{{status}}/g, message.status || '')
                .replace(/{{zones}}/g, (message.zones || [])?.join(', ') || '');
            if (message.clipm3u8) {
                // messageText = `${message.source}: [Clip Safari](${message.clipm3u8}) [Clip MP4](${message.clipUrl})`;
                messageText = `${message.source}: ${message.clipm3u8}\n${message.clipUrl}`;

                fileName = '';
                type = 'typing';
            }
            this.log.debug(`Notification message ${messageText} file ${fileName} type ${type}`);
            if (message.id) {
                this.notificationsLog[message.id] = true;
                const logKeys = Object.keys(this.notificationsLog);
                if (logKeys.length > 1000) {
                    for (const key of logKeys.slice(0, logKeys.length - 1000)) {
                        delete this.notificationsLog[key];
                    }
                }
            }
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
                                continue;
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
                                user,
                                message: fileName || messageText,
                                text: fileName || messageText,
                                type,
                                caption: messageText,
                                title: messageText,
                            });
                        }
                    }
                } else {
                    if (sendInstance.includes('pushover')) {
                        if (type === 'video') {
                            this.log.info('Pushover does not support video.');
                            continue;
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
                            type,
                            caption: messageText,
                            title: messageText,
                        });
                    }
                }
            }
        }
    }
    onMessage = (obj: ioBroker.Message): void => {
        if (obj) {
            if (obj.command === 'readConfig') {
                this.log.info('readConfig command received');
                let config: FrigateAdapterConfig;
                if (typeof obj.message === 'string') {
                    try {
                        config = JSON.parse(obj.message) as FrigateAdapterConfig;
                    } catch (error) {
                        this.log.error('Cannot parse config. Please use valid JSON');
                        this.log.error(error);
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
                const text = createFrigateConfigFile(config);
                this.sendTo(
                    obj.from,
                    obj.command,
                    {
                        copyDialog: {
                            title: 'Current frigate config.yaml',
                            text,
                            type: 'yaml',
                        },
                    },
                    obj.callback,
                );
            }
        }
    };

    /**
     * Is called when the adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload = (callback: () => void): void => {
        try {
            if (this.mqttClient) {
                this.mqttClient.end(true, () => {
                    // Also close the Aedes broker and server that were created in the constructor
                    this.aedes.close(() => this.server.close(() => callback?.()));
                });
            } else {
                this.aedes.close(() => this.server.close(() => callback?.()));
            }
        } catch (e) {
            this.log.error(`Error onUnload: ${e}`);
            callback();
        }
    };

    /**
     * Is called if a subscribed state changes
     */
    onStateChange = async (id: string, state: ioBroker.State | null | undefined): Promise<void> => {
        if (state) {
            if (!state.ack) {
                this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

                if (id.endsWith('_state')) {
                    // remove adapter name and instance from id
                    id = id.replace(`${this.namespace}.`, '');
                    id = id.replace('_state', '');
                    const idArray = id.split('.');
                    // If it is ON/OFF state
                    if (ON_OFF_STATES.includes(idArray[idArray.length - 1])) {
                        if (
                            state.val === 'true' ||
                            state.val === true ||
                            state.val === 'ON' ||
                            state.val === 'on' ||
                            state.val === '1' ||
                            state.val === 1
                        ) {
                            state.val = 'ON';
                        } else {
                            state.val = 'OFF';
                        }
                    }
                    const pathArray = [this.config.mqttTopicPrefix || 'frigate', ...idArray, 'set'];

                    const topic = pathArray.join('/');
                    this.log.debug(`publish sending to "${topic}" ${state.val}`);
                    this.publishMqtt(topic, String(state.val ?? ''), err => {
                        if (err) {
                            this.log.error(err.toString());
                        } else {
                            this.log.info(`published "${topic}" ${state.val}`);
                        }
                    });
                } else if (id.endsWith('remote.createEvent')) {
                    //remove adapter name and instance from id
                    const cameraId = id.split('.')[2];
                    const label = state.val;
                    let body = '';
                    const createEventBodyState = await this.getStateAsync(id.replace('createEvent', 'createEventBody'));
                    if (createEventBodyState?.val) {
                        try {
                            body = JSON.parse(createEventBodyState.val as string);
                        } catch (error) {
                            this.log.error(
                                'Cannot parse createEventBody. Please use valid JSON https://docs.frigate.video/integrations/api/#post-apieventscamera_namelabelcreate',
                            );
                            this.log.error(error);
                        }
                    }
                    const encodedCameraId = encodeURIComponent(cameraId);
                    const encodedLabel = encodeURIComponent(label != null ? label.toString() : '');
                    this.requestClient({
                        url: `http://${this.config.friurl}/api/events/${encodedCameraId}/${encodedLabel}/create`,
                        method: 'post',
                        data: body,
                    })
                        .then(response => {
                            this.log.info(`Create event for ${cameraId} with label ${label}`);
                            this.log.info(JSON.stringify(response.data));
                        })
                        .catch(error => {
                            this.log.warn(`createEvent error from http://${this.config.friurl}/api/events`);
                            this.log.error(error);
                        });
                } else if (id.endsWith('remote.restart') && state.val) {
                    const restartTopic = `${this.config.mqttTopicPrefix || 'frigate'}/restart`;
                    this.publishMqtt(restartTopic, '', err => {
                        if (err) {
                            this.log.error(err.toString());
                        } else {
                            this.log.info(`published ${restartTopic}`);
                        }
                    });
                } else if (id.endsWith('remote.ptz') && state.val !== null) {
                    //remove adapter name and instance from id
                    const cameraId = id.split('.')[2];
                    const command = state.val.toString();
                    const ptzTopic = `${this.config.mqttTopicPrefix || 'frigate'}/${cameraId}/ptz`;
                    this.publishMqtt(ptzTopic, command, err => {
                        if (err) {
                            this.log.error(err.toString());
                        } else {
                            this.log.info(`published ${ptzTopic} ${command}`);
                        }
                    });
                } else if (id.endsWith('remote.pauseNotificationsForTime')) {
                    const pauseTime = parseInt(state.val as string, 10) || 10;
                    const pauseId = id
                        .replace('pauseNotificationsForTime', 'pauseNotifications')
                        .replace(`${this.name}.${this.instance}.`, '');
                    await this.setStateAsync(pauseId, true, true);
                    let deviceId = id.split('.')[2];
                    if (deviceId === 'remote') {
                        deviceId = 'all';
                    }
                    this.log.info(`Pause ${deviceId} notifications for ${pauseTime} minutes`);
                    this.setTimeout(
                        async () => {
                            await this.setState(pauseId, false, true);
                            this.log.info('Pause All notifications ended');
                        },
                        pauseTime * 60 * 1000,
                    );
                }
            }
        } else {
            // The state was deleted
            // this.log.info(`state ${id} deleted`);
        }
    };
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new FrigateAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new FrigateAdapter())();
}
