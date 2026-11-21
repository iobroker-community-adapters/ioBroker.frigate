import assert from 'node:assert';
import {
    findCamera,
    parseSeconds,
    parseTime,
    requestError,
    snapshotCamera,
    toStandardEvents,
} from '../build/lib/standard.js';

const CAMERAS = [
    { id: 'driveway', name: 'driveway' },
    { id: 'garden_front', name: 'garden_front' },
    { id: 'garden_back', name: 'garden_back' },
];

/** Events as Frigate's /api/events gives them (after removePathData) */
const HISTORY = [
    {
        id: '1700000300.5-c',
        camera: 'driveway',
        label: 'car',
        start_time: 1700000300.5,
        end_time: 1700000320,
        top_score: 0.8,
    },
    {
        id: '1700000200.1-b',
        camera: 'garden_front',
        label: 'person',
        sub_label: 'Anna',
        start_time: 1700000200.1,
        data: { top_score: 0.9 },
    },
    {
        id: '1700000100-a',
        camera: 'driveway',
        label: 'person',
        sub_label: ['Ben', 0.7],
        start_time: 1700000100,
        end_time: 1700000110,
    },
    { camera: 'driveway', label: 'person' },
];

describe('commands of the shared catalog', () => {
    it('findCamera: the name without case, then a part of it', () => {
        assert.strictEqual(findCamera(CAMERAS, 'Driveway').id, 'driveway');
        assert.strictEqual(findCamera(CAMERAS, 'front').id, 'garden_front');
        assert.deepStrictEqual(findCamera(CAMERAS, 'garden'), {
            error: '"garden" fits several cameras',
            reason: 'AMBIGUOUS',
            candidates: ['garden_front', 'garden_back'],
        });
        assert.strictEqual(findCamera(CAMERAS, 'kitchen').reason, 'NOT_FOUND');
        assert.strictEqual(findCamera(CAMERAS, undefined).reason, 'BAD_REQUEST');
    });

    it('snapshotCamera: a known camera by name, an unknown valid name as it is', () => {
        assert.strictEqual(snapshotCamera(CAMERAS, 'DRIVEWAY'), 'driveway');
        // not known (yet): asked of Frigate under this name, as before the catalog
        assert.strictEqual(snapshotCamera(CAMERAS, 'carport'), 'carport');
        assert.strictEqual(snapshotCamera([], 'carport'), 'carport');
        assert.strictEqual(snapshotCamera(CAMERAS, '../config').reason, 'NOT_FOUND');
        assert.strictEqual(snapshotCamera(CAMERAS, 'garden').reason, 'AMBIGUOUS');
        assert.strictEqual(snapshotCamera(CAMERAS, '').reason, 'BAD_REQUEST');
    });

    it('requestError: 404 = not found, everything else = not connected', () => {
        const notFound = { error: 'Camera "x" not found', reason: 'NOT_FOUND', candidates: ['a'] };
        assert.strictEqual(requestError({ response: { status: 404 } }, notFound), notFound);
        assert.deepStrictEqual(requestError(new Error('connect ECONNREFUSED'), notFound), {
            error: 'connect ECONNREFUSED',
            reason: 'NOT_CONNECTED',
        });
    });

    it('parseTime and parseSeconds', () => {
        assert.strictEqual(parseTime(undefined), undefined);
        assert.strictEqual(parseTime(''), undefined);
        assert.strictEqual(parseTime(1700000000000), 1700000000000);
        assert.strictEqual(parseTime('1700000000000'), 1700000000000);
        assert.strictEqual(parseTime('2026-11-21T10:00:00Z'), Date.UTC(2026, 10, 21, 10));
        // without a zone: local time
        assert.strictEqual(parseTime('2026-11-21T10:00:00'), new Date(2026, 10, 21, 10).getTime());
        assert.ok(Number.isNaN(parseTime('yesterday')));
        assert.ok(Number.isNaN(parseTime({})));

        assert.strictEqual(parseSeconds(7200), 7200);
        assert.strictEqual(parseSeconds('90'), 90);
        assert.strictEqual(parseSeconds(0), 0);
        assert.ok(Number.isNaN(parseSeconds(-1)));
        assert.ok(Number.isNaN(parseSeconds(undefined)));
        assert.ok(Number.isNaN(parseSeconds('')));
    });

    it('toStandardEvents: the fields of the catalog, times in ms, newest first', () => {
        assert.deepStrictEqual(toStandardEvents(HISTORY, {}), [
            {
                id: '1700000300.5-c',
                camera: 'driveway',
                label: 'car',
                start: 1700000300500,
                end: 1700000320000,
                score: 0.8,
            },
            {
                id: '1700000200.1-b',
                camera: 'garden_front',
                label: 'person',
                start: 1700000200100,
                score: 0.9,
                name: 'Anna',
            },
            {
                id: '1700000100-a',
                camera: 'driveway',
                label: 'person',
                start: 1700000100000,
                end: 1700000110000,
                name: 'Ben',
            },
        ]);
        assert.strictEqual(toStandardEvents('not a list', {}).length, 0);
    });

    it('toStandardEvents: filters camera, label, start, end and limit', () => {
        const ids = filter => toStandardEvents(HISTORY, filter).map(e => e.id);
        assert.deepStrictEqual(ids({ camera: 'driveway' }), ['1700000300.5-c', '1700000100-a']);
        assert.deepStrictEqual(ids({ label: 'PERSON' }), ['1700000200.1-b', '1700000100-a']);
        assert.deepStrictEqual(ids({ start: 1700000150000 }), ['1700000300.5-c', '1700000200.1-b']);
        assert.deepStrictEqual(ids({ end: 1700000150000 }), ['1700000100-a']);
        assert.deepStrictEqual(ids({ limit: 1 }), ['1700000300.5-c']);
        assert.deepStrictEqual(ids({ camera: 'driveway', label: 'person' }), ['1700000100-a']);
    });
});
