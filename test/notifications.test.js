import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { prepareEventNotification } from '../build/lib/notifications.js';

const noopLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Minimal config with only the snapshot notification enabled */
function makeConfig(overrides = {}) {
    return {
        notificationActive: true,
        notificationEventSnapshot: true,
        notificationEventSnapshotStart: false,
        notificationEventSnapshotUpdate: false,
        notificationEventSnapshotUpdateOnce: false,
        notificationEventClip: false,
        notificationEventClipLink: false,
        notificationEventClipWaitTime: 1,
        notificationInstances: 'telegram.0',
        notificationUsers: '',
        notificationExcludeZoneList: '',
        notificationExcludeEmptyZoneList: '',
        notificationTextTemplate: '{{source}} {{type}}',
        ...overrides,
    };
}

/** Context with an in-memory adapter, a tmp dir of its own and a stubbed request client */
function makeCtx(tmpDir, { config = {}, download = 'ok', sendFails = false } = {}) {
    const calls = { downloads: 0, sends: 0 };
    return {
        calls,
        ctx: {
            adapter: {
                config: makeConfig(config),
                log: noopLog,
                frigateBaseUrl: 'http://frigate.local:5000',
                sleep: async () => {},
                getStateAsync: async () => null,
                sendToAsync: async () => {
                    calls.sends++;
                    if (sendFails) {
                        throw new Error('telegram.0 is not running');
                    }
                },
            },
            requestClient: async () => {
                calls.downloads++;
                if (download === 'ok') {
                    return { data: Readable.from([Buffer.from('image-payload')]) };
                }
                // Emit some data, then fail: this is what leaves a partial file behind
                const stream = new Readable({ read() {} });
                stream.push(Buffer.from('partial'));
                setImmediate(() => stream.destroy(new Error('connection reset')));
                return { data: stream };
            },
            tmpDir,
            notificationMinScore: null,
            notificationsLog: {},
            notificationExcludeArray: [],
        },
    };
}

const event = {
    type: 'end',
    before: { id: 'evt-1', camera: 'garage', label: 'person', top_score: 0.9, entered_zones: [], has_snapshot: true },
};

describe('Temp file handling in prepareEventNotification', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'frigate-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does not download anything when notifications are disabled', async () => {
        const { ctx, calls } = makeCtx(tmpDir, { config: { notificationActive: false } });
        await prepareEventNotification(ctx, event);
        assert.strictEqual(calls.downloads, 0);
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });

    it('deletes the snapshot after a successful notification', async () => {
        const { ctx, calls } = makeCtx(tmpDir);
        await prepareEventNotification(ctx, event);
        assert.strictEqual(calls.sends, 1);
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });

    it('deletes the snapshot even if sending the notification fails', async () => {
        const { ctx } = makeCtx(tmpDir, { sendFails: true });
        await assert.rejects(() => prepareEventNotification(ctx, event));
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });

    it('leaves no partial file behind when the download fails', async () => {
        const { ctx, calls } = makeCtx(tmpDir, { download: 'fail' });
        await prepareEventNotification(ctx, event);
        assert.strictEqual(calls.sends, 0);
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });
});

/** Context for the clip path, with a per-attempt responder for the request client */
function makeClipCtx(tmpDir, responder, logLines) {
    const calls = { downloads: 0, sends: 0 };
    const log = {
        debug: () => {},
        info: () => {},
        warn: line => logLines && logLines.push(String(line)),
        error: () => {},
    };
    return {
        calls,
        ctx: {
            adapter: {
                config: makeConfig({
                    notificationEventSnapshot: false,
                    notificationEventClip: true,
                    notificationEventClipWaitTime: 1,
                }),
                log,
                frigateBaseUrl: 'http://frigate.local:5000',
                sleep: async () => {},
                getStateAsync: async () => null,
                sendToAsync: async () => {
                    calls.sends++;
                },
            },
            requestClient: async () => {
                calls.downloads++;
                return responder(calls.downloads);
            },
            tmpDir,
            notificationMinScore: null,
            notificationsLog: {},
            notificationExcludeArray: [],
        },
    };
}

/** Axios style error with a streamed JSON body, as Frigate answers it */
function httpError(status, message) {
    const error = new Error(`Request failed with status code ${status}`);
    error.response = {
        status,
        data: Readable.from([Buffer.from(JSON.stringify({ success: false, message }))]),
    };
    return error;
}

const clipEvent = {
    type: 'end',
    before: { id: 'evt-2', camera: 'garage', label: 'car', top_score: 0.9, entered_zones: [], has_clip: true },
};

const NO_RECORDINGS = 'No recordings found for the specified time range';

describe('Clip download', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(join(os.tmpdir(), 'frigate-clip-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('retries a 400 and sends the clip once it is available', async () => {
        const { ctx, calls } = makeClipCtx(tmpDir, attempt => {
            if (attempt === 1) {
                throw httpError(400, NO_RECORDINGS);
            }
            return { data: Readable.from([Buffer.from('clip-payload')]) };
        });
        await prepareEventNotification(ctx, clipEvent);
        assert.strictEqual(calls.downloads, 2);
        assert.strictEqual(calls.sends, 1);
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });

    it('gives up after three attempts and leaves no file behind', async () => {
        const { ctx, calls } = makeClipCtx(tmpDir, () => {
            throw httpError(400, NO_RECORDINGS);
        });
        await prepareEventNotification(ctx, clipEvent);
        assert.strictEqual(calls.downloads, 3);
        assert.strictEqual(calls.sends, 0);
        assert.deepStrictEqual(fs.readdirSync(tmpDir), []);
    });

    it('does not retry a 404, because the clip will never appear', async () => {
        const { ctx, calls } = makeClipCtx(tmpDir, () => {
            throw httpError(404, 'Clip not available');
        });
        await prepareEventNotification(ctx, clipEvent);
        assert.strictEqual(calls.downloads, 1);
        assert.strictEqual(calls.sends, 0);
    });

    it('logs the message Frigate sent instead of only the status code', async () => {
        const lines = [];
        const { ctx } = makeClipCtx(
            tmpDir,
            () => {
                throw httpError(400, NO_RECORDINGS);
            },
            lines,
        );
        await prepareEventNotification(ctx, clipEvent);
        assert.ok(
            lines.some(line => line.includes(NO_RECORDINGS)),
            `expected the Frigate message in the log, got:\n${lines.join('\n')}`,
        );
        assert.ok(lines.some(line => line.includes('Status 400')));
    });
});
