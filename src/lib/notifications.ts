import fs from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AxiosInstance } from 'axios';
import type { FrigateAdapterConfig, FrigateMessage, NotificationMessage } from '../types.js';

/** Maximum number of characters read from an error body */
const MAX_ERROR_BODY = 4096;

export interface NotificationContext {
    adapter: ioBroker.Adapter & {
        config: FrigateAdapterConfig;
        frigateBaseUrl: string;
        sleep: (ms: number) => Promise<void>;
    };
    requestClient: AxiosInstance;
    tmpDir: string;
    notificationMinScore: number | null;
    notificationsLog: { [id: string]: boolean };
    notificationExcludeArray: string[];
}

/** Number of attempts for a clip download before giving up */
const CLIP_DOWNLOAD_ATTEMPTS = 3;

export interface DownloadResult {
    /** True if the file was written completely */
    ok: boolean;
    /** HTTP status of the failed response, if the server answered at all */
    status?: number;
    /** Error text of the server, if it sent one */
    message?: string;
    /** True if the same request can succeed a moment later */
    retryable: boolean;
}

/**
 * Read the error body of a failed request.
 * With `responseType: 'stream'` axios puts the body into a stream instead of parsing it, so the reason
 * the server gave (for Frigate a JSON object with a `message`) would be lost without reading it here.
 *
 * @param data body of the error response: a stream, a buffer, a string or an already parsed object
 */
async function readErrorBody(data: any): Promise<string> {
    if (!data) {
        return '';
    }
    if (typeof data === 'string') {
        return data.slice(0, MAX_ERROR_BODY);
    }
    if (Buffer.isBuffer(data)) {
        return data.toString('utf8').slice(0, MAX_ERROR_BODY);
    }
    if (typeof data.on !== 'function') {
        try {
            return JSON.stringify(data).slice(0, MAX_ERROR_BODY);
        } catch {
            return '';
        }
    }
    return new Promise<string>(resolve => {
        const chunks: string[] = [];
        let length = 0;
        const stop = (timer?: NodeJS.Timeout): void => {
            clearTimeout(timer);
            data.removeAllListeners?.('data');
            resolve(chunks.join('').slice(0, MAX_ERROR_BODY));
        };
        // Never block the notification flow if the server keeps the connection open
        const timeout = setTimeout(() => stop(), 5000);
        timeout.unref?.();
        const finish = (): void => stop(timeout);
        data.on('data', (chunk: Buffer) => {
            if (length < MAX_ERROR_BODY) {
                chunks.push(chunk.toString('utf8'));
                length += chunk.length;
            }
        });
        data.on('end', finish);
        data.on('error', finish);
    });
}

/**
 * Extract the readable reason out of an error body.
 * Frigate answers with `{"success": false, "message": "..."}`.
 *
 * @param body raw error body
 */
function parseErrorMessage(body: string): string {
    const text = body.trim();
    if (!text) {
        return '';
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.message === 'string') {
            return parsed.message;
        }
        if (typeof parsed === 'string') {
            return parsed;
        }
    } catch {
        // not JSON, use the raw text
    }
    return text;
}

/** Download an HTTP stream response to a local file */
async function downloadStreamToFile(
    requestClient: AxiosInstance,
    url: string,
    fileName: string,
    log: ioBroker.Logger,
): Promise<DownloadResult> {
    let writer: fs.WriteStream | null = null;
    try {
        const response = await requestClient({ url, method: 'get', responseType: 'stream' });
        if (!response.data) {
            log.debug(`No data from ${url}`);
            return { ok: false, retryable: true };
        }
        writer = fs.createWriteStream(fileName);
        const stream = writer;
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error): void => reject(error);
            stream.on('finish', () => {
                stream.removeListener('error', onError);
                response.data.removeListener('error', onError);
                resolve();
            });
            stream.on('error', onError);
            response.data.on('error', onError);
            response.data.pipe(stream);
        });
        log.debug(`Saved stream to ${fileName}`);
        return { ok: true, retryable: false };
    } catch (error: any) {
        const status: number | undefined = error.response?.status;
        const message = parseErrorMessage(await readErrorBody(error.response?.data));
        log.warn(`Download error from ${url}`);
        log.warn(
            [status ? `Status ${status}` : '', message, !status ? String(error.message || error) : '']
                .filter(part => part)
                .join(': '),
        );
        if (status && status >= 500) {
            log.warn('Cannot reach server. You can ignore this after restarting the frigate server.');
        }
        // createWriteStream created the file before the first chunk arrived, so a partial file has to be removed here
        if (writer) {
            writer.destroy();
            await fs.promises.unlink(fileName).catch(() => {});
        }
        // 400 is what Frigate answers while the recording segments of the event are not written yet,
        // and without a response the request never reached the server. Both can succeed on a retry.
        return { ok: false, status, message, retryable: !status || status === 400 || status >= 500 };
    }
}

/** Delete a temp file, logging any errors */
async function cleanupTempFile(fileName: string, log: ioBroker.Logger): Promise<void> {
    if (!fileName) {
        return;
    }
    try {
        log.debug(`Try to delete ${fileName}`);
        await fs.promises.unlink(fileName);
        log.debug(`Deleted ${fileName}`);
    } catch (error) {
        log.error(error instanceof Error ? error.message : String(error));
    }
}

/**
 * Download the clip of an event, retrying while Frigate reports that it cannot build it yet.
 * Frigate writes the recording segments of an event only after it has ended, and answers
 * `400 No recordings found for the specified time range` until they are on the disk.
 *
 * @param ctx notification context
 * @param clipUrl url of the clip
 * @param clipFileName local file to write the clip to
 */
async function downloadClipWithRetry(
    ctx: NotificationContext,
    clipUrl: string,
    clipFileName: string,
): Promise<boolean> {
    let waitTime = ((ctx.adapter.config.notificationEventClipWaitTime as number) || 10) * 1000;
    for (let attempt = 1; attempt <= CLIP_DOWNLOAD_ATTEMPTS; attempt++) {
        ctx.adapter.log.debug(`Wait ${waitTime / 1000} seconds for clip (attempt ${attempt})`);
        await ctx.adapter.sleep(waitTime);
        const result = await downloadStreamToFile(ctx.requestClient, clipUrl, clipFileName, ctx.adapter.log);
        if (result.ok) {
            return true;
        }
        if (!result.retryable || attempt === CLIP_DOWNLOAD_ATTEMPTS) {
            if (result.status === 400) {
                ctx.adapter.log.warn(
                    'Frigate has no recordings for this event. Increase "Wait time after Events end for Clip creation" or check the record settings of the camera in Frigate.',
                );
            }
            return false;
        }
        // Give Frigate more time on every attempt
        waitTime *= 2;
    }
    return false;
}

export async function prepareEventNotification(ctx: NotificationContext, data: FrigateMessage): Promise<void> {
    if (!ctx.adapter.config.notificationActive) {
        // Do not download images and clips that would only be deleted again by sendNotification
        return;
    }
    let state = 'Event Before';
    let camera = data.before.camera;
    let label = data.before.label;
    let score = data.before.top_score;
    let zones = data.before.entered_zones;
    const status = data.type;

    // Snapshot notification
    if (
        (ctx.adapter.config.notificationEventSnapshot && status === 'end') ||
        (ctx.adapter.config.notificationEventSnapshotStart && status === 'new') ||
        (ctx.adapter.config.notificationEventSnapshotUpdate && status === 'update') ||
        (ctx.adapter.config.notificationEventSnapshotUpdateOnce &&
            status === 'update' &&
            !ctx.notificationsLog[data.before.id])
    ) {
        let imageUrl = '';
        let fileName = '';
        if (data.before.has_snapshot) {
            imageUrl = `${ctx.adapter.frigateBaseUrl}/api/events/${data.before.id}/snapshot.jpg`;
        }
        if (data.after) {
            state = 'Event After';
            camera = data.after.camera;
            label = data.after.label;
            score = data.after.top_score;
            zones = data.after.entered_zones;
            if (data.after.has_snapshot) {
                imageUrl = `${ctx.adapter.frigateBaseUrl}/api/events/${data.after.id}/snapshot.jpg`;
            }
        }

        if (imageUrl) {
            fileName = join(ctx.tmpDir, `${randomUUID()}.jpg`);
            ctx.adapter.log.debug(`create uuid image to ${fileName}`);
            const downloaded = await downloadStreamToFile(ctx.requestClient, imageUrl, fileName, ctx.adapter.log);
            if (!downloaded.ok) {
                fileName = '';
            }
        } else {
            ctx.adapter.log.info(`Notification sending active but no image available for type ${label} state ${state}`);
        }

        if (fileName) {
            try {
                await sendNotification(ctx, {
                    source: camera,
                    type: label,
                    state,
                    status,
                    image: fileName,
                    score,
                    zones,
                    id: data.before.id,
                });
            } finally {
                await cleanupTempFile(fileName, ctx.adapter.log);
            }
        }
    }

    // Clip notification
    if (ctx.adapter.config.notificationEventClip || ctx.adapter.config.notificationEventClipLink) {
        if (data.type === 'end') {
            if (data.before?.has_clip) {
                let clipFileName = '';
                let clipState = 'Event Before';
                score = data.before.top_score;
                zones = data.before.entered_zones;
                let clipUrl = `${ctx.adapter.frigateBaseUrl}/api/events/${data.before.id}/clip.mp4`;
                let clipm3u8 = `${ctx.adapter.frigateBaseUrl}/vod/event/${data.before.id}/master.m3u8`;

                if (data.after?.has_clip) {
                    clipState = 'Event After';
                    score = data.after.top_score;
                    zones = data.after.entered_zones;
                    clipUrl = `${ctx.adapter.frigateBaseUrl}/api/events/${data.after.id}/clip.mp4`;
                    clipm3u8 = `${ctx.adapter.frigateBaseUrl}/vod/event/${data.after.id}/master.m3u8`;
                }

                if (ctx.adapter.config.notificationEventClipLink) {
                    await sendNotification(ctx, {
                        source: camera,
                        type: label,
                        state: clipState,
                        status,
                        clipUrl,
                        clipm3u8,
                        score,
                        zones,
                    });
                }

                if (ctx.adapter.config.notificationEventClip) {
                    clipFileName = join(ctx.tmpDir, `${randomUUID()}.mp4`);
                    const downloaded = await downloadClipWithRetry(ctx, clipUrl, clipFileName);
                    if (downloaded) {
                        try {
                            await sendNotification(ctx, {
                                source: camera,
                                type: label,
                                state: clipState,
                                status,
                                clip: clipFileName,
                                score,
                                zones,
                            });
                        } finally {
                            await cleanupTempFile(clipFileName, ctx.adapter.log);
                        }
                    }
                }
            } else {
                ctx.adapter.log.info('Clip sending active but no clip available ');
            }
        }
    }
}

export async function sendNotification(ctx: NotificationContext, message: NotificationMessage): Promise<void> {
    const pauseState = await ctx.adapter.getStateAsync('remote.pauseNotifications');
    if (pauseState?.val) {
        ctx.adapter.log.debug('Notifications paused');
        return;
    }
    const cameraPauseState = await ctx.adapter.getStateAsync(`${message.source}.remote.pauseNotifications`);
    if (cameraPauseState?.val) {
        ctx.adapter.log.debug(`Notifications paused for camera ${message.source}`);
        return;
    }

    if (ctx.notificationExcludeArray?.includes(message.source)) {
        ctx.adapter.log.debug(`Notification for ${message.source} is excluded`);
        return;
    }

    if (ctx.adapter.config.notificationExcludeZoneList) {
        const excludeZones = ctx.adapter.config.notificationExcludeZoneList.replace(/ /g, '').split(',');
        if (message.zones?.length) {
            const allExcluded = message.zones.every(zone => excludeZones.includes(zone));
            ctx.adapter.log.debug(
                `Check if all zones are excluded ${message.zones.join(', ')} from ${excludeZones.join(', ')}`,
            );
            if (allExcluded) {
                ctx.adapter.log.debug(`Notification for ${message.source} is excluded because all zones are excluded`);
                return;
            }
        }
    }
    if (ctx.adapter.config.notificationExcludeEmptyZoneList) {
        const cameras = ctx.adapter.config.notificationExcludeEmptyZoneList.replace(/ /g, '').split(',');
        if (cameras.includes(message.source)) {
            if (!message.zones?.length) {
                ctx.adapter.log.debug(`Notification for ${message.source} is excluded because no zones are entered`);
                return;
            }
        }
    }

    if (!ctx.adapter.config.notificationActive) {
        return;
    }

    let fileName = message.image;
    let type = 'photo';
    if (message.clip != null) {
        fileName = message.clip;
        type = 'video';
    }

    ctx.adapter.log.debug(
        `Notification score ${message.score} type ${message.type} state ${message.state} ${message.status} image/clip file: ${fileName} format ${type}`,
    );

    // Check min score
    const notificationMinScoreState = await ctx.adapter.getStateAsync(`${message.source}.remote.notificationMinScore`);
    if (notificationMinScoreState?.val) {
        if ((message.score as number) < (notificationMinScoreState.val as number)) {
            ctx.adapter.log.info(
                `Notification skipped score ${message.score} is lower than ${notificationMinScoreState.val} state ${message.state} type ${message.type}`,
            );
            return;
        }
    } else if (message.score != null && ctx.notificationMinScore && message.score < ctx.notificationMinScore) {
        ctx.adapter.log.info(
            `Notification skipped score ${message.score} is lower than ${ctx.notificationMinScore} state ${message.state} type ${message.type}`,
        );
        return;
    }
    ctx.adapter.log.debug(
        `Notification score ${message.score} is higher than ${ctx.notificationMinScore} type ${message.type}`,
    );

    // Build message text
    let messageTextTemplate = ctx.adapter.config.notificationTextTemplate;
    const notificationTextState = await ctx.adapter.getStateAsync(`${message.source}.remote.notificationText`);
    if (notificationTextState?.val) {
        messageTextTemplate = notificationTextState.val.toString();
    }
    let messageText = messageTextTemplate
        .replace(/{{source}}/g, message.source || '')
        .replace(/{{type}}/g, message.type || '')
        .replace(/{{state}}/g, message.state || '')
        .replace(/{{score}}/g, (message.score || 0).toString() || '')
        .replace(/{{status}}/g, message.status || '')
        .replace(/{{zones}}/g, (message.zones || []).join(', '));

    if (message.clipm3u8) {
        messageText = `${message.source}: ${message.clipm3u8}\n${message.clipUrl}`;
        fileName = '';
        type = 'typing';
    }

    ctx.adapter.log.debug(`Notification message ${messageText} file ${fileName} type ${type}`);

    // Track notification ID
    if (message.id) {
        ctx.notificationsLog[message.id] = true;
        const logKeys = Object.keys(ctx.notificationsLog);
        if (logKeys.length > 1000) {
            for (const key of logKeys.slice(0, logKeys.length - 1000)) {
                delete ctx.notificationsLog[key];
            }
        }
    }

    // Send to all configured instances
    const sendInstances = ctx.adapter.config.notificationInstances.replace(/ /g, '').split(',');
    const sendUsers = ctx.adapter.config.notificationUsers
        ? ctx.adapter.config.notificationUsers.replace(/ /g, '').split(',')
        : [];

    for (const sendInstance of sendInstances) {
        if (!sendInstance) {
            ctx.adapter.log.warn('No notification instance set');
            continue;
        }
        const targets = sendUsers.length > 0 ? sendUsers : [undefined];
        for (const user of targets) {
            await sendToInstance(ctx.adapter, sendInstance, user, messageText, fileName, type);
        }
    }
}

async function sendToInstance(
    adapter: ioBroker.Adapter,
    instance: string,
    user: string | undefined,
    text: string,
    fileName: string | undefined,
    type: string,
): Promise<void> {
    if (instance.includes('pushover')) {
        if (type === 'video') {
            adapter.log.info('Pushover does not support video.');
            return;
        }
        await adapter.sendToAsync(instance, {
            ...(user ? { device: user } : {}),
            file: fileName,
            message: text,
        });
    } else if (instance.includes('signal-cmb')) {
        await adapter.sendToAsync(instance, 'send', {
            text,
            ...(user ? { phone: user } : {}),
        });
    } else if (instance.includes('mail')) {
        await adapter.sendToAsync(instance, 'send', {
            subject: text,
            ...(user ? { to: user } : {}),
            text,
            attachments: fileName ? [{ path: fileName }] : [],
        });
    } else {
        // Telegram
        await adapter.sendToAsync(instance, {
            ...(user ? { user } : {}),
            message: fileName || text,
            text: fileName || text,
            type,
            caption: text,
            title: text,
        });
    }
}
