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
