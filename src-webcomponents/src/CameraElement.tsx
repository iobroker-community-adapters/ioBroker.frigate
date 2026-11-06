/**
 * What `<iob-frigate-snapshot>` and `<iob-frigate-live>` share: the camera of the settings, the tile with the
 * picture and its name, and the enlarged view in a dialog of the host. The two only differ in how the pictures
 * come: `Snapshot.tsx` asks the adapter for still pictures over the socket, `Live.tsx` shows the MJPEG stream of
 * the web extension. The same split as in the devices widgets (`src-devices/src/FrigateWidgetBase.tsx`).
 *
 * The camera comes from one setting, an object ID below `frigate`: `frigate.<n>.<camera>` or a state below it -
 * the instance and the name of the camera are taken from it (`parseCameraId` of the devices widgets).
 */
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DIALOG_CLOSE_EVENT, type WebComponentSocket } from '@iobroker/web-components';
import { getThemeCssVariables, IobWebComponent } from '@iobroker/web-components/element';

import { parseCameraId, type CameraRef } from '../../src-devices/src/frigateCommon';
import { STREAM_TIMEOUT, type CameraSettings } from './constants';
import { getWord, type Word } from './i18n';
import { DIALOG_STYLES, STYLES } from './styles';

/** A camera: the picture of the hints */
const CAMERA_PATH =
    'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';

/** The event a click on the picture sends first; a host that answers it shows the camera itself */
export const CAMERA_CLICK_EVENT = 'frigate-camera-click';

/** What the place of the picture shows */
export type PictureView =
    /** A text instead of the picture: a setting is missing, an error, why there is no stream */
    | { kind: 'hint'; text: string; error?: boolean }
    /** No picture yet */
    | { kind: 'loading' }
    /** A still picture as a data URL */
    | { kind: 'frame'; src: string }
    /**
     * The MJPEG stream of the web extension. `id` changes whenever the stream is to be opened again;
     * `onFail` is called when it does not load or gives no first frame within `STREAM_TIMEOUT`
     */
    | { kind: 'stream'; src: string; id: string; onFail: (why: string) => void }
    /** Nothing: the tile while the enlarged view shows the stream */
    | { kind: 'none' };

function CameraIcon(): JSX.Element {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <path d={CAMERA_PATH} />
        </svg>
    );
}

function Spinner(): JSX.Element {
    return (
        <div className="overlay">
            <div className="spinner" />
        </div>
    );
}

interface StreamImageProps {
    src: string;
    alt: string;
    onFail: (why: string) => void;
}

/**
 * The MJPEG stream in an `<img>`: browsers decode `multipart/x-mixed-replace` themselves. A spinner lies over it
 * until the first frame is there.
 *
 * It gives up when the stream does not load, and also when no frame comes within `STREAM_TIMEOUT`: a browser holds
 * about six connections per server, and every stream on the screen keeps one of them - a request that waits for a
 * free one never fails, it just never starts.
 */
function StreamImage({ src, alt, onFail }: StreamImageProps): JSX.Element {
    const ref = useRef<HTMLImageElement>(null);
    const failRef = useRef(onFail);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        failRef.current = onFail;
    }, [onFail]);

    useEffect(() => {
        if (loaded) {
            return undefined;
        }
        const timer = setTimeout(() => failRef.current(`no frame within ${STREAM_TIMEOUT} ms`), STREAM_TIMEOUT);
        return () => clearTimeout(timer);
    }, [loaded]);

    // Taking the `<img>` out of the document does not reliably end an endless response, and Frigate encodes one
    // stream per viewer. `removeAttribute` rather than `src = ''`, which the browser would load as the page itself
    useEffect(() => {
        const img = ref.current;
        return () => img?.removeAttribute('src');
    }, []);

    return (
        <div className={`stream${loaded ? '' : ' loading'}`}>
            <img
                ref={ref}
                src={src}
                alt={alt}
                // a browser reports every frame of the stream; only the first is news
                onLoad={() => setLoaded(true)}
                onError={() => onFail('cannot load it')}
            />
            {loaded ? null : <Spinner />}
        </div>
    );
}

/**
 * The place of the picture
 *
 * @param props what to show
 * @param props.view the picture, a hint, or nothing
 * @param props.alt the name of the camera
 */
export function Picture({ view, alt }: { view: PictureView; alt: string }): JSX.Element {
    let content: JSX.Element | null = null;
    switch (view.kind) {
        case 'hint':
            content = (
                <div className={`hint${view.error ? ' error' : ''}`}>
                    <CameraIcon />
                    <span>{view.text}</span>
                </div>
            );
            break;
        case 'loading':
            content = <Spinner />;
            break;
        case 'frame':
            content = (
                <img
                    src={view.src}
                    alt={alt}
                />
            );
            break;
        case 'stream':
            content = (
                <StreamImage
                    // a new `id` is a new element: the browser opens the stream again
                    key={view.id}
                    src={view.src}
                    alt={alt}
                    onFail={view.onFail}
                />
            );
            break;
        default:
            break;
    }
    const empty = view.kind !== 'frame' && view.kind !== 'stream';
    return <div className={`picture${empty ? ' empty' : ''}`}>{content}</div>;
}

interface TileProps {
    view: PictureView;
    /** The name below the picture; empty: none */
    label: string;
    /** The name of the camera, for the picture */
    alt: string;
    editMode: boolean;
    /** null: nothing to enlarge */
    onOpen: (() => void) | null;
    word: Word;
}

/** The tile: the picture and the name of the camera below it, like the devices widgets */
function Tile({ view, label, alt, editMode, onOpen, word }: TileProps): JSX.Element {
    const clickable = !editMode && !!onOpen;
    const classes = ['tile'];
    if (clickable) {
        classes.push('clickable');
    }
    if (editMode) {
        classes.push('edit');
    }
    return (
        <div
            className={classes.join(' ')}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            title={clickable ? word('enlarge') : undefined}
            onClick={clickable ? onOpen : undefined}
            onKeyDown={
                clickable
                    ? (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpen();
                          }
                      }
                    : undefined
            }
        >
            <Picture
                view={view}
                alt={alt}
            />
            {label ? <div className="label">{label}</div> : null}
        </div>
    );
}

/** The device of a camera: `frigate.0.<camera>` */
function getDeviceId(camera: CameraRef): string {
    return `${camera.instance}.${camera.name}`;
}

/**
 * The base of both elements. A subclass says how the pictures come: `startCamera()` / `stopCamera()` and what the
 * place of the picture shows (`getView()`).
 */
export abstract class FrigateCameraElement<TSettings extends CameraSettings> extends IobWebComponent<TSettings> {
    readonly #root: Root;

    /** The camera of the settings; null without one */
    protected camera: CameraRef | null = null;

    /** For which camera and socket the pictures are delivered now; null while nothing runs */
    #running: { key: string; socket: WebComponentSocket } | null = null;

    /** The open enlarged view; null while none is open */
    #dialog: { element: HTMLElement; root: Root } | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLES;
        const mount = document.createElement('div');
        mount.className = 'mount';
        shadow.append(style, mount);
        this.#root = createRoot(mount);
    }

    /** Whether the pictures are delivered now: with a camera and a socket, while the element is in the document */
    protected get isRunning(): boolean {
        return !!this.#running;
    }

    /** Whether the enlarged view is open */
    protected get dialogOpen(): boolean {
        return !!this.#dialog;
    }

    /** The language of the system, also for the subclasses */
    protected word: Word = key => getWord(this.systemLang, key);

    /** Start delivering pictures for `this.camera`; `this.socket` is there */
    protected abstract startCamera(): void;

    /** Stop delivering pictures and release every timer */
    protected abstract stopCamera(): void;

    /**
     * What the place of the picture shows
     *
     * @param full true for the enlarged view
     */
    protected abstract getView(full: boolean): PictureView;

    /** Called after every change: a subclass follows what it shows, e.g. starts or stops taking pictures */
    protected syncDelivery(): void {
        // nothing by default
    }

    /** Called after the enlarged view opened or closed, see `dialogOpen` */
    protected onDialogToggled(): void {
        // nothing by default
    }

    /**
     * What else delivers the pictures anew when it changes, besides the camera and the socket
     *
     * @param _settings the settings
     */
    protected getRestartKey(_settings: TSettings): string {
        return '';
    }

    /** The device of the camera: a zone is a device at the same level, and must not count as a camera */
    protected override getObjectIds(settings: TSettings): string[] {
        const camera = parseCameraId(settings.camera);
        return camera ? [getDeviceId(camera)] : [];
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#stop();
        // no stream runs on for an element that is gone: the `<img>` of a stream ends it when it is removed
        this.#root.render(null);
        // the dialog of the host would show a picture that is no longer delivered
        this.#dialog?.element.dispatchEvent(
            new CustomEvent(DIALOG_CLOSE_EVENT, { detail: null, bubbles: true, composed: true }),
        );
    }

    /** The camera of the settings, or a hint why there is none */
    #getCamera(): CameraRef | string {
        const settings = this.settings;
        if (!settings.camera) {
            return this.word('frigate_no_camera');
        }
        const camera = parseCameraId(settings.camera);
        const obj = camera ? this.objects[getDeviceId(camera)] : null;
        const name = obj?.common?.name;
        // the zones are devices right below the instance as well: "Zone <name>", the cameras "Camera <name>"
        if (!camera || (typeof name === 'string' && name.startsWith('Zone '))) {
            return this.word('notCamera');
        }
        return camera;
    }

    /** Deliver the pictures of this camera with this socket - start, stop or start anew */
    #sync(camera: CameraRef | null): void {
        const socket = this.socket;
        const key = camera ? `${getDeviceId(camera)}\n${this.getRestartKey(this.settings)}` : '';
        if (this.#running && (this.#running.key !== key || this.#running.socket !== socket)) {
            this.#stop();
        }
        this.camera = camera;
        if (!this.#running && camera && socket && this.isConnected) {
            this.#running = { key, socket };
            this.startCamera();
        }
        this.syncDelivery();
    }

    #stop(): void {
        if (this.#running) {
            this.#running = null;
            this.stopCamera();
        }
        this.syncDelivery();
    }

    /** The name below the picture and the title of the enlarged view */
    #getLabel(): string {
        return this.settings.name || this.camera?.name || '';
    }

    #onOpen = (): void => {
        const camera = this.camera;
        if (this.editMode || this.#dialog || !camera) {
            return;
        }
        // the host may show the camera itself
        if (this.emit(CAMERA_CLICK_EVENT, { instance: camera.instance, camera: camera.name })) {
            void this.#openDialog();
        }
    };

    /** The enlarged view in an element dialog of the host, drawn again with every change */
    async #openDialog(): Promise<void> {
        const element = document.createElement('div');
        const shadow = element.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = DIALOG_STYLES;
        const mount = document.createElement('div');
        mount.className = 'full';
        shadow.append(style, mount);
        const root = createRoot(mount);
        this.#dialog = { element, root };
        this.onDialogToggled();
        this.render();
        try {
            await this.openDialog({ title: this.#getLabel(), element, width: 1200 });
        } finally {
            this.#dialog = null;
            root.unmount();
            this.onDialogToggled();
            if (this.isConnected) {
                this.render();
            }
        }
    }

    #drawDialog(): void {
        const dialog = this.#dialog;
        if (!dialog) {
            return;
        }
        // the host moves the content into its dialog, out of this element: it takes the theme along
        for (const [name, value] of Object.entries(getThemeCssVariables(this.theme))) {
            dialog.element.style.setProperty(name, value);
        }
        dialog.root.render(
            <Picture
                view={this.getView(true)}
                alt={this.camera?.name || ''}
            />,
        );
    }

    protected override render(): void {
        const camera = this.#getCamera();
        this.#sync(typeof camera === 'string' ? null : camera);

        const view: PictureView = typeof camera === 'string' ? { kind: 'hint', text: camera } : this.getView(false);
        this.#root.render(
            <Tile
                view={view}
                label={this.settings.showName === false ? '' : this.#getLabel()}
                alt={this.camera?.name || ''}
                editMode={this.editMode}
                onOpen={this.camera ? this.#onOpen : null}
                word={this.word}
            />,
        );
        this.#drawDialog();
    }
}
