/**
 * Live widget for ioBroker.devices.
 *
 * Points an `<img>` at the MJPEG route of the web extension. Browsers decode `multipart/x-mixed-replace`
 * natively, so no canvas and no frame handling is needed here - the picture simply moves.
 *
 * The catch: that route belongs to the *web* adapter (port 8082), while the Devices UI is usually
 * served from admin (port 8081). Only when this widget runs inside a web instance does a relative URL
 * work; everywhere else the web instance has to be named in the settings. That is why the snapshot
 * widget, which goes over the socket, is the one that works everywhere.
 */
import { React, MuiMaterial, type WidgetGenericProps } from '@iobroker/dm-widgets';
import type { TypographyProps } from '@mui/material';
import type { ConfigItemPanel, ConfigItemTabs } from '@iobroker/dm-utils';

import FrigateWidgetBase, { type FrigateWidgetSettings, type FrigateWidgetState } from './FrigateWidgetBase';
import { buildWebUrl } from './frigateCommon';

const Typography: React.ComponentType<TypographyProps> = MuiMaterial?.Typography;

export interface LiveSettings extends FrigateWidgetSettings {
    /** Base URL of the web instance, e.g. `http://192.168.1.5:8082`. Empty = same origin. */
    webUrl?: string;
    /** Frames per second requested from Frigate */
    fps?: number;
}

export interface LiveState extends FrigateWidgetState {
    /** Bumped to force the browser to re-open the stream */
    reloadCounter: number;
}

export class LiveComponent extends FrigateWidgetBase<LiveSettings, LiveState> {
    constructor(props: WidgetGenericProps<LiveSettings>) {
        super(props);
        this.state = { ...this.state, reloadCounter: 0 };
    }

    static override getConfigSchema(): { name: string; schema: ConfigItemPanel | ConfigItemTabs } {
        return FrigateWidgetBase.buildConfigSchema('frigate_LiveCamera', {
            webUrl: {
                type: 'text',
                label: 'frigate_webUrl',
                help: 'frigate_webUrl_help',
                sm: 12,
            },
            fps: {
                type: 'number',
                label: 'frigate_fps',
                help: 'frigate_fps_help',
                default: 5,
                min: 1,
                max: 30,
                sm: 12,
                md: 6,
            },
        });
    }

    /**
     * Nothing to start or stop: the browser opens the stream when the `<img>` is mounted and closes
     * it when React removes the element again.
     */
    protected startCamera(): void {
        this.setState({ reloadCounter: this.state.reloadCounter + 1 });
    }

    protected stopCamera(): void {
        // intentionally empty
    }

    protected renderImage(full?: boolean): React.JSX.Element | null {
        if (!this.camera) {
            return null;
        }

        const fps = Math.min(30, Math.max(1, parseInt(this.props.settings.fps as unknown as string, 10) || 5));
        const url = buildWebUrl(this.props.settings.webUrl, this.camera, 'stream.mjpeg', {
            fps,
            height: this.getRequestedHeight(full),
            ...this.getDrawParams(),
        });

        return (
            <img
                // The counter is part of the key, so a re-mount really re-opens the stream
                key={`${url}#${this.state.reloadCounter}`}
                src={url}
                alt={this.camera.name}
                style={FrigateWidgetBase.imageStyle}
                onError={() => this.setError(FrigateWidgetBase.t('frigate_stream_failed'))}
            />
        );
    }

    /** Show the hint about the web instance instead of a bare error when the URL cannot work */
    protected override renderPicture(full?: boolean): React.JSX.Element {
        if (this.camera && this.state.error && !this.props.settings.webUrl) {
            return (
                <Typography
                    variant="caption"
                    sx={{ color: 'error.main', p: 1, overflow: 'hidden' }}
                >
                    {FrigateWidgetBase.t('frigate_stream_needs_web')}
                </Typography>
            );
        }
        return super.renderPicture(full);
    }
}

export default LiveComponent;
