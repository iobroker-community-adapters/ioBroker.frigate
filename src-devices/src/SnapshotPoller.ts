/**
 * Fetches pictures of a camera through the adapter's `snapshot` message, one after the other.
 *
 * Used by the snapshot widget all the time, and by the live widget where the MJPEG route of the web
 * adapter cannot be reached - which is the case behind the ioBroker cloud.
 */
import type { CameraRef } from './frigateCommon';

export interface SnapshotPollerOptions {
    /** The ioBroker socket of the host */
    getSocket: () => { sendTo: (instance: string, command: string, data: unknown) => Promise<any> };
    /** Camera to ask for; `null` pauses without stopping */
    getCamera: () => CameraRef | null;
    /** Parameters of the next request */
    getParams: () => { height: number; bbox: boolean; timestamp: boolean };
    /** Wanted time between two frames in milliseconds, measured from the start of a request */
    getInterval: () => number;
    /** A new frame as base64 JPEG */
    onFrame: (data: string) => void;
    onError: (error: string) => void;
}

export class SnapshotPoller {
    private readonly options: SnapshotPollerOptions;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private requesting = false;
    private running = false;
    /**
     * Bumped by every `start()` and `stop()`. An answer that arrives for an older generation belongs
     * to a camera or a run that is gone and is dropped.
     */
    private generation = 0;

    constructor(options: SnapshotPollerOptions) {
        this.options = options;
    }

    start(): void {
        this.stop();
        this.running = true;
        void this.poll();
    }

    stop(): void {
        this.running = false;
        this.generation++;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Apply a changed interval at once. Replace a waiting timer; with a request in flight there is no
     * timer, and the `finally` of `poll()` picks the new rate up anyway.
     */
    reschedule(): void {
        if (this.running && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            void this.poll();
        }
    }

    /** One `snapshot` round trip. Never runs twice in parallel - a slow connection just lowers the rate. */
    private async poll(): Promise<void> {
        const camera = this.options.getCamera();
        if (!this.running || this.requesting || !camera) {
            return;
        }
        this.requesting = true;
        const generation = this.generation;
        const startedAt = Date.now();

        try {
            const result: { data?: string; contentType?: string; error?: string } = await this.options
                .getSocket()
                .sendTo(camera.instance, 'snapshot', { camera: camera.name, ...this.options.getParams() });

            if (generation !== this.generation) {
                return;
            }

            if (result?.error) {
                this.options.onError(result.error);
            } else if (result?.data) {
                this.options.onFrame(result.data);
            } else {
                this.options.onError('No data');
            }
        } catch (e) {
            if (generation === this.generation) {
                this.options.onError((e as Error).toString());
            }
        } finally {
            this.requesting = false;
            this.scheduleNext(Date.now() - startedAt);
        }
    }

    /**
     * The round trip already took part of the interval. Counting it keeps the rate close to the wanted
     * one on a slow link like the cloud, where it would otherwise add up with the interval.
     *
     * @param elapsed duration of the request that just finished, in milliseconds
     */
    private scheduleNext(elapsed: number): void {
        if (!this.running) {
            return;
        }
        this.timer = setTimeout(
            () => {
                this.timer = null;
                void this.poll();
            },
            Math.max(0, this.options.getInterval() - elapsed),
        );
    }
}

export default SnapshotPoller;
