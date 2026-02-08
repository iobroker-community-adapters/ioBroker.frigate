import fs, { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';

import Json2iob from 'json2iob';
import { v4 as UUID } from 'uuid';
import axios, { type AxiosInstance } from 'axios';
import Aedes, { type Client } from 'aedes';

import { type AdapterOptions, Adapter, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';

import type { FrigateAdapterConfig } from './types';

type FrigateMessage = {
    timestamp?: number; // in seconds till 1970
    type: string;
    after: {
        id: string;
        camera: string;
        label: string;
        top_score: number;
        entered_zones: string;
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
        entered_zones: string;
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
    private requestClient: AxiosInstance;
    private json2iob: Json2iob;
    private tmpDir = tmpdir();
    private notificationMinScore: number | null = null;
    private firstStart = true;
    private deviceArray: string[] = [''];
    private notificationsLog: { [id: string]: boolean } = {};
    private trackedObjectsHistory: FrigateMessage[] = [];
    private notificationExcludeArray: string[] = [];
    private aedes: Aedes;

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

    createFrigateConfigFile(): string {
        const text = `mqtt:
  host: 172.17.0.1
  port: ${this.config.mqttPort}

detectors:
  coral:
    type: edgetpu
    device: usb

face_recognition:
  enabled: true
  model_size: small        # Standard, läuft auf der Pi 5 CPU
  min_area: 400       # Mindestgröße des Gesichts in Pixeln

cameras:
  inner:
    ffmpeg:
      hwaccel_args: preset-rpi-64-h265
      inputs:
        - path: rtsp://admin:ioBroker_1@192.168.1.159:554/h264Preview_01_sub
          roles:
            - detect
            - record
    detect:
      width: 640
      height: 368
      fps: 5
      enabled: true

    snapshots:
      enabled: true
      timestamp: true        # Zeitstempel ins Bild drucken
      bounding_box: true     # Roten Kasten um die Person malen
      retain:
        default: 3           # Bilder 3 Tage aufheben

  cockpit:
    ffmpeg:
      hwaccel_args: preset-rpi-64-h265
      inputs:
        - path: rtsp://admin:ioBroker_1@192.168.1.224:554/h264Preview_01_sub
          roles:
            - detect
            - record
    detect:
      width: 1536
      height: 432
      fps: 5
      enabled: true

    snapshots:
      enabled: true
      timestamp: true        # Zeitstempel ins Bild drucken
      bounding_box: true     # Roten Kasten um die Person malen
      retain:
        default: 3           # Bilder 3 Tage aufheben

# Optionale globale Einstellungen
record:
  enabled: true
  retain:
    days: 3
detect:
  enabled: true
version: 0.16-0
`;
        return text;
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
        this.config.mqttPort = this.config.dockerFrigate.port;
        this.config.dockerFrigate.shmSize = parseInt((this.config.dockerFrigate.shmSize || '256') as string, 10) || 256;
        if (this.config.dockerFrigate.location && !this.config.dockerFrigate.location.endsWith('/')) {
            this.config.dockerFrigate.location += '/';
        }

        if (!this.config.friurl) {
            this.log.warn('No Frigate url set');
        }
        if (this.config.friurl.includes(':8971')) {
            this.log.warn('You are using the UI port 8971. Please use the API port 5000');
        }
        this.config.notificationMinScore = parseFloat(this.config.notificationMinScore as string) || 0;
        this.config.notificationEventClipWaitTime =
            parseFloat(this.config.notificationEventClipWaitTime as string) || 5;
        this.config.webnum = parseInt(this.config.webnum as string, 10) || 5;
        this.config.mqttPort = parseInt((this.config.mqttPort || '1883') as string, 10) || 1883;

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
            const dockerManager = this.getPluginInstance('docker')?.getDockerManager();
            // Create config for docker
            if (!this.config.dockerFrigate.location) {
                const dataDir = getAbsoluteDefaultDataDir();
                this.config.dockerFrigate.location = join(dataDir, this.namespace);
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

            // Create config file

            dockerManager?.instanceIsReady();
        }

        this.initMqtt();
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
                await this.setForeignObject(obj._id, obj);
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
            this.log.warn(`Error cleaning tracked objects: ${error.message}`);
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
            });

        this.aedes.on('client', async (client: Client): Promise<void> => {
            this.log.info(`New client: ${client.id}`);
            this.log.info(`Filter for message from client: ${client.id}`);
            await this.setStateAsync('info.connection', true, true);
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
                try {
                    let pathArray = packet.topic.split('/');
                    const dataStr = packet.payload.toString();
                    let write = false;
                    let data: FrigateMessage | string | undefined;
                    try {
                        data = JSON.parse(dataStr);
                    } catch (error) {
                        this.log.debug(`Cannot parse ${dataStr} ${error}`);
                        // do nothing
                    }
                    if (pathArray[0] === 'frigate') {
                        // remove first element
                        pathArray.shift();
                        const command: string = pathArray[0] as string;
                        const event = pathArray[pathArray.length - 1];

                        // Handle tracked_object_update events
                        if (command === 'tracked_object_update' && typeof data === 'object') {
                            await this.handleTrackedObjectUpdate(data);
                            return;
                        }

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
                    await this.json2iob.parse(pathArray.join('.'), data, { write });
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

    /**
     * Handle tracked object update events using JSON-based approach (last 10 updates)
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

            // Add timestamp if not present
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
            this.log.error(`Error handling tracked object update: ${error.message}`);
            this.log.error(error.stack);
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
                            role: 'json',
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
                            response.data.pipe(writer);
                            await new Promise<void>((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
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
                                    response.data.pipe(writer);
                                    await new Promise<void>((resolve, reject) => {
                                        writer.on('finish', resolve);
                                        writer.on('error', reject);
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
            await this.requestClient({
                url: `http://${this.config.friurl}/api/events`,
                method: 'get',
                params,
            })
                .then(async response => {
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
                        await this.json2iob.parse(path, response.data, {
                            forceIndex: true,
                            channelName: 'Events history',
                        });
                        await this.setStateAsync('events.history.json', JSON.stringify(response.data), true);
                    }
                })
                .catch(error => {
                    this.log.warn(`fetchEventHistory error from http://${this.config.friurl}/api/events`);
                    if (error.response && error.response.status >= 500) {
                        this.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
                    }
                    this.log.warn(error);
                });
        }
    }

    async sendNotification(message: {
        source: string;
        type: string;
        state: string;
        status?: string;
        clip?: string;
        score?: number;
        zones?: string;
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
                //check if all zones are excluded
                let allExcluded = true;
                this.log.debug(`Check if all zones are excluded ${message.zones} from ${excludeZones.join(', ')}`);
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
                if (!message.zones!.length) {
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
                message.score < (this.config.notificationMinScore as number)
            ) {
                this.log.info(
                    `Notification skipped score ${message.score} is lower than ${this.config.notificationMinScore} state  ${message.state} type ${message.type}`,
                );
                return;
            }
            this.log.debug(
                `Notification score ${message.score} is higher than ${this.config.notificationMinScore} type ${message.type}`,
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
                .replace(/{{zones}}/g, message.zones || '');
            if (message.clipm3u8) {
                // messageText = `${message.source}: [Clip Safari](${message.clipm3u8}) [Clip MP4](${message.clipUrl})`;
                messageText = `${message.source}: ${message.clipm3u8}\n${message.clipUrl}`;

                fileName = '';
                type = 'typing';
            }
            this.log.debug(`Notification message ${messageText} file ${fileName} type ${type}`);
            if (message.id) {
                this.notificationsLog[message.id] = true;
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
                            type,
                            caption: messageText,
                            title: messageText,
                        });
                    }
                }
            }
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload = (callback: () => void): void => {
        try {
            this.server.close(() => callback?.());
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
                    //remove adapter name and instance from id
                    id = id.replace(`${this.name}.${this.instance}.`, '');
                    id = id.replace('_state', '');
                    const idArray = id.split('.');
                    const pathArray = ['frigate', ...idArray, 'set'];

                    const topic = pathArray.join('/');
                    this.log.debug(`publish sending to "${topic}" ${state.val}`);
                    this.aedes.publish(
                        {
                            cmd: 'publish',
                            qos: 0,
                            topic,
                            payload: state.val as string,
                            retain: false,
                            dup: false,
                        },
                        err => {
                            if (err) {
                                this.log.error(err.toString());
                            } else {
                                this.log.info(`published "${topic}" ${state.val}`);
                            }
                        },
                    );
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
                    this.requestClient({
                        url: `http://${this.config.friurl}/api/events/${cameraId}/${label}/create`,
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
                    // remove adapter name and instance from id
                    this.aedes.publish(
                        {
                            cmd: 'publish',
                            qos: 0,
                            topic: `frigate/restart`,
                            retain: false,
                            dup: false,
                            payload: '',
                        },
                        err => {
                            if (err) {
                                this.log.error(err.toString());
                            } else {
                                this.log.info('published frigate/restart');
                            }
                        },
                    );
                } else if (id.endsWith('remote.ptz') && state.val !== null) {
                    //remove adapter name and instance from id
                    const cameraId = id.split('.')[2];
                    const command = state.val.toString();
                    this.aedes.publish(
                        {
                            cmd: 'publish',
                            qos: 0,
                            topic: `frigate/${cameraId}/ptz`,
                            payload: command,
                            retain: false,
                            dup: false,
                        },
                        err => {
                            if (err) {
                                this.log.error(err.toString());
                            } else {
                                this.log.info(`published frigate/${cameraId}/ptz ${command}`);
                            }
                        },
                    );
                } else if (id.endsWith('remote.pauseNotificationsForTime')) {
                    const pauseTime = parseInt(state.val as string, 10) || 10;
                    const pauseId = id
                        .replace('pauseNotificationsForTime', 'pauseNotifications')
                        .replace(`${this.name}.${this.instance}.`, '');
                    await this.setStateAsync(pauseId, true, true);
                    let deviceId = id.split('.')[0];
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
