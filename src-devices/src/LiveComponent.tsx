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
    /** Base URL the adapter worked out for its camera proxy, empty until the answer arrives */
    resolvedWebUrl: string;
    /** Route prefix the extension registered, empty until the answer arrives */
    resolvedRoute: string;
    /** Why no URL could be worked out; empty when there is one or the adapter said nothing */
    webReason: string;
}

/**
 * Reason codes of `frigate:getWebUrl` mapped to what the tile shows. Anything the adapter reports
 * that is not listed here falls back to the generic hint.
 */
const REASON_TEXT: Record<string, string> = {
    disabled: 'frigate_web_disabled',
    noInstance: 'frigate_web_noInstance',
    noAddress: 'frigate_web_noAddress',
    error: 'frigate_web_error',
};

export default class LiveComponent extends FrigateWidgetBase<LiveSettings, LiveState> {
    constructor(props: WidgetGenericProps<LiveSettings>) {
        super(props);
        this.state = { ...this.state, reloadCounter: 0, resolvedWebUrl: '', resolvedRoute: '', webReason: '' };
    }

    componentDidMount(): void {
        super.componentDidMount();
        void this.resolveWebUrl();
    }

    componentDidUpdate(prevProps: WidgetGenericProps<LiveSettings>): void {
        super.componentDidUpdate(prevProps);
        // The proxy belongs to the frigate instance, so a different instance can mean a different
        // web instance and a different route
        if (prevProps.settings.instance !== this.props.settings.instance) {
            void this.resolveWebUrl();
        }
    }

    /**
     * Ask the adapter where its camera proxy is reachable, instead of making the user type it.
     *
     * The adapter follows its own `webInstance` setting to the web instance, that instance to its
     * host, and the host to an address in this browser's subnet - all of which it can see and the
     * widget cannot.
     */
    private async resolveWebUrl(): Promise<void> {
        const instance = this.props.settings.instance || 'frigate.0';
        try {
            const result: { url?: string; route?: string; reason?: string } = await this.props.stateContext
                .getSocket()
                .sendTo(instance, 'frigate:getWebUrl', { hostname: window.location.hostname });

            this.setState({
                resolvedWebUrl: result?.url || '',
                resolvedRoute: result?.route || '',
                // Only a code the adapter really sent counts. An adapter too old to know this
                // command answers nothing, and then the relative URL still deserves its chance.
                webReason: result?.url ? '' : result?.reason || '',
            });
        } catch {
            // Same here: say nothing rather than blame the web adapter for a failed round trip
        }
    }

    /**
     * Base the stream URL is built on.
     *
     * A value typed into the settings wins, because only the user knows about an external domain or
     * a reverse proxy. Where the computed URL is the page's own origin the relative form is used
     * instead: it survives such a proxy and cannot trip the mixed-content rules of an https page.
     */
    private getWebBase(): string {
        const base = this.props.settings.webUrl || this.state.resolvedWebUrl || '';
        if (base && typeof window !== 'undefined' && base.replace(/\/+$/, '') === window.location.origin) {
            return '';
        }
        return base;
    }

    static override getConfigSchema(): { name: string; schema: ConfigItemPanel | ConfigItemTabs } {
        return FrigateWidgetBase.buildConfigSchema('frigate_LiveCamera', {
            _webHint: {
                type: 'staticText',
                text: 'frigate_live_needs_web',
                sm: 12,
            },
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

    // eslint-disable-next-line class-methods-use-this
    protected stopCamera(): void {
        // intentionally empty
    }

    protected renderImage(full?: boolean): React.JSX.Element | null {
        if (!this.camera) {
            return null;
        }

        const fps = Math.min(30, Math.max(1, parseInt(this.props.settings.fps as unknown as string, 10) || 5));
        const url = buildWebUrl(this.getWebBase(), this.state.resolvedRoute, this.camera, 'stream.mjpeg', {
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
                style={FrigateWidgetBase.styleFor(full)}
                onError={() => this.setError(FrigateWidgetBase.t('frigate_stream_failed'))}
            />
        );
    }

    /**
     * Show the hint about the web instance instead of a bare error, but only when neither the
     * settings nor the adapter produced a base URL - otherwise the real error is the useful one.
     */
    protected override renderPicture(full?: boolean): React.JSX.Element {
        const hasBase = !!(this.props.settings.webUrl || this.state.resolvedWebUrl);

        if (this.camera && !hasBase) {
            // The adapter named a cause, so say it straight away instead of letting the browser run
            // into a 404 first and then blaming the settings for it
            if (this.state.webReason) {
                return (
                    <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', p: 1, overflow: 'hidden' }}
                    >
                        {FrigateWidgetBase.t(REASON_TEXT[this.state.webReason] || 'frigate_stream_needs_web')}
                    </Typography>
                );
            }
            if (this.state.error) {
                return (
                    <Typography
                        variant="caption"
                        sx={{ color: 'error.main', p: 1, overflow: 'hidden' }}
                    >
                        {FrigateWidgetBase.t('frigate_stream_needs_web')}
                    </Typography>
                );
            }
        }

        return super.renderPicture(full);
    }
}
