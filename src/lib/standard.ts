/**
 * Helpers for the commands of the shared catalog of camera commands (family "camera", see HELP.md of
 * ioBroker.assistant): every camera adapter answers getCameras, snapshot, getStreamUrl, getEvents ... the same way,
 * so a client (ioBroker.assistant, pi-agent, a script) can use any of them without knowing the adapter.
 */

/** A camera as `getCameras` lists it: Frigate knows only the name, so id and name are the same */
export interface StandardCamera {
    id: string;
    name: string;
}

/** A failure in the form of the catalog */
export interface StandardError {
    error: string;
    reason?: 'BAD_REQUEST' | 'NOT_FOUND' | 'AMBIGUOUS' | 'NOT_CONNECTED' | 'NOT_SUPPORTED';
    candidates?: string[];
}

/** An event as `getEvents` lists it; times in ms since 1970 */
export interface StandardEvent {
    id: string;
    camera: string;
    label: string;
    start: number;
    end?: number;
    score?: number;
    /** A recognized name (face, license plate): the sub label of Frigate */
    name?: string;
}

/**
 * @param value an answer of the helpers below
 * @returns whether it is a failure
 */
export function isStandardError(value: object): value is StandardError {
    return 'error' in value;
}

/**
 * Find the camera the caller means: by its name, compared without case; an exact match wins over a partial one,
 * and several matches are refused instead of guessed.
 *
 * @param cameras the cameras of the instance
 * @param wanted the parameter `camera` of the message
 * @returns the camera, or the failure to answer
 */
export function findCamera<T extends StandardCamera>(cameras: T[], wanted: unknown): T | StandardError {
    const text = typeof wanted === 'number' ? String(wanted) : typeof wanted === 'string' ? wanted.trim() : '';
    if (!text) {
        return { error: 'The parameter "camera" is missing', reason: 'BAD_REQUEST' };
    }
    const exactId = cameras.find(cam => cam.id === text);
    if (exactId) {
        return exactId;
    }
    const lower = text.toLowerCase();
    const exact = cameras.filter(cam => cam.id.toLowerCase() === lower || cam.name.toLowerCase() === lower);
    const fits = exact.length
        ? exact
        : cameras.filter(cam => cam.id.toLowerCase().includes(lower) || cam.name.toLowerCase().includes(lower));
    if (fits.length === 1) {
        return fits[0];
    }
    if (fits.length > 1) {
        return { error: `"${text}" fits several cameras`, reason: 'AMBIGUOUS', candidates: fits.map(cam => cam.name) };
    }
    return { error: `Camera "${text}" not found`, reason: 'NOT_FOUND', candidates: cameras.map(cam => cam.name) };
}

/**
 * The camera to ask Frigate for in `snapshot`: a known camera by its name without case; a name the adapter does not
 * know (yet) as it is, as before the catalog, if it can be a Frigate name.
 *
 * @param cameras the cameras of the instance
 * @param wanted the parameter `camera` of the message
 * @returns the Frigate name, or the failure to answer
 */
export function snapshotCamera(cameras: StandardCamera[], wanted: unknown): string | StandardError {
    const found = findCamera(cameras, wanted);
    if (!isStandardError(found)) {
        return found.id;
    }
    const name = typeof wanted === 'string' ? wanted.trim() : '';
    // Camera names are configuration keys - refuse anything that could leave /api/<camera>/
    return found.reason === 'NOT_FOUND' && /^[A-Za-z0-9_-]+$/.test(name) ? name : found;
}

/**
 * The parameter `seconds` of `pauseNotifications`.
 *
 * @param value a number or a text of a number
 * @returns the seconds (0 or more), or NaN
 */
export function parseSeconds(value: unknown): number {
    const seconds = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : NaN;
}

/**
 * The failure of a request to Frigate in the form of the catalog.
 *
 * @param error what axios threw
 * @param notFound the failure to answer when Frigate says 404
 */
export function requestError(error: unknown, notFound: StandardError): StandardError {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
        return notFound;
    }
    return { error: error instanceof Error ? error.message : String(error), reason: 'NOT_CONNECTED' };
}

/**
 * A time of the catalog: ms since 1970 or an ISO 8601 text (without a zone = local time).
 *
 * @param value the parameter
 * @returns ms since 1970, undefined if not given, NaN if it is not a time
 */
export function parseTime(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        return /^\d+$/.test(value.trim()) ? Number(value) : Date.parse(value);
    }
    return NaN;
}

/**
 * The events of the history Frigate gave (`/api/events`, newest first) in the form of the catalog.
 *
 * @param history the parsed JSON of `events.history.json` or `<camera>.history.json`
 * @param filter only events of this camera and label (without case), starting between start and end (ms)
 * @param filter.camera the Frigate name of the camera
 * @param filter.label e.g. person, car
 * @param filter.start ms since 1970
 * @param filter.end ms since 1970
 * @param filter.limit at most this many, the newest
 */
export function toStandardEvents(
    history: unknown,
    filter: { camera?: string; label?: string; start?: number; end?: number; limit?: number },
): StandardEvent[] {
    const label = filter.label?.toLowerCase();
    const events: StandardEvent[] = [];
    for (const item of Array.isArray(history) ? (history as Record<string, unknown>[]) : []) {
        if (!item || typeof item.id !== 'string' || typeof item.start_time !== 'number') {
            continue;
        }
        const event: StandardEvent = {
            id: item.id,
            camera: typeof item.camera === 'string' ? item.camera : '',
            label: typeof item.label === 'string' ? item.label : '',
            start: Math.round(item.start_time * 1000),
        };
        if (typeof item.end_time === 'number') {
            event.end = Math.round(item.end_time * 1000);
        }
        const data = item.data as { top_score?: unknown } | undefined;
        const score = typeof item.top_score === 'number' ? item.top_score : data?.top_score;
        if (typeof score === 'number') {
            event.score = score;
        }
        // a text, or [name, score] in some versions of Frigate
        const subLabel = Array.isArray(item.sub_label) ? item.sub_label[0] : item.sub_label;
        if (typeof subLabel === 'string' && subLabel) {
            event.name = subLabel;
        }
        if (
            (filter.camera && event.camera !== filter.camera) ||
            (label && event.label.toLowerCase() !== label) ||
            (filter.start !== undefined && event.start < filter.start) ||
            (filter.end !== undefined && event.start > filter.end)
        ) {
            continue;
        }
        events.push(event);
    }
    events.sort((a, b) => b.start - a.start);
    return filter.limit && filter.limit > 0 ? events.slice(0, filter.limit) : events;
}
