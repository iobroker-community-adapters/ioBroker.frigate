/**
 * Snapshot widget for ioBroker.devices.
 *
 * Pulls single pictures through the adapter's `snapshot` message. That works from admin as well as
 * from a web instance, because it goes over the ioBroker socket instead of an HTTP route of the web
 * adapter - the Devices UI is served from admin in most installations. It also inherits the Frigate
 * login of the adapter, so it works with the authenticated port 8971 without any extra setup.
 */
import { React, type WidgetGenericProps } from '@iobroker/dm-widgets';
import type { ConfigItemPanel, ConfigItemTabs } from '@iobroker/dm-utils';

import FrigateWidgetBase, { type FrigateWidgetSettings, type FrigateWidgetState } from './FrigateWidgetBase';
import { toDataUrl } from './frigateCommon';
import SnapshotPoller from './SnapshotPoller';

export interface SnapshotSettings extends FrigateWidgetSettings {
    /** Poll interval of the tile in milliseconds */
    pollingInterval?: number;
    /**
     * Poll interval while the fullscreen dialog is open, in milliseconds. The dialog is what someone
     * is actually looking at, so it may run faster than the tile without costing anything the rest
     * of the time.
     */
    dialogPollingInterval?: number;
}

export interface SnapshotState extends FrigateWidgetState {
    /** Base64 JPEG of the newest frame */
    frame: string;
}

export class SnapshotComponent extends FrigateWidgetBase<SnapshotSettings, SnapshotState> {
    private readonly poller: SnapshotPoller;

    constructor(props: WidgetGenericProps<SnapshotSettings>) {
        super(props);
        this.state = { ...this.state, frame: '' };
        this.poller = new SnapshotPoller({
            getSocket: () => this.props.stateContext.getSocket(),
            getCamera: () => this.camera,
            getParams: () => ({
                height: this.getRequestedHeight(this.state.dialogOpen),
                bbox: !!this.props.settings.bbox,
                timestamp: !!this.props.settings.timestamp,
            }),
            getInterval: () => this.getPollInterval(),
            onFrame: frame => this.setState({ frame, error: '' }),
            onError: error => this.setError(error),
        });
    }

    static override getConfigSchema(): { name: string; schema: ConfigItemPanel | ConfigItemTabs } {
        return FrigateWidgetBase.buildConfigSchema('frigate_SnapshotCamera', {
            pollingInterval: {
                type: 'number',
                label: 'frigate_pollingInterval',
                help: 'frigate_pollingInterval_help',
                default: 2000,
                min: 500,
                max: 600000,
                sm: 12,
                md: 6,
            },
            dialogPollingInterval: {
                type: 'number',
                label: 'frigate_dialogPollingInterval',
                help: 'frigate_dialogPollingInterval_help',
                default: 500,
                min: 200,
                max: 600000,
                sm: 12,
                md: 6,
            },
        });
    }

    protected startCamera(): void {
        this.poller.start();
    }

    protected stopCamera(): void {
        this.poller.stop();
    }

    /**
     * Rate of the view that is currently on screen. The bounds match the ones the settings dialog
     * enforces, so a value edited around them cannot push the polling faster than intended.
     */
    private getPollInterval(): number {
        if (this.state.dialogOpen) {
            return Math.max(200, parseInt(this.props.settings.dialogPollingInterval as unknown as string, 10) || 500);
        }
        return Math.max(500, parseInt(this.props.settings.pollingInterval as unknown as string, 10) || 2000);
    }

    /** Opening or closing the dialog switches the rate, without waiting for the running interval */
    protected override onDialogToggled(): void {
        this.poller.reschedule();
    }

    protected renderImage(full?: boolean): React.JSX.Element | null {
        if (!this.state.frame) {
            return null;
        }

        return (
            <img
                src={toDataUrl(this.state.frame)}
                alt={this.camera?.name}
                style={FrigateWidgetBase.styleFor(full)}
            />
        );
    }
}

export default SnapshotComponent;
