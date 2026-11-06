import assert from 'node:assert';
import Json2iob from '../build/lib/json2iob.js';
import { fetchEventHistory } from '../build/lib/eventHistory.js';

/**
 * Adapter with plain maps as object and state DB; every setState is recorded.
 *
 * @param states values left in the states DB from an earlier run, their objects exist too
 */
function createAdapter(states = {}) {
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
        config: { webnum: 10 },
        log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
        stateDb,
        objects,
        writes,
        extendObjectAsync: async (id, obj) => {
            objects[id] = { ...objects[id], ...obj };
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

    it('clears the positions beyond a list that got shorter, but not events.history.json', async () => {
        const adapter = createAdapter();
        const ctx = context(adapter, events);
        await fetchEventHistory(ctx);
        assert.strictEqual(adapter.stateDb['events.history.02.id'].val, 'e1');

        ctx.requestClient = createClient([]);
        await fetchEventHistory(ctx);
        for (const [id, state] of Object.entries(adapter.stateDb)) {
            if (id !== 'events.history.json') {
                assert.strictEqual(state.val, null, id);
            }
        }
        assert.strictEqual(adapter.stateDb['events.history.json'].val, '[]');
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
