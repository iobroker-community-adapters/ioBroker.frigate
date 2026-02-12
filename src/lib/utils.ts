import type { FrigateAdapterConfig } from '../types';

export function createFrigateConfigFile(config: FrigateAdapterConfig): string {
    if (config.dockerFrigate.configType === 'yaml' && config.dockerFrigate.yaml) {
        return config.dockerFrigate.yaml;
    }
    const cameras: string[] = [];
    for (const camera of config.dockerFrigate.cameras || []) {
        if (camera.enabled && camera.name && camera.inputs_path) {
            cameras.push(`  ${camera.name}:
    ffmpeg:
      ${camera.ffmpeg_hwaccel_args ? `hwaccel_args: ${camera.ffmpeg_hwaccel_args}` : ''}
      inputs:
        - path: ${camera.inputs_path}
${camera.inputs_roles_detect || camera.inputs_roles_record || camera.inputs_roles_snapshots ? '          roles:\n' : ''}${camera.inputs_roles_detect ? '            - detect\n' : ''}${camera.inputs_roles_record ? '            - record\n' : ''}${camera.inputs_roles_snapshots ? '            - snapshots\n' : ''}
    detect:
      enabled: ${camera.inputs_roles_detect ? 'true' : 'false'}
${camera.detect_width ? `      width: ${camera.detect_width}` : ''}
${camera.detect_height ? `      height: ${camera.detect_height}` : ''}
${camera.detect_fps ? `      fps: ${camera.detect_fps}` : ''}
    snapshots:
      enabled: ${camera.inputs_roles_snapshots ? 'true' : 'false'}
      timestamp: ${camera.snapshots_timestamp ? 'true' : 'false'}
      bounding_box: ${camera.snapshots_bounding_box ? 'true' : 'false'}
      retain:
        default: ${camera.snapshots_retain_default || 10}
`);
        }
    }
    const text = `mqtt:
  host: 172.17.0.1
  port: ${config.mqttPort}

detectors:
  ${
      config.dockerFrigate.detectors === 'cpu'
          ? `cpu:
    type: cpu
`
          : config.dockerFrigate.detectors === 'coral'
            ? `coral:
    type: edgetpu
    device: usb
`
            : `standard_detector:
    type: auto
`
  }
face_recognition:
  enabled: ${config.dockerFrigate.face_recognition?.enabled ? 'true' : 'false'}
  model_size: ${config.dockerFrigate.face_recognition?.model_size || 'medium'}
  min_area: ${config.dockerFrigate.face_recognition?.min_area || 400}

cameras:
${cameras.join('\n')}
record:
  enabled: ${config.dockerFrigate.record?.enabled ? 'true' : 'false'}
  retain:
    days: ${config.dockerFrigate.record?.retain_days || 7}
detect:
  enabled: ${config.dockerFrigate.detect?.enabled ? 'true' : 'false'}
${config.dockerFrigate.detect?.width ? `  width: ${config.dockerFrigate.detect.width}` : ''}
${config.dockerFrigate.detect?.height ? `  height: ${config.dockerFrigate.detect.height}` : ''}
${config.dockerFrigate.detect?.fps ? `  fps: ${config.dockerFrigate.detect.fps}` : ''}
version: 0.16-0
`;
    return text;
}
