import assert from 'node:assert';
import { createFrigateConfigFile } from '../build/lib/utils.js';

describe('utils', () => {
    it('should create frigate config file', () => {
        const config = createFrigateConfigFile({
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
                face_recognition: {
                    enabled: true,
                    model_size: 'small',
                    min_area: 400,
                },
                record: {
                    enabled: true,
                    retain_days: 7,
                },
                detect: {
                    enabled: true,
                    width: 1280,
                    height: 720,
                    fps: 5,
                },
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
            },
        });

        assert(
            config ===
                `mqtt:
  host: 172.17.0.1
  port: 1883

detectors:
  coral:
    type: edgetpu
    device: usb

face_recognition:
  enabled: true
  model_size: small
  min_area: 400

cameras:
  Reolink:
    ffmpeg:
      hwaccel_args: preset-rpi-64-h264
      inputs:
        - path: rtsp://admin:password@192.168.1.12:554/h264Preview_01_sub
          roles:
            - detect
            - record
            - snapshots
    detect:
      enabled: true
      width: 640
      height: 360
      fps: 5
    snapshots:
      enabled: true
      timestamp: true
      bounding_box: true
      retain:
        default: 3

record:
  enabled: true
  retain:
    days: 7
detect:
  enabled: true
  width: 1280
  height: 720
  fps: 5
version: 0.16-0
`,
            'Config file is not correct',
        );
    });
});
