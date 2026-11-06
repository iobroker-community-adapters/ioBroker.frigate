/**
 * A still picture of a Frigate camera as a web component: `<iob-frigate-snapshot>` - the web component of the
 * devices widget "Frigate Snapshot" (`src-devices/src/SnapshotComponent.tsx`).
 *
 * One module for every host - vis-2, devices, Aura, admin (`@iobroker/web-components`). Its manifest is a file of
 * its own (`frigate-snapshot.json`, written by the build from `manifest.ts`), so a host loads this module only when
 * it shows the element. The host sets `socket` and `settings`, and if it has them `theme`, `editMode` and `dialogs`.
 *
 * The pictures come over the socket: the message `snapshot` to the instance of the camera, which reads
 * `/api/<camera>/latest.jpg` of Frigate with the login of the adapter and answers with the picture as base64 - the
 * same as the devices widget (`SnapshotPoller`). That works in every host, behind the ioBroker cloud as well, and
 * needs no web instance. A click shows the picture bigger and more often in a dialog of the host.
 *
 * React is not in the module: it comes from `lib/esm/react-19.js` beside `adapter/`, see `vite.config.ts`.
 */
import { defineWebComponent } from '@iobroker/web-components/element';

import { toDataUrl } from '../../src-devices/src/frigateCommon';
import SnapshotPoller from '../../src-devices/src/SnapshotPoller';
import { FrigateCameraElement, type PictureView } from './CameraElement';
import { getPictureHeight, getPollInterval, SNAPSHOT_TAG, type SnapshotSettings } from './constants';

class FrigateSnapshotElement extends FrigateCameraElement<SnapshotSettings> {
    /** Base64 JPEG of the newest picture */
    #frame = '';

    /** Why the last picture did not come; empty after a picture */
    #error = '';

    /** The interval the poller runs with, to apply a new one at once */
    #interval = 0;

    readonly #poller = new SnapshotPoller({
        // the poller runs with a socket only, see `FrigateCameraElement`
        getSocket: () => this.socket!,
        getCamera: () => (this.socket ? this.camera : null),
        getParams: () => ({
            height: getPictureHeight(this.settings, this.dialogOpen),
            bbox: !!this.settings.bbox,
            timestamp: !!this.settings.timestamp,
        }),
        getInterval: () => getPollInterval(this.settings, this.dialogOpen),
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

    protected startCamera(): void {
        this.#frame = '';
        this.#error = '';
        this.#interval = getPollInterval(this.settings, this.dialogOpen);
        this.#poller.start();
    }

    protected stopCamera(): void {
        this.#poller.stop();
    }

    /** A new interval in the settings applies at once, not after the running one */
    protected override syncDelivery(): void {
        const interval = getPollInterval(this.settings, this.dialogOpen);
        if (this.isRunning && interval !== this.#interval) {
            this.#interval = interval;
            this.#poller.reschedule();
        }
    }

    /** The enlarged view asks for a bigger picture more often: fetch it now, not after the running interval */
    protected override onDialogToggled(): void {
        this.#interval = getPollInterval(this.settings, this.dialogOpen);
        this.#poller.reschedule();
    }

    protected getView(): PictureView {
        if (this.#error) {
            return { kind: 'hint', text: this.#error, error: true };
        }
        if (this.#frame) {
            return { kind: 'frame', src: toDataUrl(this.#frame) };
        }
        return { kind: 'loading' };
    }
}

defineWebComponent(SNAPSHOT_TAG, FrigateSnapshotElement);
