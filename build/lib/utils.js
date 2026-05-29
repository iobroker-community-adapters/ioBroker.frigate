function generateObjectsConfig(config) {
    const objects = config.dockerFrigate.objects;
    if (!objects?.min_score) {
        return '';
    }
    let result = 'objects:\n';
    // Generate filters section
    result += '  filters:\n';
    result += `    person:\n`;
    result += `      min_score: ${objects.min_score / 100}\n`;
    if (objects.threshold !== undefined) {
        result += `      threshold: ${objects.threshold / 100}\n`;
    }
    return result;
}
export function createFrigateConfigFile(config) {
    if (config.dockerFrigate.configType === 'yaml' && config.dockerFrigate.yaml) {
        return config.dockerFrigate.yaml;
    }
    const cameras = [];
    const go2rtcStreams = [];
    for (const camera of config.dockerFrigate.cameras || []) {
        if (camera.enabled && camera.name && camera.inputs_path) {
            // Generate camera-specific objects config if track list and/or min_score are set
            let cameraObjectsConfig = '';
            const trackList = (Array.isArray(camera.objects_track) ? camera.objects_track : (camera.objects_track || '').split(','))
                .map(s => s.trim())
                .filter(Boolean);
            const hasFilters = !!camera.objects_min_score;
            if (trackList.length || hasFilters) {
                cameraObjectsConfig = '    objects:\n';
                if (trackList.length) {
                    cameraObjectsConfig += `      track:\n${trackList.map(o => `        - ${o}`).join('\n')}\n`;
                }
                if (hasFilters) {
                    const minScore = Number(camera.objects_min_score) / 100;
                    const threshold = camera.objects_threshold ? Number(camera.objects_threshold) / 100 : null;
                    cameraObjectsConfig += `      filters:
        person:
          min_score: ${minScore}
${threshold ? `          threshold: ${threshold}\n` : ''}`;
                }
            }
            const useGo2rtc = !!camera.use_go2rtc;
            if (useGo2rtc) {
                go2rtcStreams.push(`    ${camera.name}:\n      - ${camera.inputs_path}`);
            }
            const inputPath = useGo2rtc ? `rtsp://127.0.0.1:8554/${camera.name}` : camera.inputs_path;
            const inputArgsLine = useGo2rtc ? '          input_args: preset-rtsp-restream\n' : '';
            cameras.push(`  ${camera.name}:
    ffmpeg:
      ${camera.ffmpeg_hwaccel_args ? `hwaccel_args: ${camera.ffmpeg_hwaccel_args}` : ''}
      inputs:
        - path: ${inputPath}
${inputArgsLine}${camera.inputs_roles_detect || camera.inputs_roles_record || camera.inputs_roles_snapshots ? '          roles:\n' : ''}${camera.inputs_roles_detect ? '            - detect\n' : ''}${camera.inputs_roles_record ? '            - record\n' : ''}${camera.inputs_roles_snapshots ? '            - snapshots\n' : ''}
    detect:
      enabled: ${camera.inputs_roles_detect ? 'true' : 'false'}
${camera.detect_width ? `      width: ${camera.detect_width}` : ''}
${camera.detect_height ? `      height: ${camera.detect_height}` : ''}
${camera.detect_fps ? `      fps: ${camera.detect_fps}` : ''}
${cameraObjectsConfig}    snapshots:
      enabled: ${camera.inputs_roles_snapshots ? 'true' : 'false'}
      timestamp: ${camera.snapshots_timestamp ? 'true' : 'false'}
      bounding_box: ${camera.snapshots_bounding_box ? 'true' : 'false'}
      retain:
        default: ${camera.snapshots_retain_default || 10}
`);
        }
    }
    const go2rtcBlock = go2rtcStreams.length
        ? `go2rtc:
  streams:
${go2rtcStreams.join('\n')}

`
        : '';
    const text = `mqtt:
  host: 172.17.0.1
  port: ${config.mqttPort}

${go2rtcBlock}detectors:
  ${config.dockerFrigate.detectors === 'cpu'
        ? `cpu:
    type: cpu
`
        : config.dockerFrigate.detectors === 'coral'
            ? `coral:
    type: edgetpu
    device: ${config.dockerFrigate.detectorsCoralType || 'usb'}
`
            : `standard_detector:
    type: auto
`}
face_recognition:
  enabled: ${config.dockerFrigate.face_recognition?.enabled ? 'true' : 'false'}
  model_size: ${config.dockerFrigate.face_recognition?.model_size || 'medium'}
  min_area: ${config.dockerFrigate.face_recognition?.min_area || 400}

lpr:
  enabled: ${config.dockerFrigate.lpr?.enabled ? 'true' : 'false'}
  device: ${config.dockerFrigate.lpr?.device || 'CPU'}
  model_size: ${config.dockerFrigate.lpr?.model_size || 'small'}

cameras:
${cameras.join('\n')}
record:
  enabled: ${config.dockerFrigate.record?.enabled ? 'true' : 'false'}
  retain:
    days: ${config.dockerFrigate.record?.retain_days || 7}
${config.dockerFrigate.record?.pre_capture || config.dockerFrigate.record?.post_capture || config.dockerFrigate.record?.max_clip_length ? `  events:\n${config.dockerFrigate.record?.pre_capture ? `    pre_capture: ${config.dockerFrigate.record.pre_capture}\n` : ''}${config.dockerFrigate.record?.post_capture ? `    post_capture: ${config.dockerFrigate.record.post_capture}\n` : ''}${config.dockerFrigate.record?.max_clip_length ? `    max_clip_length: ${config.dockerFrigate.record.max_clip_length}\n` : ''}` : ''}detect:
  enabled: ${config.dockerFrigate.detect?.enabled ? 'true' : 'false'}
${config.dockerFrigate.detect?.width ? `  width: ${config.dockerFrigate.detect.width}\n` : ''}${config.dockerFrigate.detect?.height ? `  height: ${config.dockerFrigate.detect.height}\n` : ''}${config.dockerFrigate.detect?.fps ? `  fps: ${config.dockerFrigate.detect.fps}\n` : ''}${generateObjectsConfig(config)}
version: 0.16-0
`;
    return text;
}
//# sourceMappingURL=utils.js.map