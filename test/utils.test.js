import assert from 'node:assert';
import { createFrigateConfigFile } from '../build/lib/utils.js';

/** Helper to build a minimal valid config, overriding specific fields */
function makeConfig(overrides = {}) {
    const base = {
        friurl: 'frigate.local:5000',
        mqttPort: 1883,
        webnum: 10,
        notificationMinScore: 0,
        notificationActive: false,
        notificationInstances: 'telegram.0',
        notificationUsers: '',
        notificationCamera: false,
        notificationEventSnapshot: true,
        notificationEventSnapshotStart: false,
        notificationEventSnapshotUpdate: false,
        notificationEventSnapshotUpdateOnce: false,
        notificationEventClip: true,
        notificationEventClipLink: false,
        notificationEventClipWaitTime: 5,
        notificationTextTemplate: '{{source}} {{type}} erkannt {{status}} {{score}}',
        notificationExcludeList: '',
        notificationExcludeZoneList: '',
        notificationExcludeEmptyZoneList: '',
        dockerFrigate: {
            enabled: false,
            bind: '0.0.0.0',
            stopIfInstanceStopped: false,
            port: 5000,
            autoImageUpdate: true,
            shmSize: 256,
            location: '/ssd/frigate',
            configType: 'ui',
            detectors: 'coral',
            detectorsCoralType: 'usb',
            face_recognition: { enabled: true, model_size: 'small', min_area: 400 },
            record: { enabled: true, retain_days: 7 },
            detect: { enabled: true, width: 1280, height: 720, fps: 5 },
            cameras: [
                {
                    enabled: true,
                    name: 'Reolink',
                    inputs_path: 'rtsp://admin:password@192.168.1.12:554/h264Preview_01_sub',
                    ffmpeg_hwaccel_args: 'preset-rpi-64-h264',
                    inputs_roles_detect: true,
                    inputs_roles_record: true,
                    inputs_roles_snapshots: true,
                    detect_width: 640,
                    detect_height: 360,
                    detect_fps: 5,
                    snapshots_timestamp: true,
                    snapshots_bounding_box: true,
                    snapshots_retain_default: 3,
                },
            ],
            ...overrides.dockerFrigate,
        },
        ...overrides,
    };
    // re-apply dockerFrigate if overrides contained it (deep merge)
    if (overrides.dockerFrigate) {
        base.dockerFrigate = { ...base.dockerFrigate, ...overrides.dockerFrigate };
    }
    return base;
}

describe('createFrigateConfigFile', () => {
    it('should generate config with coral USB detector', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('type: edgetpu'), 'Should contain edgetpu type');
        assert(config.includes('device: usb'), 'Should contain usb device');
    });

    it('should generate config with coral PCI detector', () => {
        const config = createFrigateConfigFile(
            makeConfig({ dockerFrigate: { detectors: 'coral', detectorsCoralType: 'pci' } }),
        );
        assert(config.includes('type: edgetpu'), 'Should contain edgetpu type');
        assert(config.includes('device: pci'), 'Should contain pci device');
    });

    it('should generate config with CPU detector', () => {
        const config = createFrigateConfigFile(makeConfig({ dockerFrigate: { detectors: 'cpu' } }));
        assert(config.includes('type: cpu'), 'Should contain cpu type');
        assert(!config.includes('edgetpu'), 'Should not contain edgetpu');
    });

    it('should generate config with auto detector', () => {
        const config = createFrigateConfigFile(makeConfig({ dockerFrigate: { detectors: 'auto' } }));
        assert(config.includes('type: auto'), 'Should contain auto type');
    });

    it('should use correct MQTT port', () => {
        const config = createFrigateConfigFile(makeConfig({ mqttPort: 1884 }));
        assert(config.includes('port: 1884'), 'Should contain port 1884');
    });

    it('should include camera name and RTSP path', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('Reolink:'), 'Should contain camera name');
        assert(
            config.includes('rtsp://admin:password@192.168.1.12:554/h264Preview_01_sub'),
            'Should contain RTSP path',
        );
    });

    it('should include camera roles', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('- detect'), 'Should contain detect role');
        assert(config.includes('- record'), 'Should contain record role');
        assert(config.includes('- snapshots'), 'Should contain snapshots role');
    });

    it('should omit roles when disabled', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    cameras: [
                        {
                            enabled: true,
                            name: 'TestCam',
                            inputs_path: 'rtsp://test',
                            ffmpeg_hwaccel_args: '',
                            inputs_roles_detect: true,
                            inputs_roles_record: false,
                            inputs_roles_snapshots: false,
                            detect_width: 640,
                            detect_height: 360,
                            detect_fps: 5,
                            snapshots_timestamp: false,
                            snapshots_bounding_box: false,
                            snapshots_retain_default: 10,
                        },
                    ],
                },
            }),
        );
        assert(config.includes('- detect'), 'Should contain detect role');
        assert(!config.includes('- record'), 'Should not contain record role');
        assert(!config.includes('- snapshots'), 'Should not contain snapshots role');
    });

    it('should include camera detect settings', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('width: 640'), 'Should contain detect width');
        assert(config.includes('height: 360'), 'Should contain detect height');
        assert(config.includes('fps: 5'), 'Should contain detect fps');
    });

    it('should include snapshot settings', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('timestamp: true'), 'Should contain timestamp');
        assert(config.includes('bounding_box: true'), 'Should contain bounding_box');
        assert(config.includes('default: 3'), 'Should contain retain default');
    });

    it('should include record settings', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('record:'), 'Should contain record section');
        assert(config.includes('days: 7'), 'Should contain retain days');
    });

    it('should include record event options when set', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    record: { enabled: true, retain_days: 7, pre_capture: 5, post_capture: 10, max_clip_length: 300 },
                },
            }),
        );
        assert(config.includes('pre_capture: 5'), 'Should contain pre_capture');
        assert(config.includes('post_capture: 10'), 'Should contain post_capture');
        assert(config.includes('max_clip_length: 300'), 'Should contain max_clip_length');
    });

    it('should not include record event options when not set', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(!config.includes('pre_capture'), 'Should not contain pre_capture');
        assert(!config.includes('post_capture'), 'Should not contain post_capture');
        assert(!config.includes('max_clip_length'), 'Should not contain max_clip_length');
    });

    it('should include face_recognition settings', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('face_recognition:'), 'Should contain face_recognition section');
        assert(config.includes('enabled: true'), 'Should contain enabled');
        assert(config.includes('model_size: small'), 'Should contain model_size');
        assert(config.includes('min_area: 400'), 'Should contain min_area');
    });

    it('should include global detect settings', () => {
        const config = createFrigateConfigFile(makeConfig());
        // Global detect section (not camera-specific)
        const lines = config.split('\n');
        // Find the global detect section (after record)
        let foundGlobalDetect = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('detect:')) {
                foundGlobalDetect = true;
                break;
            }
        }
        assert(foundGlobalDetect, 'Should contain global detect section');
        assert(config.includes('width: 1280'), 'Should contain global detect width');
        assert(config.includes('height: 720'), 'Should contain global detect height');
    });

    it('should include version string', () => {
        const config = createFrigateConfigFile(makeConfig());
        assert(config.includes('version: 0.16-0'), 'Should contain version');
    });

    it('should skip disabled cameras', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    cameras: [
                        {
                            enabled: false,
                            name: 'DisabledCam',
                            inputs_path: 'rtsp://disabled',
                            ffmpeg_hwaccel_args: '',
                            inputs_roles_detect: true,
                            inputs_roles_record: true,
                            inputs_roles_snapshots: true,
                            detect_width: 640,
                            detect_height: 360,
                            detect_fps: 5,
                            snapshots_timestamp: true,
                            snapshots_bounding_box: true,
                            snapshots_retain_default: 10,
                        },
                    ],
                },
            }),
        );
        assert(!config.includes('DisabledCam'), 'Should not contain disabled camera');
    });

    it('should skip cameras without name', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    cameras: [
                        {
                            enabled: true,
                            name: '',
                            inputs_path: 'rtsp://noname',
                            ffmpeg_hwaccel_args: '',
                            inputs_roles_detect: true,
                            inputs_roles_record: false,
                            inputs_roles_snapshots: false,
                            detect_width: 640,
                            detect_height: 360,
                            detect_fps: 5,
                            snapshots_timestamp: false,
                            snapshots_bounding_box: false,
                            snapshots_retain_default: 10,
                        },
                    ],
                },
            }),
        );
        assert(!config.includes('rtsp://noname'), 'Should not contain camera without name');
    });

    it('should handle multiple cameras', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    cameras: [
                        {
                            enabled: true,
                            name: 'FrontDoor',
                            inputs_path: 'rtsp://front',
                            ffmpeg_hwaccel_args: '',
                            inputs_roles_detect: true,
                            inputs_roles_record: true,
                            inputs_roles_snapshots: true,
                            detect_width: 640,
                            detect_height: 360,
                            detect_fps: 5,
                            snapshots_timestamp: true,
                            snapshots_bounding_box: true,
                            snapshots_retain_default: 5,
                        },
                        {
                            enabled: true,
                            name: 'BackYard',
                            inputs_path: 'rtsp://back',
                            ffmpeg_hwaccel_args: 'preset-vaapi',
                            inputs_roles_detect: true,
                            inputs_roles_record: false,
                            inputs_roles_snapshots: true,
                            detect_width: 1280,
                            detect_height: 720,
                            detect_fps: 10,
                            snapshots_timestamp: false,
                            snapshots_bounding_box: false,
                            snapshots_retain_default: 7,
                        },
                    ],
                },
            }),
        );
        assert(config.includes('FrontDoor:'), 'Should contain first camera');
        assert(config.includes('BackYard:'), 'Should contain second camera');
        assert(config.includes('rtsp://front'), 'Should contain first camera path');
        assert(config.includes('rtsp://back'), 'Should contain second camera path');
        assert(config.includes('preset-vaapi'), 'Should contain hwaccel for second camera');
    });

    it('should include camera-specific objects config when min_score is set', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    cameras: [
                        {
                            enabled: true,
                            name: 'TestCam',
                            inputs_path: 'rtsp://test',
                            ffmpeg_hwaccel_args: '',
                            inputs_roles_detect: true,
                            inputs_roles_record: false,
                            inputs_roles_snapshots: false,
                            detect_width: 640,
                            detect_height: 360,
                            detect_fps: 5,
                            objects_min_score: 50,
                            objects_threshold: 70,
                            snapshots_timestamp: false,
                            snapshots_bounding_box: false,
                            snapshots_retain_default: 10,
                        },
                    ],
                },
            }),
        );
        assert(config.includes('min_score: 0.5'), 'Should contain camera-specific min_score');
        assert(config.includes('threshold: 0.7'), 'Should contain camera-specific threshold');
    });

    it('should use raw YAML when configType is yaml', () => {
        const customYaml = 'mqtt:\n  host: custom\n  port: 9999\n';
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    configType: 'yaml',
                    yaml: customYaml,
                },
            }),
        );
        assert.strictEqual(config, customYaml, 'Should return raw YAML');
    });

    it('should handle empty cameras array', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: { cameras: [] },
            }),
        );
        assert(config.includes('cameras:'), 'Should still contain cameras section');
        assert(config.includes('mqtt:'), 'Should still contain mqtt section');
    });

    it('should handle undefined cameras', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: { cameras: undefined },
            }),
        );
        assert(config.includes('cameras:'), 'Should still contain cameras section');
    });

    it('should include global objects config when min_score is set', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    objects: { min_score: 60, threshold: 80 },
                },
            }),
        );
        assert(config.includes('objects:'), 'Should contain global objects section');
        assert(config.includes('min_score: 0.6'), 'Should contain min_score divided by 100');
        assert(config.includes('threshold: 0.8'), 'Should contain threshold divided by 100');
    });

    it('should not include global objects config when min_score is 0', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    objects: { min_score: 0, threshold: 0 },
                },
            }),
        );
        // objects section should not appear at the end (only camera-level might)
        const lines = config.split('\n');
        let hasGlobalObjects = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === 'objects:') {
                hasGlobalObjects = true;
            }
        }
        assert(!hasGlobalObjects, 'Should not contain global objects section when min_score is 0');
    });

    it('should handle record disabled', () => {
        const config = createFrigateConfigFile(
            makeConfig({
                dockerFrigate: {
                    record: { enabled: false, retain_days: 0 },
                },
            }),
        );
        assert(config.includes('enabled: false'), 'Should contain record enabled false');
    });
});
