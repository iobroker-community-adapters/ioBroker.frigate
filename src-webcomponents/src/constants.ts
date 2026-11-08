/**
 * The web components of the frigate adapter. Each one is built on its own (`vite build --mode <name>`, see
 * `vite.config.ts`), so that each is ONE module file: a host imports exactly one URL per component.
 *
 * Both show the picture of one Frigate camera, like the devices widgets of `src-devices/`:
 * - `<iob-frigate-snapshot>` asks the adapter for a still picture over the socket (`snapshot`), again and again;
 * - `<iob-frigate-live>` shows the MJPEG stream of the web extension (`build/lib/web.js`), whose address the
 *   adapter works out (`frigate:getWebUrl`), and takes single pictures over the socket where the stream fails.
 */

/** Name of a component: the mode of its build and the base name of its files */
export type ComponentName = 'frigate-snapshot' | 'frigate-live';

export const COMPONENT_NAMES: ComponentName[] = ['frigate-snapshot', 'frigate-live'];

/** Tag of `<iob-frigate-snapshot>`: a still picture of a camera, fetched again in an interval */
export const SNAPSHOT_TAG = 'iob-frigate-snapshot';

/** Tag of `<iob-frigate-live>`: the live MJPEG stream of a camera through the web adapter */
export const LIVE_TAG = 'iob-frigate-live';

/** The devices widget of each component (`common.deviceWidgets.components[].name`): its label is the name */
export const DEVICES_WIDGETS: Record<ComponentName, string> = {
    'frigate-snapshot': 'SnapshotComponent',
    'frigate-live': 'LiveComponent',
};

/**
 * The words of the devices widgets (`src-devices/src/i18n/`) the element shows. The build picks them for each
 * component (`__FRIGATE_WORDS__`, see `src/i18n.ts`)
 */
export const DEVICES_WORDS: Record<ComponentName, string[]> = {
    'frigate-snapshot': ['frigate_no_camera', 'frigate_loading'],
    'frigate-live': [
        'frigate_no_camera',
        'frigate_loading',
        'frigate_stream_needs_web',
        'frigate_web_disabled',
        'frigate_web_error',
        'frigate_web_noAddress',
        'frigate_web_noInstance',
    ],
};

/** The built module, next to its manifest */
export function getModuleFile(name: ComponentName): string {
    return `${name}.js`;
}

/** The manifest the build writes next to the module; `common.webComponents` names this one */
export function getManifestFile(name: ComponentName): string {
    return `${name}.json`;
}

/** Where `tasks.ts` puts the module in the admin folder; the React import is relative to it */
export function getModulePath(name: ComponentName): string {
    return `webcomponents/${getModuleFile(name)}`;
}

/** The settings both components have; a setting without a value is missing */
export type CameraSettings = {
    /** The camera device `frigate.<n>.<camera>`, or a state below it */
    camera?: string;
    /** Show the name below the picture */
    showName?: boolean;
    /** Instead of the name of the camera */
    name?: string;
    /** Height of the picture of the tile in px, as text: a `select` */
    height?: string;
    /** Let Frigate draw the detection boxes into the picture */
    bbox?: boolean;
    /** Let Frigate draw the timestamp into the picture */
    timestamp?: boolean;
};

/** The values of the settings of `<iob-frigate-snapshot>` */
export type SnapshotSettings = CameraSettings & {
    /** ms between two pictures of the tile */
    pollingInterval?: number;
    /** ms between two pictures while the enlarged view is open */
    dialogPollingInterval?: number;
};

/** The values of the settings of `<iob-frigate-live>` */
export type LiveSettings = CameraSettings & {
    /** Base URL of the web instance, e.g. `http://192.168.1.5:8082`; empty: the adapter works it out */
    webUrl?: string;
    /** Frames per second requested from Frigate */
    fps?: number;
};

/** The heights of the tile picture to choose from, in px */
export const HEIGHTS = ['240', '360', '480', '720', '1080'];

/** Height of the tile picture without a setting, in px */
export const DEFAULT_HEIGHT = 480;

/** Height of the picture of the enlarged view, in px - as in the devices widgets */
export const FULL_HEIGHT = 720;

/**
 * The height Frigate scales the picture to
 *
 * @param settings the settings of the element
 * @param full true for the enlarged view
 */
export function getPictureHeight(settings: CameraSettings, full: boolean): number {
    if (full) {
        return FULL_HEIGHT;
    }
    const height = parseInt(settings.height || '', 10);
    return height > 0 ? height : DEFAULT_HEIGHT;
}

/**
 * ms between two pictures of the snapshot - within the bounds of its settings, as in the devices widget
 *
 * @param settings the settings of the element
 * @param full true while the enlarged view is open
 */
export function getPollInterval(settings: SnapshotSettings, full: boolean): number {
    if (full) {
        return Math.max(200, Number(settings.dialogPollingInterval) || 500);
    }
    return Math.max(500, Number(settings.pollingInterval) || 2000);
}

/**
 * Frames per second of the live view, within the bounds of its settings
 *
 * @param settings the settings of the element
 */
export function getFps(settings: LiveSettings): number {
    return Math.min(30, Math.max(1, Math.round(Number(settings.fps)) || 5));
}

/** How long to wait for `frigate:getWebUrl`. An adapter too old to know the command never answers. */
export const RESOLVE_TIMEOUT = 3000;

/** How long a stream may take for its first frame before the pictures are taken over the socket */
export const STREAM_TIMEOUT = 10000;
