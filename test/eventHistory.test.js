import assert from 'node:assert';
import Json2iob from '../build/lib/json2iob.js';
import { cleanEventHistoryObjects, fetchEventHistory } from '../build/lib/eventHistory.js';
import { handleJobState } from '../build/lib/jobState.js';
import { removePathData } from '../build/lib/messageHandler.js';

/**
 * Adapter with plain maps as object and state DB; every setState is recorded.
 *
 * @param states values left in the states DB from an earlier run, their objects exist too
 * @param config adapter settings in addition to `webnum: 10`
 */
function createAdapter(states = {}, config = {}) {
    const writes = [];
    const stateDb = {};
    const objects = {};
    for (const [id, val] of Object.entries(states)) {
        stateDb[id] = { val, ack: true };
        objects[id] = { type: 'state' };
    }
    return {
        namespace: 'frigate.0',
        FORBIDDEN_CHARS: /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu,
        frigateBaseUrl: 'http://frigate:5000',
        config: { webnum: 10, ...config },
        log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
        stateDb,
        objects,
        writes,
        extendObjectAsync: async (id, obj) => {
            objects[id] = { ...objects[id], ...obj };
        },
        getObjectAsync: async id => objects[id] || null,
        delObjectAsync: async (id, options) => {
            if (!objects[id]) {
                throw new Error('Not exists');
            }
            for (const key of Object.keys(objects)) {
                if (key === id || (options?.recursive && key.startsWith(`${id}.`))) {
                    delete objects[key];
                    delete stateDb[key];
                }
            }
        },
        getObjectViewAsync: async (_design, search, { startkey, endkey }) => ({
            rows: Object.keys(objects)
                .map(id => `frigate.0.${id}`)
                .filter(id => id >= startkey && id <= endkey && objects[id.substring(10)].type === search)
                .map(id => ({ id, value: objects[id.substring(10)] })),
        }),
        getStateAsync: async id => stateDb[id] || null,
        setStateAsync: async (id, val, ack) => {
            stateDb[id] = { val, ack };
            writes.push(id);
        },
    };
}

function frigateEvent(id, camera, fields = {}) {
    return {
        id,
        camera,
        label: 'person',
        start_time: 1762400000.5,
        end_time: null,
        top_score: 0.8,
        has_clip: true,
        thumbnail: 'AAAA',
        ...fields,
    };
}

/**
 * Answers /api/events like Frigate, with a fresh copy each time, because the history mutates it.
 *
 * @param events all events, newest first
 * @param requests every requested camera is recorded here ('' for all cameras)
 */
function createClient(events, requests = []) {
    return async ({ params }) => {
        requests.push(params.cameras || '');
        const data = events.filter(e => !params.cameras || e.camera === params.cameras);
        return { data: structuredClone(data) };
    };
}

function context(adapter, events, requests) {
    return {
        adapter,
        requestClient: createClient(events, requests),
        json2iob: new Json2iob(adapter),
        deviceArray: ['', 'haustuer', 'garten'],
    };
}

describe('Event history (fetchEventHistory)', () => {
    const events = [frigateEvent('e2', 'haustuer'), frigateEvent('e1', 'garten', { end_time: 1762400010.5 })];

    it('writes the history on the first fetch', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(context(adapter, events));
        assert.strictEqual(adapter.stateDb['events.history.01.id'].val, 'e2');
        assert.strictEqual(adapter.stateDb['haustuer.history.01.id'].val, 'e2');
        assert.strictEqual(adapter.stateDb['garten.history.01.id'].val, 'e1');
        assert.ok(adapter.stateDb['events.history.json'].val.includes('"e2"'));
        assert.ok(adapter.writes.length > 0);
    });

    it('writes nothing when the history did not change', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, events);
        await fetchEventHistory(ctx);
        adapter.writes.length = 0;

        await fetchEventHistory(ctx);
        assert.deepStrictEqual(adapter.writes, []);
    });

    it('writes only the values that changed', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, events);
        await fetchEventHistory(ctx);
        adapter.writes.length = 0;

        ctx.requestClient = createClient([{ ...events[0], top_score: 0.9 }, events[1]]);
        await fetchEventHistory(ctx);
        assert.deepStrictEqual(adapter.writes.sort(), [
            'events.history.01.top_score',
            'events.history.json',
            'haustuer.history.01.top_score',
            'haustuer.history.json',
        ]);
        assert.strictEqual(adapter.stateDb['events.history.01.top_score'].val, 0.9);
    });

    it('does not write everything again after a restart', async () => {
        const first = createAdapter();
        await fetchEventHistory(context(first, events));
        const values = Object.fromEntries(Object.entries(first.stateDb).map(([id, state]) => [id, state.val]));

        const restarted = createAdapter(values);
        await fetchEventHistory(context(restarted, events));
        assert.deepStrictEqual(restarted.writes, []);
    });

    it('clears a field the new event at the same position does not have', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, [frigateEvent('e2', 'haustuer', { sub_label: 'Denis', zones: ['garten'] })]);
        await fetchEventHistory(ctx);
        assert.strictEqual(adapter.stateDb['events.history.01.sub_label'].val, 'Denis');
        assert.strictEqual(adapter.stateDb['events.history.01.zones.garten'].val, 'garten');

        // Frigate sends sub_label: null for an event without a recognized name
        ctx.requestClient = createClient([frigateEvent('e3', 'haustuer', { sub_label: null, zones: ['steg'] })]);
        await fetchEventHistory(ctx);
        assert.strictEqual(adapter.stateDb['events.history.01.id'].val, 'e3');
        assert.strictEqual(adapter.stateDb['events.history.01.sub_label'].val, null);
        assert.strictEqual(adapter.stateDb['events.history.01.zones.garten'].val, null);
        assert.strictEqual(adapter.stateDb['events.history.01.zones.steg'].val, 'steg');
        assert.strictEqual(adapter.stateDb['haustuer.history.01.sub_label'].val, null);
    });

    it('clears the positions beyond a list that got shorter, but not the JSON of the lists', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, events);
        await fetchEventHistory(ctx);
        assert.strictEqual(adapter.stateDb['events.history.02.id'].val, 'e1');

        ctx.requestClient = createClient([]);
        await fetchEventHistory(ctx);
        for (const [id, state] of Object.entries(adapter.stateDb)) {
            if (id.endsWith('.history.json')) {
                assert.strictEqual(state.val, '[]', id);
            } else {
                assert.strictEqual(state.val, null, id);
            }
        }
    });

    it('writes the history of each camera as JSON too', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(context(adapter, events));
        assert.deepStrictEqual(
            JSON.parse(adapter.stateDb['garten.history.json'].val).map(e => e.id),
            ['e1'],
        );
        assert.deepStrictEqual(
            JSON.parse(adapter.stateDb['events.history.json'].val).map(e => e.id),
            ['e2', 'e1'],
        );
    });

    it('writes nothing more once the outdated values are cleared', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, events);
        await fetchEventHistory(ctx);
        ctx.requestClient = createClient([events[0]]);
        await fetchEventHistory(ctx);
        adapter.writes.length = 0;

        await fetchEventHistory(ctx);
        assert.deepStrictEqual(adapter.writes, []);
    });

    it('clears values left from before a restart', async () => {
        const restarted = createAdapter({
            'events.history.01.id': 'e2',
            'events.history.02.id': 'old',
            'events.history.02.sub_label': 'Denis',
            'garten.history.01.id': 'old',
        });
        const ctx = context(restarted, [events[0]]);
        await fetchEventHistory(ctx);
        assert.strictEqual(restarted.stateDb['events.history.01.id'].val, 'e2');
        assert.strictEqual(restarted.stateDb['events.history.02.id'].val, null);
        assert.strictEqual(restarted.stateDb['events.history.02.sub_label'].val, null);
        assert.strictEqual(restarted.stateDb['garten.history.01.id'].val, null);
        assert.ok(!restarted.writes.includes('events.history.01.id'), 'unchanged value written again');
    });

    it('links the thumbnail when Frigate (0.14+) sends none, and keeps the base64 picture of older versions', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(
            context(adapter, [
                frigateEvent('e2', 'haustuer', { thumbnail: null }),
                frigateEvent('e1', 'garten', { thumbnail: 'AAAA' }),
            ]),
        );
        assert.strictEqual(
            adapter.stateDb['events.history.01.thumbnail'].val,
            'http://frigate:5000/api/events/e2/thumbnail.jpg',
        );
        assert.strictEqual(adapter.stateDb['events.history.02.thumbnail'].val, 'data:image/jpeg;base64,AAAA');
        assert.ok(adapter.stateDb['events.history.json'].val.includes('/api/events/e2/thumbnail.jpg'));
    });

    it('fetches only the requested cameras', async () => {
        const adapter = createAdapter();
        const requests = [];
        await fetchEventHistory(context(adapter, events, requests), ['', 'haustuer']);
        assert.deepStrictEqual(requests, ['', 'haustuer']);
        assert.strictEqual(adapter.stateDb['garten.history.01.id'], undefined);
    });
});

describe('Event history settings', () => {
    const events = [frigateEvent('e2', 'haustuer'), frigateEvent('e1', 'garten')];

    /** Ids of the objects below a path, without the path itself */
    function objectsBelow(adapter, path) {
        return Object.keys(adapter.objects)
            .filter(id => id.startsWith(`${path}.`))
            .sort();
    }

    it('writes only the JSON when the single states are off', async () => {
        const adapter = createAdapter({}, { historyStates: false });
        await fetchEventHistory(context(adapter, events));
        assert.deepStrictEqual(Object.keys(adapter.stateDb).sort(), [
            'events.history.json',
            'garten.history.json',
            'haustuer.history.json',
        ]);
        assert.ok(adapter.stateDb['events.history.json'].val.includes('"e2"'));
    });

    it('fetches only the overall history when the history per camera is off', async () => {
        const adapter = createAdapter({}, { historyPerCamera: false });
        const requests = [];
        await fetchEventHistory(context(adapter, events, requests));
        assert.deepStrictEqual(requests, ['']);
        assert.strictEqual(adapter.stateDb['events.history.01.id'].val, 'e2');
        assert.deepStrictEqual(objectsBelow(adapter, 'haustuer'), []);
    });

    it('deletes the single states, but keeps the JSON, when they are switched off', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(context(adapter, events));
        adapter.objects['events.history.json'] = { type: 'state' };
        adapter.objects['haustuer.history'] = { type: 'channel' };
        adapter.objects['haustuer.history.json'] = { type: 'state' };
        assert.ok(objectsBelow(adapter, 'events.history').length > 10);

        adapter.config.historyStates = false;
        await cleanEventHistoryObjects({ adapter }, ['haustuer', 'garten']);
        assert.deepStrictEqual(objectsBelow(adapter, 'events.history'), ['events.history.json']);
        assert.deepStrictEqual(objectsBelow(adapter, 'haustuer.history'), ['haustuer.history.json']);
        assert.ok(adapter.objects['haustuer.history'], 'channel of the camera history deleted');
    });

    it('deletes the whole history of the cameras when it is switched off', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(context(adapter, events));
        adapter.objects['events.history.json'] = { type: 'state' };
        adapter.objects['haustuer.history'] = { type: 'channel' };
        adapter.objects['haustuer.history.json'] = { type: 'state' };
        adapter.objects['haustuer.remote.ptz'] = { type: 'state' };

        adapter.config.historyPerCamera = false;
        await cleanEventHistoryObjects({ adapter }, ['haustuer', 'garten']);
        assert.deepStrictEqual(objectsBelow(adapter, 'haustuer'), ['haustuer.remote.ptz']);
        assert.strictEqual(adapter.objects['haustuer.history'], undefined);
        assert.deepStrictEqual(objectsBelow(adapter, 'garten'), []);
        assert.ok(objectsBelow(adapter, 'events.history').length > 10, 'overall history deleted');
    });

    it('deletes nothing with the default settings', async () => {
        const adapter = createAdapter();
        await fetchEventHistory(context(adapter, events));
        const before = Object.keys(adapter.objects).sort();
        await cleanEventHistoryObjects({ adapter }, ['haustuer', 'garten']);
        assert.deepStrictEqual(Object.keys(adapter.objects).sort(), before);
    });
});

describe('Job state (handleJobState)', () => {
    /** An export job as Frigate sends it in `job_state` */
    function exportJob(id, fields = {}) {
        return {
            id,
            job_type: 'export',
            status: 'running',
            camera: id.split('_')[0],
            name: '',
            export_case_id: 'mfptdmt596a6',
            request_start_time: 1791693960,
            request_end_time: 1791694200,
            start_time: 1792068664.9,
            end_time: null,
            error_message: null,
            results: null,
            current_step: 'copying',
            progress_percent: 50,
            ...fields,
        };
    }

    /** The payload of `job_state`, prepared like the MQTT handler does it */
    function jobState(exportJobs, others = {}) {
        const data = {
            export: { job_type: 'export', status: 'running', results: { jobs: exportJobs } },
            ...others,
        };
        removePathData(data);
        return data;
    }

    function jobObjects(adapter) {
        return Object.keys(adapter.objects)
            .filter(id => id.startsWith('job_state.export.results.'))
            .map(id => id.split('.')[3]);
    }

    it('deletes the objects of a job that is not in the state any more', async () => {
        const adapter = createAdapter();
        const ctx = { adapter, json2iob: new Json2iob(adapter) };
        await handleJobState(ctx, jobState([exportJob('Mast_b3w9io'), exportJob('cockpit_223jqt')]));
        assert.deepStrictEqual([...new Set(jobObjects(adapter))].sort(), ['Mast_b3w9io', 'cockpit_223jqt']);
        assert.strictEqual(adapter.stateDb['job_state.export.results.Mast_b3w9io.progress_percent'].val, 50);

        await handleJobState(ctx, jobState([exportJob('cockpit_223jqt', { progress_percent: 80 })]));
        assert.deepStrictEqual([...new Set(jobObjects(adapter))], ['cockpit_223jqt']);
        assert.strictEqual(adapter.objects['job_state.export.results.Mast_b3w9io'], undefined);
        assert.strictEqual(adapter.stateDb['job_state.export.results.cockpit_223jqt.progress_percent'].val, 80);
    });

    it('keeps the state of the job type when no job runs any more', async () => {
        const adapter = createAdapter();
        const ctx = { adapter, json2iob: new Json2iob(adapter) };
        await handleJobState(ctx, jobState([exportJob('Mast_b3w9io')]));
        await handleJobState(ctx, jobState([]));
        assert.deepStrictEqual(
            Object.keys(adapter.objects)
                .filter(id => id.startsWith('job_state.'))
                .sort(),
            ['job_state.export', 'job_state.export.job_type', 'job_state.export.status'],
        );

        // Nothing is created and deleted again with each further message
        const deleted = [];
        const delObjectAsync = adapter.delObjectAsync;
        adapter.delObjectAsync = async (id, options) => {
            deleted.push(id);
            return delObjectAsync(id, options);
        };
        await handleJobState(ctx, jobState([]));
        assert.deepStrictEqual(deleted, []);
    });

    it('creates the objects again when a job with the same id comes back', async () => {
        const adapter = createAdapter();
        const ctx = { adapter, json2iob: new Json2iob(adapter) };
        await handleJobState(ctx, jobState([exportJob('Mast_b3w9io')]));
        await handleJobState(ctx, jobState([]));
        await handleJobState(ctx, jobState([exportJob('Mast_b3w9io', { progress_percent: 10 })]));
        assert.strictEqual(adapter.objects['job_state.export.results.Mast_b3w9io.progress_percent'].type, 'state');
        assert.strictEqual(adapter.stateDb['job_state.export.results.Mast_b3w9io.progress_percent'].val, 10);
    });

    it('deletes jobs left from before a restart with the first message', async () => {
        const adapter = createAdapter({
            'job_state.export.results.inner_206one.status': 'running',
            'job_state.export.results.inner_206one.progress_percent': 0.02,
        });
        adapter.objects['job_state.export.results.inner_206one'] = { type: 'channel' };
        const ctx = { adapter, json2iob: new Json2iob(adapter) };
        await handleJobState(ctx, jobState([exportJob('Mast_lkdzl0')]));
        assert.deepStrictEqual([...new Set(jobObjects(adapter))], ['Mast_lkdzl0']);
    });

    it('leaves the other job types alone', async () => {
        const adapter = createAdapter();
        const ctx = { adapter, json2iob: new Json2iob(adapter) };
        const replay = { debug_replay: { id: 'r1', job_type: 'debug_replay', status: 'running' } };
        await handleJobState(ctx, jobState([exportJob('Mast_b3w9io')], replay));
        await handleJobState(ctx, jobState([], replay));
        assert.strictEqual(adapter.stateDb['job_state.debug_replay.status'].val, 'running');
        assert.deepStrictEqual(jobObjects(adapter), []);
    });
});

describe('Json2iob without onlyChanged', () => {
    it('still writes every value, also unchanged ones (live MQTT data)', async () => {
        const adapter = createAdapter();
        const json2iob = new Json2iob(adapter);
        await json2iob.parse('haustuer', { motion: true });
        await json2iob.parse('haustuer', { motion: true });
        assert.deepStrictEqual(adapter.writes, ['haustuer.motion', 'haustuer.motion']);
    });

    it('a normal write does not leave a stale value for a later change-only write', async () => {
        const adapter = createAdapter();
        const json2iob = new Json2iob(adapter);
        assert.strictEqual(await json2iob.setStateIfChanged('x.value', 1), true);
        await json2iob.parse('x', { value: 2 });
        assert.strictEqual(await json2iob.setStateIfChanged('x.value', 1), true);
        assert.strictEqual(adapter.stateDb['x.value'].val, 1);
    });
});
