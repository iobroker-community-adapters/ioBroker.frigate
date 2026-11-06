import assert from 'node:assert';
import Json2iob from '../build/lib/json2iob.js';
import { fetchEventHistory } from '../build/lib/eventHistory.js';

/**
 * Adapter with plain maps as object and state DB; every setState is recorded.
 *
 * @param states values left in the states DB from an earlier run
 */
function createAdapter(states = {}) {
    const writes = [];
    const stateDb = {};
    for (const [id, val] of Object.entries(states)) {
        stateDb[id] = { val, ack: true };
    }
    return {
        namespace: 'frigate.0',
        FORBIDDEN_CHARS: /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu,
        frigateBaseUrl: 'http://frigate:5000',
        config: { webnum: 10 },
        log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
        stateDb,
        writes,
        extendObjectAsync: async () => {},
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
