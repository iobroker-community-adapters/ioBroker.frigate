export interface FrigateAdapterConfigTyped {
    friurl: string;
    mqttPort: number;
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
        };
        detect: {
            enabled: boolean;
            width: number;
            height: number;
            fps: number;
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
            snapshots_enabled: boolean;
            snapshots_timestamp: boolean;
            snapshots_bounding_box: boolean;
            snapshots_retain_default: number;
        }[];
    };
}

export interface FrigateAdapterConfig extends FrigateAdapterConfigTyped {
    friurl: string;
    mqttPort: number | string;
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
    };
}
