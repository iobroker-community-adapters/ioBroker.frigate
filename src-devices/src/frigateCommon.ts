/**
 * Helpers shared by both Frigate widgets.
 *
 * The settings dialog picks the instance and then the camera by name, the list being served by the
 * adapter itself (`frigate:getCameras`). Widgets configured before that existed stored a single
 * object id instead, so that form is still understood - see `resolveCamera()`.
 */

export interface CameraRef {
    /** Instance number as string, e.g. "0" */
    instanceId: string;
    /** Camera name as configured in Frigate, e.g. "Vorgarten" */
    name: string;
    /** Full instance id, e.g. "frigate.0" */
    instance: string;
}

/**
 * Build the camera reference from the widget settings.
 *
 * @param settings the widget settings
 * @param settings.instance instance chosen in the dialog, e.g. `frigate.0`
 * @param settings.camera camera name chosen in the dialog
 * @param settings.cameraObjectId object id stored by older versions of the widget
 */
export function resolveCamera(settings: {
    instance?: string;
    camera?: string;
    cameraObjectId?: string;
}): CameraRef | null {
    if (settings.camera) {
        const instance = settings.instance || 'frigate.0';
        const instanceId = instance.split('.')[1] || '0';
        return { instanceId, name: settings.camera, instance: `frigate.${instanceId}` };
    }

    // Widgets that still carry the object id of the old picker
    return parseCameraId(settings.cameraObjectId);
}

/**
 * Branches below `frigate.<n>.` that are not cameras. Everything else at that level is one.
 */
const NOT_A_CAMERA = ['stats', 'events', 'info', 'remote', 'notification', 'zones'];

/**
 * Turn `frigate.0.Vorgarten` or any state below it into `{ instanceId: '0', name: 'Vorgarten' }`.
 *
 * @param id the object id picked in the settings dialog
 */
export function parseCameraId(id: string | undefined | null): CameraRef | null {
    if (!id) {
        return null;
    }

    const parts = id.split('.');
    if (parts[0] !== 'frigate' || parts.length < 3) {
        return null;
    }

    const instanceId = parts[1];
    // Cameras are always devices directly below the instance, so the third part is the name -
    // no matter whether the user picked the device itself or one of its states
    const name = parts[2];
    if (!name || NOT_A_CAMERA.includes(name)) {
        return null;
    }

    return { instanceId, name, instance: `frigate.${instanceId}` };
}

/**
 * Base64 payload from the adapter -> data URL for an `<img>`
 *
 * @param base64 the encoded picture
 * @param contentType mime type reported by Frigate
 */
export function toDataUrl(base64: string, contentType = 'image/jpeg'): string {
    return `data:${contentType};base64,${base64}`;
}

/**
 * Build the URL of a route served by the web extension.
 *
 * With an empty `webUrl` the URL stays relative, which is what is needed when the Devices UI is
 * served by a web instance. Inside admin (port 8081) these routes do not exist, so there the user
 * has to name the web instance explicitly, e.g. `http://192.168.1.5:8082`.
 *
 * @param webUrl configured base URL of the web instance, may be empty
 * @param camera the camera reference
 * @param file the file below the camera route, e.g. `stream.mjpeg`
 * @param query additional query parameters
 */
export function buildWebUrl(
    webUrl: string | undefined,
    camera: CameraRef,
    file: string,
    query?: Record<string, string | number | undefined>,
): string {
    const base = (webUrl || '').replace(/\/+$/, '');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== '' && value !== 0) {
            params.append(key, String(value));
        }
    }
    const search = params.toString();
    return `${base}/${camera.instance}/${camera.name}/${file}${search ? `?${search}` : ''}`;
}
