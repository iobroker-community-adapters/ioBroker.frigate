import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ON_OFF_STATES } from './constants.js';
import { STATS_DESCRIPTIONS, STATS_UNITS } from './statsMetadata.js';
/** Remove path_data, gpu_usages, empty objects/arrays, and null values recursively */
export function removePathData(obj) {
    if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) {
            for (let i = obj.length - 1; i >= 0; i--) {
                const item = obj[i];
                if (item && typeof item === 'object' && Object.keys(item).length === 0) {
                    obj.splice(i, 1);
                }
                else if (item && typeof item === 'object') {
                    removePathData(item);
                }
            }
        }
        else {
            for (const key in obj) {
                if (key === 'path_data' || key === 'gpu_usages') {
                    delete obj[key];
                }
                else if (Array.isArray(obj[key]) && obj[key].length === 0) {
                    delete obj[key];
                }
                else if (obj[key] && typeof obj[key] === 'object' && Object.keys(obj[key]).length === 0) {
                    delete obj[key];
                }
                else if (obj[key] === null || obj[key] === undefined) {
                    delete obj[key];
                }
                else {
                    removePathData(obj[key]);
                }
            }
        }
    }
}
export async function handleMqttMessage(ctx, topic, payload) {
    try {
        const prefix = ctx.adapter.config.mqttTopicPrefix || 'frigate';
        let pathArray = topic.split('/');
        const dataStr = payload.toString();
        let write = false;
        let data;
        if (pathArray[pathArray.length - 1] !== 'snapshot') {
            if (dataStr === 'ON' &&
                (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                    pathArray[pathArray.length - 1] === 'motion')) {
                data = true;
            }
            else if (dataStr === 'OFF' &&
                (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                    pathArray[pathArray.length - 1] === 'motion')) {
                data = false;
            }
            else if (!isNaN(Number(dataStr)) ||
                dataStr.includes('"') ||
                dataStr.includes('{') ||
                dataStr.includes('[')) {
                try {
                    data = JSON.parse(dataStr);
                }
                catch (error) {
                    ctx.adapter.log.debug(`Cannot parse ${dataStr} ${error}`);
                }
            }
            else {
                data = dataStr;
            }
        }
        if (pathArray[0] === prefix) {
            pathArray.shift();
            const command = pathArray[0];
            const event = pathArray[pathArray.length - 1];
            if (command === 'tracked_object_update' && typeof data === 'object') {
                await ctx.onTrackedObjectUpdate(data);
                return;
            }
            removePathData(data);
            if (event === 'snapshot') {
                data = `data:image/jpeg;base64,${payload.toString('base64')}`;
                if (ctx.adapter.config.notificationCamera) {
                    const fileName = join(ctx.tmpDir, `${randomUUID()}.jpg`);
                    ctx.adapter.log.debug(`Save ${event} image to ${fileName}`);
                    await fs.promises.writeFile(fileName, payload);
                    await ctx.sendNotification({
                        source: command,
                        type: pathArray[1],
                        state: event,
                        image: fileName,
                    });
                    try {
                        ctx.adapter.log.debug(`Try to delete ${fileName}`);
                        await fs.promises.unlink(fileName);
                        ctx.adapter.log.debug(`Deleted ${fileName}`);
                    }
                    catch (error) {
                        ctx.adapter.log.error(error instanceof Error ? error.message : String(error));
                    }
                }
            }
            else if (event === 'state') {
                write = true;
            }
            else if (event === 'events' && typeof data === 'object') {
                await ctx.onEvent(data);
                ctx.debouncedFetchEventHistory();
            }
            else if (command === 'reviews' && typeof data === 'object') {
                delete data.after.data.detections;
                delete data.before.data.detections;
            }
            else if (command === 'stats' && typeof data === 'object') {
                delete data.cpu_usages;
                if (ctx.firstStart) {
                    await ctx.onFirstStats();
                }
            }
            if (command !== 'stats' &&
                command !== 'events' &&
                command !== 'available' &&
                command !== 'reviews' &&
                command !== 'camera_activity' &&
                command !== 'notifications' &&
                pathArray.length > 1) {
                const cameraId = pathArray.shift() || '';
                pathArray = [cameraId, pathArray.join('_')];
            }
        }
        const path = pathArray.join('.');
        const value = data === undefined ? dataStr : data;
        if (path === 'stats' && typeof value === 'object') {
            await ctx.json2iob.parse(path, value, {
                descriptions: STATS_DESCRIPTIONS,
                units: STATS_UNITS,
            });
        }
        else {
            await ctx.json2iob.parse(path, value, {
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
        }
    }
    catch (error) {
        ctx.adapter.log.warn(error instanceof Error ? error.message : String(error));
    }
}
//# sourceMappingURL=messageHandler.js.map