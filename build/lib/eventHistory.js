import { removePathData } from './messageHandler.js';
export async function fetchEventHistory(ctx) {
    for (const device of ctx.deviceArray) {
        const params = { limit: ctx.adapter.config.webnum };
        if (device) {
            params.cameras = device;
        }
        try {
            const response = await ctx.requestClient({
                url: `${ctx.adapter.frigateBaseUrl}/api/events`,
                method: 'get',
                params,
            });
            if (response.data) {
                ctx.adapter.log.debug(`fetchEventHistory successful ${device}`);
                for (const event of response.data) {
                    event.websnap = `${ctx.adapter.frigateBaseUrl}/api/events/${event.id}/snapshot.jpg`;
                    event.webclip = `${ctx.adapter.frigateBaseUrl}/api/events/${event.id}/clip.mp4`;
                    event.webm3u8 = `${ctx.adapter.frigateBaseUrl}/vod/event/${event.id}/master.m3u8`;
                    event.thumbnail = `data:image/jpeg;base64,${event.thumbnail}`;
                    delete event.path_data;
                }
                let path = 'events.history';
                if (device) {
                    path = `${device}.history`;
                }
                removePathData(response.data);
                await ctx.json2iob.parse(path, response.data, {
                    forceIndex: true,
                    channelName: 'Events history',
                });
                if (!device) {
                    await ctx.adapter.setStateAsync('events.history.json', JSON.stringify(response.data), true);
                }
            }
        }
        catch (error) {
            ctx.adapter.log.warn(`fetchEventHistory error from ${ctx.adapter.frigateBaseUrl}/api/events`);
            if (error.response && error.response.status >= 500) {
                ctx.adapter.log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
            }
            ctx.adapter.log.warn(error instanceof Error ? error.message : String(error));
        }
    }
}
export async function createCameraDevices(ctx) {
    ctx.adapter.log.info('Create Device information and fetch Event History');
    const data = await ctx
        .requestClient({
        url: `${ctx.adapter.frigateBaseUrl}/api/config`,
        method: 'get',
    })
        .then(response => {
        ctx.adapter.log.debug(JSON.stringify(response.data));
        return response.data;
    })
        .catch(error => {
        ctx.adapter.log.warn(`createCameraDevices error from ${ctx.adapter.frigateBaseUrl}/api/config`);
        ctx.adapter.log.error(error instanceof Error ? error.message : String(error));
        error.response && ctx.adapter.log.error(JSON.stringify(error.response.data));
    });
    if (!data) {
        return;
    }
    if (data.cameras) {
        for (const key in data.cameras) {
            ctx.deviceArray.push(key);
            ctx.adapter.log.info(`Create device information for: ${key}`);
            await ctx.adapter.extendObjectAsync(key, {
                type: 'device',
                common: { name: `Camera ${key}` },
                native: {},
            });
            await ctx.adapter.extendObjectAsync(`${key}.history`, {
                type: 'channel',
                common: { name: 'Event History' },
                native: {},
            });
            await ctx.adapter.extendObjectAsync(`${key}.remote`, {
                type: 'channel',
                common: { name: 'Control camera' },
                native: {},
            });
            const remoteStates = [
                {
                    id: 'createEvent',
                    common: {
                        name: 'Create Event with label',
                        type: 'string',
                        role: 'text',
                        def: 'Label',
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'createEventBody',
                    common: {
                        name: 'Body for create Event',
                        type: 'string',
                        role: 'object',
                        def: '{}',
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'pauseNotifications',
                    common: {
                        name: 'Pause Camera notifications',
                        type: 'boolean',
                        role: 'switch',
                        def: false,
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'pauseNotificationsForTime',
                    common: {
                        name: 'Pause All notifications for time in minutes',
                        type: 'number',
                        role: 'value',
                        def: 10,
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'notificationText',
                    common: {
                        name: 'Overwrite the notification text',
                        type: 'string',
                        role: 'text',
                        def: '',
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'notificationMinScore',
                    common: {
                        name: 'Overwrite notification min score',
                        type: 'number',
                        role: 'value',
                        def: 0,
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'ptz',
                    common: {
                        name: 'Send PTZ commands preset_preset1, MOVE_LEFT, ZOOM_IN, STOP etc See docu',
                        desc: 'https://docs.frigate.video/integrations/mqtt/#frigatecamera_nameptz',
                        type: 'string',
                        role: 'text',
                        def: 'preset_preset1',
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'motionThreshold',
                    common: {
                        name: 'Motion detection threshold (1-255)',
                        type: 'number',
                        role: 'level',
                        def: 30,
                        min: 1,
                        max: 255,
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'motionContourArea',
                    common: {
                        name: 'Motion contour area minimum size',
                        type: 'number',
                        role: 'level',
                        def: 10,
                        min: 0,
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'birdseyeMode',
                    common: {
                        name: 'Birdseye viewing mode (objects, continuous, motion)',
                        type: 'string',
                        role: 'text',
                        def: 'objects',
                        states: { objects: 'objects', continuous: 'continuous', motion: 'motion' },
                        read: true,
                        write: true,
                    },
                },
                {
                    id: 'improveContrast',
                    common: {
                        name: 'Improve contrast for detection',
                        type: 'boolean',
                        role: 'switch',
                        def: false,
                        read: true,
                        write: true,
                    },
                },
            ];
            for (const s of remoteStates) {
                await ctx.adapter.extendObjectAsync(`${key}.remote.${s.id}`, {
                    type: 'state',
                    common: s.common,
                    native: {},
                });
            }
        }
    }
    else {
        ctx.adapter.log.warn('No cameras found');
        ctx.adapter.log.info(JSON.stringify(data));
    }
    ctx.adapter.log.info(`Fetch event history for ${ctx.deviceArray.length - 1} cameras`);
    await fetchEventHistory(ctx);
    ctx.adapter.log.info('Device information created');
    return data;
}
export async function cleanTrackedObjects(adapter) {
    adapter.log.info('Cleaning old tracked objects');
    try {
        const objects = await adapter.getObjectListAsync({
            startkey: `${adapter.namespace}.tracked_objects.`,
            endkey: `${adapter.namespace}.tracked_objects.\u9999`,
        });
        for (const obj of objects.rows) {
            if (obj.id !== `${adapter.namespace}.tracked_objects` &&
                obj.id !== `${adapter.namespace}.tracked_objects.history`) {
                try {
                    await adapter.delObjectAsync(obj.id.replace(`${adapter.namespace}.`, ''), { recursive: true });
                }
                catch {
                    // Continue if deletion fails
                }
            }
        }
        adapter.log.info('Cleaned all tracked objects');
    }
    catch (error) {
        adapter.log.warn(`Error cleaning tracked objects: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export async function handleTrackedObjectUpdate(adapter, trackedObjectsHistory, data) {
    try {
        if (!data) {
            adapter.log.warn('Invalid tracked object update: no data');
            return trackedObjectsHistory;
        }
        adapter.log.debug(`Processing tracked object update: ${JSON.stringify(data).substring(0, 200)}...`);
        data.timestamp ||= Date.now() / 1000;
        trackedObjectsHistory.unshift(data);
        if (trackedObjectsHistory.length > 10) {
            trackedObjectsHistory = trackedObjectsHistory.slice(0, 10);
        }
        await adapter.setStateAsync('tracked_objects.history', JSON.stringify(trackedObjectsHistory), true);
        adapter.log.debug(`Stored tracked object update. History now contains ${trackedObjectsHistory.length} entries`);
    }
    catch (error) {
        adapter.log.error(`Error handling tracked object update: ${error instanceof Error ? error.message : String(error)}`);
        adapter.log.error(error instanceof Error ? (error.stack ?? '') : String(error));
    }
    return trackedObjectsHistory;
}
//# sourceMappingURL=eventHistory.js.map