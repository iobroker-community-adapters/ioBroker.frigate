import assert from 'node:assert';

// Re-implement removePathData as a pure function for unit testing
// (matches FrigateAdapter.removePathData from src/main.ts exactly)
function removePathData(obj) {
    if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) {
            for (let i = obj.length - 1; i >= 0; i--) {
                const item = obj[i];
                if (item && typeof item === 'object' && Object.keys(item).length === 0) {
                    obj.splice(i, 1);
                } else if (item && typeof item === 'object') {
                    removePathData(item);
                }
            }
        } else {
            for (const key in obj) {
                if (key === 'path_data' || key === 'gpu_usages') {
                    delete obj[key];
                } else if (Array.isArray(obj[key]) && obj[key].length === 0) {
                    delete obj[key];
                } else if (obj[key] && typeof obj[key] === 'object' && Object.keys(obj[key]).length === 0) {
                    delete obj[key];
                } else if (obj[key] === null || obj[key] === undefined) {
                    delete obj[key];
                } else {
                    removePathData(obj[key]);
                }
            }
        }
    }
}

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

/**
 * Simulate the data parsing from handleMqttMessage without ioBroker dependency.
 * Mirrors the logic in src/main.ts handleMqttMessage exactly.
 */
function parseMessageData(topic, payloadStr) {
    const pathArray = topic.split('/');
    let data;

    if (pathArray[pathArray.length - 1] !== 'snapshot') {
        if (
            payloadStr === 'ON' &&
            (ON_OFF_STATES.includes(pathArray[pathArray.length - 2]) ||
                pathArray[pathArray.length - 1] === 'motion')
        ) {
            data = true;
        } else if (
            (payloadStr === 'OFF' && ON_OFF_STATES.includes(pathArray[pathArray.length - 2])) ||
            pathArray[pathArray.length - 1] === 'motion'
        ) {
            data = false;
        } else if (
            !isNaN(Number(payloadStr)) ||
            payloadStr.includes('"') ||
            payloadStr.includes('{') ||
            payloadStr.includes('[')
        ) {
            try {
                data = JSON.parse(payloadStr);
            } catch {
                // not valid JSON
            }
        } else {
            data = payloadStr;
        }
    }
    return data;
}

/**
 * Simulate the path flattening logic from handleMqttMessage.
 */
function flattenPath(topic, prefix) {
    let pathArray = topic.split('/');
    if (pathArray[0] === prefix) {
        pathArray.shift();
    }
    const command = pathArray[0];

    if (
        command !== 'stats' &&
        command !== 'events' &&
        command !== 'available' &&
        command !== 'reviews' &&
        command !== 'camera_activity' &&
        command !== 'notifications' &&
        pathArray.length > 1
    ) {
        const cameraId = pathArray.shift() || '';
        pathArray = [cameraId, pathArray.join('_')];
    }
    return pathArray;
}

describe('removePathData', () => {
    it('should remove path_data from flat object', () => {
        const obj = { id: '123', path_data: 'huge_binary_data', label: 'person' };
        removePathData(obj);
        assert.strictEqual(obj.id, '123');
        assert.strictEqual(obj.label, 'person');
        assert.strictEqual(obj.path_data, undefined, 'path_data should be removed');
    });

    it('should remove gpu_usages from flat object', () => {
        const obj = { cpu: 10, gpu_usages: { gpu1: 50 }, memory: 200 };
        removePathData(obj);
        assert.strictEqual(obj.cpu, 10);
        assert.strictEqual(obj.memory, 200);
        assert.strictEqual(obj.gpu_usages, undefined, 'gpu_usages should be removed');
    });

    it('should remove path_data from nested objects', () => {
        const obj = {
            after: {
                id: '456',
                path_data: 'nested_data',
                snapshot: {
                    path_data: 'snapshot_data',
                    url: 'http://example.com',
                },
            },
        };
        removePathData(obj);
        assert.strictEqual(obj.after.id, '456');
        assert.strictEqual(obj.after.path_data, undefined);
        assert.strictEqual(obj.after.snapshot.path_data, undefined);
        assert.strictEqual(obj.after.snapshot.url, 'http://example.com');
    });

    it('should remove path_data from array items', () => {
        const obj = {
            history: [
                { id: '1', path_data: 'data1', snapshot: { path_data: 'snap1' } },
                { id: '2', path_data: 'data2', snapshot: { path_data: 'snap2' } },
            ],
        };
        removePathData(obj);
        assert.strictEqual(obj.history.length, 2);
        assert.strictEqual(obj.history[0].path_data, undefined);
        assert.strictEqual(obj.history[0].snapshot.path_data, undefined);
        assert.strictEqual(obj.history[1].path_data, undefined);
        assert.strictEqual(obj.history[1].snapshot.path_data, undefined);
    });

    it('should remove empty arrays', () => {
        const obj = { zones: [], label: 'car' };
        removePathData(obj);
        assert.strictEqual(obj.zones, undefined, 'Empty array should be removed');
        assert.strictEqual(obj.label, 'car');
    });

    it('should remove empty objects', () => {
        const obj = { data: {}, label: 'dog' };
        removePathData(obj);
        assert.strictEqual(obj.data, undefined, 'Empty object should be removed');
        assert.strictEqual(obj.label, 'dog');
    });

    it('should remove null and undefined values', () => {
        const obj = { a: null, b: undefined, c: 'valid' };
        removePathData(obj);
        assert(!('a' in obj), 'null should be removed');
        assert(!('b' in obj), 'undefined should be removed');
        assert.strictEqual(obj.c, 'valid');
    });

    it('should remove empty objects from arrays', () => {
        const arr = [{ id: '1' }, {}, { id: '3' }];
        removePathData(arr);
        assert.strictEqual(arr.length, 2, 'Empty object should be spliced from array');
        assert.strictEqual(arr[0].id, '1');
        assert.strictEqual(arr[1].id, '3');
    });

    it('should handle deeply nested structures', () => {
        const obj = {
            level1: {
                level2: {
                    level3: {
                        path_data: 'deep',
                        value: 42,
                    },
                },
            },
        };
        removePathData(obj);
        assert.strictEqual(obj.level1.level2.level3.path_data, undefined);
        assert.strictEqual(obj.level1.level2.level3.value, 42);
    });

    it('should not modify primitives in arrays', () => {
        const obj = { tags: ['person', 'car', 'dog'] };
        removePathData(obj);
        assert.deepStrictEqual(obj.tags, ['person', 'car', 'dog']);
    });

    it('should handle null input gracefully', () => {
        assert.doesNotThrow(() => removePathData(null));
        assert.doesNotThrow(() => removePathData(undefined));
        assert.doesNotThrow(() => removePathData('string'));
        assert.doesNotThrow(() => removePathData(42));
    });

    it('should handle a realistic frigate event message', () => {
        const event = {
            type: 'end',
            before: {
                id: 'abc123',
                camera: 'front_door',
                label: 'person',
                top_score: 0.89,
                entered_zones: ['yard'],
                path_data: 'VERY_LARGE_BINARY_PATH_DATA_BEFORE',
                snapshot: { path_data: 'SNAPSHOT_PATH_DATA_BEFORE' },
                data: { detections: [{ type: 'person' }] },
                has_snapshot: true,
                has_clip: true,
            },
            after: {
                id: 'abc123',
                camera: 'front_door',
                label: 'person',
                top_score: 0.92,
                entered_zones: ['yard', 'driveway'],
                path_data: 'VERY_LARGE_BINARY_PATH_DATA_AFTER',
                snapshot: { path_data: 'SNAPSHOT_PATH_DATA_AFTER' },
                data: { detections: [{ type: 'person' }] },
                has_snapshot: true,
                has_clip: true,
            },
            history: [
                { path_data: 'HISTORY_0', snapshot: { path_data: 'HIST_SNAP_0' } },
                { path_data: 'HISTORY_1', snapshot: { path_data: 'HIST_SNAP_1' } },
            ],
        };
        removePathData(event);

        assert.strictEqual(event.before.path_data, undefined);
        assert.strictEqual(event.before.snapshot.path_data, undefined);
        assert.strictEqual(event.after.path_data, undefined);
        assert.strictEqual(event.after.snapshot.path_data, undefined);
        assert.strictEqual(event.history[0].path_data, undefined);
        assert.strictEqual(event.history[0].snapshot.path_data, undefined);
        assert.strictEqual(event.history[1].path_data, undefined);
        assert.strictEqual(event.history[1].snapshot.path_data, undefined);

        assert.strictEqual(event.before.id, 'abc123');
        assert.strictEqual(event.after.top_score, 0.92);
        assert.strictEqual(event.type, 'end');
        assert.deepStrictEqual(event.after.entered_zones, ['yard', 'driveway']);
    });

    it('should handle a realistic stats message', () => {
        const stats = {
            cpu_usages: { '1': { cpu: 5.2 }, '2': { cpu: 10.1 } },
            gpu_usages: { gpu0: { mem: 200, gpu: 15 } },
            detectors: { coral: { inference_speed: 8.5, pid: 100 } },
            cameras: {
                front: { camera_fps: 5, process_fps: 5, capture_pid: 200 },
                back: { camera_fps: 10, process_fps: 10, capture_pid: 201 },
            },
            uptime: 86400,
        };
        removePathData(stats);

        assert.strictEqual(stats.gpu_usages, undefined, 'gpu_usages should be removed');
        assert.ok(stats.cpu_usages, 'cpu_usages should remain (removed separately in handleMqttMessage)');
        assert.strictEqual(stats.detectors.coral.inference_speed, 8.5);
        assert.strictEqual(stats.uptime, 86400);
    });
});

describe('MQTT ON/OFF state parsing', () => {
    it('should parse detect ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/detect/state', 'ON'), true);
    });

    it('should parse detect OFF as false', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/detect/state', 'OFF'), false);
    });

    it('should parse motion ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/motion', 'ON'), true);
    });

    it('should parse motion OFF as false', () => {
        // Note: the current code has a bug where motion OFF is always false
        // regardless of parent path because of operator precedence.
        // This test documents the actual behavior.
        const data = parseMessageData('frigate/front_door/motion', 'OFF');
        assert.strictEqual(data, false);
    });

    it('should parse recordings ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/recordings/state', 'ON'), true);
    });

    it('should parse snapshots OFF as false', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/snapshots/state', 'OFF'), false);
    });

    it('should parse audio ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/audio/state', 'ON'), true);
    });

    it('should parse ptz_autotracker ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/ptz_autotracker/state', 'ON'), true);
    });

    it('should parse all ON_OFF_STATES correctly', () => {
        for (const state of ON_OFF_STATES) {
            const topicOn = `frigate/cam/${state}/state`;
            const topicOff = `frigate/cam/${state}/state`;
            assert.strictEqual(parseMessageData(topicOn, 'ON'), true, `${state} ON should be true`);
            assert.strictEqual(parseMessageData(topicOff, 'OFF'), false, `${state} OFF should be false`);
        }
    });
});

describe('MQTT JSON payload parsing', () => {
    it('should parse JSON object', () => {
        const payload = '{"type":"end","before":{"id":"abc"}}';
        const data = parseMessageData('frigate/events', payload);
        assert.deepStrictEqual(data, { type: 'end', before: { id: 'abc' } });
    });

    it('should parse JSON array', () => {
        const data = parseMessageData('frigate/some/topic', '[1,2,3]');
        assert.deepStrictEqual(data, [1, 2, 3]);
    });

    it('should parse numeric string', () => {
        assert.strictEqual(parseMessageData('frigate/stats/uptime', '86400'), 86400);
    });

    it('should parse float string', () => {
        assert.strictEqual(parseMessageData('frigate/stats/fps', '29.97'), 29.97);
    });

    it('should parse zero', () => {
        assert.strictEqual(parseMessageData('frigate/stats/count', '0'), 0);
    });

    it('should parse negative number', () => {
        assert.strictEqual(parseMessageData('frigate/some/topic', '-5'), -5);
    });

    it('should handle invalid JSON gracefully', () => {
        const data = parseMessageData('frigate/some/topic', '{invalid json}');
        assert.strictEqual(data, undefined, 'Invalid JSON should return undefined');
    });

    it('should handle empty JSON object', () => {
        const data = parseMessageData('frigate/some/topic', '{}');
        assert.deepStrictEqual(data, {});
    });

    it('should handle empty JSON array', () => {
        const data = parseMessageData('frigate/some/topic', '[]');
        assert.deepStrictEqual(data, []);
    });

    it('should handle JSON string with quotes', () => {
        const data = parseMessageData('frigate/some/topic', '"hello"');
        assert.strictEqual(data, 'hello');
    });

    it('should treat boolean strings as plain strings (not JSON-parsed)', () => {
        // "true"/"false" are not numeric and don't contain {, [, or " so they
        // fall through to the plain string branch
        assert.strictEqual(parseMessageData('frigate/some/topic', 'true'), 'true');
        assert.strictEqual(parseMessageData('frigate/some/topic', 'false'), 'false');
    });

    it('should handle nested JSON event', () => {
        const payload = JSON.stringify({
            type: 'new',
            before: {
                id: 'event123',
                camera: 'front',
                label: 'person',
                top_score: 0.85,
                entered_zones: ['yard'],
                has_snapshot: true,
                has_clip: false,
            },
            after: {
                id: 'event123',
                camera: 'front',
                label: 'person',
                top_score: 0.91,
                entered_zones: ['yard', 'porch'],
                has_snapshot: true,
                has_clip: true,
            },
        });
        const data = parseMessageData('frigate/events', payload);
        assert.strictEqual(data.type, 'new');
        assert.strictEqual(data.after.top_score, 0.91);
        assert.deepStrictEqual(data.after.entered_zones, ['yard', 'porch']);
    });
});

describe('MQTT string payload parsing', () => {
    it('should return plain string for non-JSON, non-ON/OFF, non-numeric', () => {
        assert.strictEqual(parseMessageData('frigate/available', 'online'), 'online');
    });

    it('should return string for camera state values', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/birdseye_mode/state', 'CONTINUOUS'), 'CONTINUOUS');
    });

    it('should return string for offline status', () => {
        assert.strictEqual(parseMessageData('frigate/available', 'offline'), 'offline');
    });
});

describe('Snapshot handling', () => {
    it('should return undefined for snapshot topics', () => {
        assert.strictEqual(
            parseMessageData('frigate/front_door/person/snapshot', 'binarydata'),
            undefined,
        );
    });

    it('should return undefined for any topic ending with snapshot', () => {
        assert.strictEqual(
            parseMessageData('frigate/camera/object/snapshot', 'anything'),
            undefined,
        );
    });
});

describe('Topic path flattening', () => {
    it('should flatten camera state paths', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/detect/state', 'frigate'), ['front_door', 'detect_state']);
    });

    it('should flatten camera motion paths', () => {
        assert.deepStrictEqual(flattenPath('frigate/back_yard/motion', 'frigate'), ['back_yard', 'motion']);
    });

    it('should flatten camera snapshot paths', () => {
        assert.deepStrictEqual(flattenPath('frigate/cam1/person/snapshot', 'frigate'), ['cam1', 'person_snapshot']);
    });

    it('should not flatten stats', () => {
        assert.deepStrictEqual(flattenPath('frigate/stats', 'frigate'), ['stats']);
    });

    it('should not flatten events', () => {
        assert.deepStrictEqual(flattenPath('frigate/events', 'frigate'), ['events']);
    });

    it('should not flatten available', () => {
        assert.deepStrictEqual(flattenPath('frigate/available', 'frigate'), ['available']);
    });

    it('should not flatten reviews', () => {
        assert.deepStrictEqual(flattenPath('frigate/reviews', 'frigate'), ['reviews']);
    });

    it('should not flatten camera_activity', () => {
        assert.deepStrictEqual(flattenPath('frigate/camera_activity', 'frigate'), ['camera_activity']);
    });

    it('should work with custom prefix', () => {
        assert.deepStrictEqual(flattenPath('myfrigate/cam1/detect/state', 'myfrigate'), ['cam1', 'detect_state']);
    });

    it('should handle deep camera paths', () => {
        assert.deepStrictEqual(
            flattenPath('frigate/cam/recordings/state', 'frigate'),
            ['cam', 'recordings_state'],
        );
    });
});

describe('Notification text template', () => {
    function renderTemplate(template, message) {
        return template
            .replace(/{{source}}/g, message.source || '')
            .replace(/{{type}}/g, message.type || '')
            .replace(/{{state}}/g, message.state || '')
            .replace(/{{score}}/g, (message.score || 0).toString() || '')
            .replace(/{{status}}/g, message.status || '')
            .replace(/{{zones}}/g, (message.zones || []).join(', ') || '');
    }

    it('should render all template variables', () => {
        const text = renderTemplate('{{source}} {{type}} erkannt {{status}} {{score}}', {
            source: 'front_door',
            type: 'person',
            status: 'end',
            score: 0.92,
        });
        assert.strictEqual(text, 'front_door person erkannt end 0.92');
    });

    it('should handle missing values with empty strings', () => {
        const text = renderTemplate('{{source}} {{type}} {{zones}}', {
            source: 'cam1',
        });
        assert.strictEqual(text, 'cam1  ');
    });

    it('should render zones as comma-separated list', () => {
        const text = renderTemplate('Zones: {{zones}}', {
            zones: ['yard', 'driveway', 'porch'],
        });
        assert.strictEqual(text, 'Zones: yard, driveway, porch');
    });

    it('should handle empty zones array', () => {
        const text = renderTemplate('Zones: {{zones}}', { zones: [] });
        assert.strictEqual(text, 'Zones: ');
    });

    it('should handle score of 0', () => {
        const text = renderTemplate('Score: {{score}}', { score: 0 });
        assert.strictEqual(text, 'Score: 0');
    });

    it('should handle multiple occurrences of same variable', () => {
        const text = renderTemplate('{{source}}-{{source}}', { source: 'cam' });
        assert.strictEqual(text, 'cam-cam');
    });

    it('should handle complex realistic template', () => {
        const text = renderTemplate(
            '🚨 {{source}}: {{type}} erkannt ({{score}}) in {{zones}} - Status: {{status}}',
            {
                source: 'Haustür',
                type: 'person',
                score: 0.95,
                zones: ['Einfahrt', 'Vorgarten'],
                status: 'end',
            },
        );
        assert.strictEqual(text, '🚨 Haustür: person erkannt (0.95) in Einfahrt, Vorgarten - Status: end');
    });
});

describe('Topic path flattening — new features', () => {
    it('should not flatten notifications topics', () => {
        assert.deepStrictEqual(flattenPath('frigate/notifications/state', 'frigate'), ['notifications', 'state']);
    });

    it('should not flatten notifications/suspended', () => {
        assert.deepStrictEqual(flattenPath('frigate/notifications/suspended', 'frigate'), [
            'notifications',
            'suspended',
        ]);
    });

    it('should flatten zone object counts like camera topics', () => {
        assert.deepStrictEqual(flattenPath('frigate/yard/person', 'frigate'), ['yard', 'person']);
    });

    it('should flatten zone active object counts', () => {
        assert.deepStrictEqual(flattenPath('frigate/yard/person/active', 'frigate'), ['yard', 'person_active']);
    });

    it('should flatten audio detail topics', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/audio/dBFS', 'frigate'), ['front_door', 'audio_dBFS']);
    });

    it('should flatten classification topics', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/classification/face', 'frigate'), [
            'front_door',
            'classification_face',
        ]);
    });

    it('should flatten status role topics', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/status/detect', 'frigate'), [
            'front_door',
            'status_detect',
        ]);
    });

    it('should flatten motion_threshold topic', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/motion_threshold/state', 'frigate'), [
            'front_door',
            'motion_threshold_state',
        ]);
    });

    it('should flatten improve_contrast topic', () => {
        assert.deepStrictEqual(flattenPath('frigate/front_door/improve_contrast/state', 'frigate'), [
            'front_door',
            'improve_contrast_state',
        ]);
    });
});

describe('Audio ON/OFF parent check', () => {
    it('should parse audio/speech ON as true (parent is audio)', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/audio/speech', 'ON'), true);
    });

    it('should parse audio/bark OFF as false', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/audio/bark', 'OFF'), false);
    });

    it('should parse ptz_autotracker/active ON as true', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/ptz_autotracker/active', 'ON'), true);
    });

    it('should parse review_status as string (not ON/OFF)', () => {
        assert.strictEqual(parseMessageData('frigate/front_door/review_status', 'DETECTION'), 'DETECTION');
    });
});

describe('Frigate base URL construction', () => {
    function buildBaseUrl(friurl) {
        if (friurl?.startsWith('http')) {
            return friurl;
        }
        return `http://${friurl}`;
    }

    it('should use http:// by default for plain host:port', () => {
        assert.strictEqual(buildBaseUrl('192.168.1.100:5000'), 'http://192.168.1.100:5000');
    });

    it('should use http:// for port 8971 without explicit https', () => {
        assert.strictEqual(buildBaseUrl('192.168.1.100:8971'), 'http://192.168.1.100:8971');
    });

    it('should keep https:// when explicitly provided', () => {
        assert.strictEqual(buildBaseUrl('https://192.168.1.100:8971'), 'https://192.168.1.100:8971');
    });

    it('should keep http:// when explicitly provided', () => {
        assert.strictEqual(buildBaseUrl('http://192.168.1.100:5000'), 'http://192.168.1.100:5000');
    });

    it('should handle localhost', () => {
        assert.strictEqual(buildBaseUrl('localhost:5000'), 'http://localhost:5000');
    });

    it('should handle hostname without port', () => {
        assert.strictEqual(buildBaseUrl('frigate.local'), 'http://frigate.local');
    });

    it('should handle https with custom port', () => {
        assert.strictEqual(buildBaseUrl('https://frigate.local:9443'), 'https://frigate.local:9443');
    });
});

describe('Auth login decision', () => {
    function shouldLogin(username, password) {
        return Boolean(username && password);
    }

    it('should login when both username and password are set', () => {
        assert.strictEqual(shouldLogin('admin', 'secret'), true);
    });

    it('should not login when username is empty', () => {
        assert.strictEqual(shouldLogin('', 'secret'), false);
    });

    it('should not login when password is empty', () => {
        assert.strictEqual(shouldLogin('admin', ''), false);
    });

    it('should not login when both are empty', () => {
        assert.strictEqual(shouldLogin('', ''), false);
    });

    it('should not login when both are undefined', () => {
        assert.strictEqual(shouldLogin(undefined, undefined), false);
    });
});
