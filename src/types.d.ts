export interface FrigateAdapterConfigTyped {
    friurl: string;
    mqttMode: 'broker' | 'client';
    mqttPort: number;
    mqttHost: string;
    mqttUsername: string;
    mqttPassword: string;
    mqttTopicPrefix: string;
    webnum: number;
    notificationMinScore: number;
    notificationActive: boolean;
    notificationInstances: string;
    notificationUsers: string;
    notificationCamera: boolean;
    notificationEventSnapshot: boolean;
    notificationEventSnapshotStart: boolean;
    notificationEventSnapshotUpdate: boolean;
    notificationEventSnapshotUpdateOnce: boolean;
    notificationEventClip: boolean;
    notificationEventClipLink: boolean;
    notificationEventClipWaitTime: number;
    notificationTextTemplate: string;
    notificationExcludeList: string;
    notificationExcludeZoneList: string;
    notificationExcludeEmptyZoneList: string;
    dockerFrigate: {
        enabled: boolean;
        bind?: string;
        stopIfInstanceStopped?: boolean;
        port?: number;
        autoImageUpdate?: boolean;
        shmSize?: number;
        coral?: boolean;
        location?: string;
        yaml?: string;
        detectors: 'cpu' | 'coral' | 'auto';
        detectorsCoralType: 'usb' | 'pci';
        face_recognition: {
            enabled: boolean;
            model_size: 'small' | 'medium' | 'large';
            min_area: number;
        };
        record: {
            enabled: boolean;
            retain_days: number;
            pre_capture?: number;
            post_capture?: number;
            max_clip_length?: number;
        };
        detect: {
            enabled: boolean;
            width: number;
            height: number;
            fps: number;
        };
        objects: {
            min_score: number;
            threshold: number;
        };
        cameras: {
            ffmpeg_hwaccel_args: string;
            inputs_path: string;
            inputs_roles_detect: boolean;
            inputs_roles_record: boolean;
            inputs_roles_snapshots: boolean;
            detect_width: number;
            detect_height: number;
            detect_fps: number;
            detect_enabled: boolean;
            objects_min_score?: number;
            objects_threshold?: number;
            snapshots_enabled: boolean;
            snapshots_timestamp: boolean;
            snapshots_bounding_box: boolean;
            snapshots_retain_default: number;
        }[];
    };
}

export interface FrigateAdapterConfig extends FrigateAdapterConfigTyped {
    friurl: string;
    mqttMode: 'broker' | 'client';
    mqttPort: number | string;
    mqttHost: string;
    mqttUsername: string;
    mqttPassword: string;
    mqttTopicPrefix: string;
    webnum: number | string;
    notificationMinScore: number | string;
    notificationActive: boolean;
    notificationInstances: string;
    notificationUsers: string;
    notificationCamera: boolean;
    notificationEventSnapshot: boolean;
    notificationEventSnapshotStart: boolean;
    notificationEventSnapshotUpdate: boolean;
    notificationEventSnapshotUpdateOnce: boolean;
    notificationEventClip: boolean;
    notificationEventClipLink: boolean;
    notificationEventClipWaitTime: number | string;
    notificationTextTemplate: string;
    notificationExcludeList: string;
    notificationExcludeZoneList: string;
    notificationExcludeEmptyZoneList: string;
    dockerFrigate: {
        enabled?: boolean;
        bind?: string;
        stopIfInstanceStopped?: boolean;
        port?: string | number;
        autoImageUpdate?: boolean;
        shmSize?: string | number;
        coral?: boolean;
        location?: string;
        configType?: 'yaml' | 'ui';
        yaml?: string;
        detectors?: 'cpu' | 'coral' | 'auto';
        detectorsCoralType?: 'usb' | 'pci';
        face_recognition?: {
            enabled?: boolean;
            model_size?: 'small' | 'medium' | 'large';
            min_area?: number | string;
        };
        record?: {
            enabled?: boolean;
            retain_days?: number | string;
            pre_capture?: number | string;
            post_capture?: number | string;
            max_clip_length?: number | string;
        };
        detect?: {
            enabled?: boolean;
            width?: number | string;
            height?: number | string;
            fps?: number | string;
        };
        objects?: {
            min_score?: number;
            threshold?: number;
        };
        cameras?: {
            enabled: boolean;
            name: string;
            ffmpeg_hwaccel_args: string;
            inputs_path: string;
            inputs_roles_detect: boolean;
            inputs_roles_record: boolean;
            inputs_roles_snapshots: boolean;
            detect_width: number | string;
            detect_height: number | string;
            detect_fps: number | string;
            detect_enabled: boolean;
            objects_min_score?: number | string;
            objects_threshold?: number | string;
            snapshots_enabled: boolean;
            snapshots_timestamp: boolean;
            snapshots_bounding_box: boolean;
            snapshots_retain_default: number | string;
        }[];
    };
}
