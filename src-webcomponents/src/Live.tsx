/**
 * The live picture of a Frigate camera as a web component: `<iob-frigate-live>` - the web component of the devices
 * widget "Frigate Live" (`src-devices/src/LiveComponent.tsx`), and it works the same way.
 *
 * One module for every host - vis-2, devices, Aura, admin (`@iobroker/web-components`). Its manifest is a file of
 * its own (`frigate-live.json`, written by the build from `manifest.ts`), so a host loads this module only when it
 * shows the element. The host sets `socket` and `settings`, and if it has them `theme`, `editMode` and `dialogs`.
 *
 * The picture is the MJPEG stream of the web extension of the adapter (`src/lib/web.ts`):
 * `<web instance>/<route><camera>/stream.mjpeg`, in a plain `<img>`. That route belongs to the web adapter, while
 * the page may come from admin or anywhere else, so the element asks the adapter where its web instance is reachable
 * from this browser (`frigate:getWebUrl`) - unless the settings name it. Where that is the origin of the page, the
 * URL stays relative.
 *
 * Where there is no stream, the pictures come over the socket instead, one after the other at the frame rate of the
 * settings (`snapshot`, like `<iob-frigate-snapshot>`): always behind the ioBroker cloud, which relays the socket
 * but no endless response; when the adapter names no address; and when the stream does not load or gives no frame.
 *
 * React is not in the module: it comes from `lib/esm/react-19.js` beside `adapter/`, see `vite.config.ts`.
 */
import { defineWebComponent } from '@iobroker/web-components/element';

import { buildWebUrl, isCloud, toDataUrl } from '../../src-devices/src/frigateCommon';
import SnapshotPoller from '../../src-devices/src/SnapshotPoller';
import { FrigateCameraElement, type PictureView } from './CameraElement';
import { getFps, getPictureHeight, LIVE_TAG, RESOLVE_TIMEOUT, type LiveSettings } from './constants';

/** Answer of `frigate:getWebUrl`, see `getWebUrl()` in src/main.ts */
interface WebUrlAnswer {
    url?: string;
    route?: string;
    reason?: string;
}

/** What the adapter said about its web instance */
interface WebInfo {
    /** The adapter answered, or waiting for it was given up */
    resolved: boolean;
    /** Base URL of the web instance as seen from this browser, e.g. `http://192.168.1.5:8082` */
    url: string;
    /** Route of the extension, e.g. `frigate.0/` */
    route: string;
    /** Why there is no URL: a code of `getWebUrl()`; empty when there is one or the adapter said nothing */
    reason: string;
}

const NO_WEB: WebInfo = { resolved: false, url: '', route: '', reason: '' };

/** The reason codes of `frigate:getWebUrl` and the words of the devices widget for them */
const REASON_WORDS: Record<string, `frigate_${string}`> = {
    disabled: 'frigate_web_disabled',
    noInstance: 'frigate_web_noInstance',
    noAddress: 'frigate_web_noAddress',
    error: 'frigate_web_error',
};

class FrigateLiveElement extends FrigateCameraElement<LiveSettings> {
    /** Opened through the ioBroker cloud: single pictures over the socket instead of the stream */
    readonly #cloud = isCloud();

    #web: WebInfo = NO_WEB;

    /** Bumped by every question to the adapter, so that an answer or a timeout of an older one is dropped */
    #resolveGeneration = 0;

    /** The stream failed: the pictures come over the socket until the camera or the settings change */
    #streamFailed = false;

    /** Bumped by every start, so that the `<img>` of the stream is a new one and opens it again */
    #reload = 0;

    /** Base64 JPEG of the newest picture over the socket */
    #frame = '';

    /** Why the last picture over the socket did not come; empty after a picture */
    #error = '';

    /** Whether the poller runs, see `syncDelivery()` */
    #polling = false;

    readonly #poller = new SnapshotPoller({
        // the poller runs with a socket only, see `syncDelivery()`
        getSocket: () => this.socket!,
        getCamera: () => (this.socket ? this.camera : null),
        getParams: () => ({
            height: getPictureHeight(this.settings, this.dialogOpen),
            bbox: !!this.settings.bbox,
            timestamp: !!this.settings.timestamp,
        }),
        getInterval: () => 1000 / getFps(this.settings),
        onFrame: frame => {
            this.#frame = frame;
            this.#error = '';
            this.render();
        },
        onError: error => {
            this.#error = error;
            this.render();
        },
    });

    /** A web instance typed into the settings gives the stream another chance */
    protected override getRestartKey(settings: LiveSettings): string {
        return settings.webUrl || '';
    }

    protected startCamera(): void {
        this.#streamFailed = false;
        this.#frame = '';
        this.#error = '';
        this.#reload++;
        if (!this.#cloud) {
            void this.#resolveWebUrl();
        }
    }

    protected stopCamera(): void {
        // an answer still on its way belongs to another camera or socket
        this.#resolveGeneration++;
        this.#web = NO_WEB;
    }

    /** Keep the poller running exactly as long as the pictures come over the socket */
    protected override syncDelivery(): void {
        const wanted = this.isRunning && this.#useSocket();
        if (wanted !== this.#polling) {
            this.#polling = wanted;
            if (wanted) {
                this.#poller.start();
            } else {
                this.#poller.stop();
            }
        }
    }

    /** The enlarged view asks for a bigger picture: fetch it now, not after the running interval */
    protected override onDialogToggled(): void {
        this.#poller.reschedule();
    }

    /**
     * Ask the adapter where its camera proxy is reachable, instead of making the user type it: it follows its own
     * `webInstance` setting to the web instance, that one to its host, and the host to an address in the subnet of
     * this browser - all of which it can see and the element cannot.
     */
    async #resolveWebUrl(): Promise<void> {
        const socket = this.socket;
        const camera = this.camera;
        if (!socket || !camera) {
            return;
        }
        const instance = camera.instance;
        const generation = ++this.#resolveGeneration;
        this.#web = NO_WEB;

        // do not keep the tile waiting for an adapter that answers late or never: the pictures come over the
        // socket meanwhile, and a late answer with an address still switches to the stream
        const timer = setTimeout(() => {
            if (generation === this.#resolveGeneration) {
                console.warn(
                    `[frigate] "frigate:getWebUrl" to ${instance}: no answer within ${RESOLVE_TIMEOUT} ms. Taking the pictures over the socket meanwhile.`,
                );
                this.#web = { ...this.#web, resolved: true };
                this.render();
            }
        }, RESOLVE_TIMEOUT);

        let answer: WebUrlAnswer | undefined;
        // why no address came back, for the console - the tile itself just shows the pictures
        let problem = '';
        try {
            answer = await socket.sendTo<WebUrlAnswer>(instance, 'frigate:getWebUrl', {
                hostname: window.location.hostname,
            });
            if (!answer?.url && !answer?.reason) {
                problem = `answer without an address: ${JSON.stringify(answer)}`;
            }
        } catch (error) {
            problem = `request failed: ${String(error)}`;
        } finally {
            clearTimeout(timer);
        }

        if (generation !== this.#resolveGeneration) {
            return;
        }
        if (problem) {
            console.warn(
                `[frigate] "frigate:getWebUrl" to ${instance}: ${problem}. Taking the pictures over the socket.`,
            );
        }
        this.#web = {
            resolved: true,
            url: answer?.url || '',
            route: answer?.route || '',
            // only a code the adapter really sent counts; without an address and a code the socket takes over
            reason: answer?.url ? '' : answer?.reason || '',
        };
        this.#error = '';
        this.render();
    }

    /**
     * The base of the stream URL: a URL, '' for the origin of the page, or null while nobody said where it is.
     *
     * A URL of the settings wins: only the user knows about a reverse proxy or an external domain. Where the URL is
     * the origin of the page, the relative form is taken: it cannot trip the mixed content rules of an https page.
     */
    #getStreamBase(): string | null {
        const base = this.settings.webUrl || this.#web.url;
        if (!base) {
            return null;
        }
        return base.replace(/\/+$/, '') === window.location.origin ? '' : base;
    }

    /**
     * Single pictures over the socket: always behind the cloud; elsewhere once the stream failed, or when the
     * adapter gave neither an address nor a reason. A guessed relative URL is no option: in admin it is a 404.
     */
    #useSocket(): boolean {
        return (
            this.#cloud ||
            this.#streamFailed ||
            (this.#web.resolved && !this.#web.reason && this.#getStreamBase() === null)
        );
    }

    /**
     * The URL of the MJPEG stream, or null while nobody said where it is
     *
     * @param full true for the enlarged view, which asks for a bigger picture
     */
    #getStreamUrl(full: boolean): string | null {
        const base = this.#getStreamBase();
        if (!this.camera || base === null) {
            return null;
        }
        return buildWebUrl(base, this.#web.route, this.camera, 'stream.mjpeg', {
            fps: getFps(this.settings),
            height: getPictureHeight(this.settings, full),
            bbox: this.settings.bbox ? 1 : undefined,
            timestamp: this.settings.timestamp ? 1 : undefined,
        });
    }

    /**
     * The stream did not load - most likely the browser cannot reach the web instance or blocks an http stream in
     * an https page - or gave no frame. The socket still works: take the pictures from there.
     *
     * @param url the stream
     * @param why what happened, for the console
     */
    #onStreamFail(url: string, why: string): void {
        if (this.#streamFailed || !this.isRunning) {
            return;
        }
        console.warn(`[frigate] The stream ${url}: ${why}. Taking the pictures over the socket.`);
        this.#streamFailed = true;
        this.#error = '';
        this.render();
    }

    protected getView(full: boolean): PictureView {
        if (this.#useSocket()) {
            if (this.#error) {
                return { kind: 'hint', text: this.#error, error: true };
            }
            return this.#frame ? { kind: 'frame', src: toDataUrl(this.#frame) } : { kind: 'loading' };
        }
        // while the enlarged view shows the stream, the tile behind it does not hold a second connection to the
        // web instance for the same camera - a browser grants about six per server
        if (!full && this.dialogOpen) {
            return { kind: 'none' };
        }
        const url = this.#getStreamUrl(full);
        if (url === null) {
            // the adapter named a cause: say it, instead of letting the browser run into a 404 first
            if (this.#web.reason) {
                return {
                    kind: 'hint',
                    text: this.word(REASON_WORDS[this.#web.reason] || 'frigate_stream_needs_web'),
                };
            }
            // the adapter has not answered yet
            return { kind: 'loading' };
        }
        return {
            kind: 'stream',
            src: url,
            id: `${url}#${this.#reload}`,
            onFail: (why: string) => this.#onStreamFail(url, why),
        };
    }
}

defineWebComponent(LIVE_TAG, FrigateLiveElement);
