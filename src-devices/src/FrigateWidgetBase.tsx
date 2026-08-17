/**
 * Shared base for both Frigate widgets in ioBroker.devices.
 *
 * The base owns what is identical for both: resolving the picked object id to instance + camera
 * name, the tile chrome for the three sizes, and the fullscreen dialog. The subclasses only decide
 * how the picture is obtained - one polls a still image over the socket, the other lets the browser
 * consume the MJPEG stream of the web extension.
 */
import WidgetGeneric, {
    React,
    MuiMaterial,
    MuiIcons,
    getTileStyles,
    isNeumorphicTheme,
    type WidgetGenericProps,
    type WidgetGenericState,
    type CustomWidgetPlugin,
} from '@iobroker/dm-widgets';
import type { BoxProps, TypographyProps, DialogProps, DialogContentProps, IconButtonProps } from '@mui/material';
import type { ConfigItemPanel, ConfigItemTabs } from '@iobroker/dm-utils';

import { resolveCamera, type CameraRef } from './frigateCommon';

const Box: React.ComponentType<BoxProps> = MuiMaterial?.Box;
const Typography: React.ComponentType<TypographyProps> = MuiMaterial?.Typography;
const Dialog: React.ComponentType<DialogProps> = MuiMaterial?.Dialog;
const DialogContent: React.ComponentType<DialogContentProps> = MuiMaterial?.DialogContent;
const IconButton: React.ComponentType<IconButtonProps> = MuiMaterial?.IconButton;
const CloseIcon: React.ComponentType<any> = MuiIcons?.Close;

export interface FrigateWidgetSettings extends CustomWidgetPlugin {
    /** Adapter instance that serves the camera, e.g. `frigate.0` */
    instance?: string;
    /** Camera name as configured in Frigate, e.g. `Vorgarten` */
    camera?: string;
    /**
     * Object below the `frigate` namespace, e.g. `frigate.0.Vorgarten`.
     *
     * @deprecated replaced by `instance` + `camera`; still read so existing widgets keep working
     */
    cameraObjectId?: string;
    /** Let Frigate draw the detection boxes into the picture */
    bbox?: boolean;
    /** Let Frigate draw the timestamp into the picture */
    timestamp?: boolean;
}

export interface FrigateWidgetState extends WidgetGenericState {
    dialogOpen: boolean;
    error: string;
}

/** Settings items both widgets share. Subclasses spread this into their own schema. */
export const commonConfigItems = {
    size: {
        type: 'select',
        label: 'wm_Size',
        options: [
            { value: '1x1', label: '1×1' },
            { value: '2x1', label: '2×1' },
            { value: '2x2', label: '2×2' },
        ],
        default: '1x1',
        format: 'radio',
        horizontal: true,
        noTranslation: true,
    },
    instance: {
        type: 'instance',
        adapter: 'frigate',
        label: 'frigate_instance',
        default: 'frigate.0',
        sm: 12,
    },
    camera: {
        // Asks the chosen instance for its cameras, see `frigate:getCameras` in src/main.ts.
        // The value is the plain camera name, which is what both endpoints of Frigate expect.
        type: 'selectSendTo',
        label: 'frigate_camera',
        help: 'frigate_camera_help',
        command: 'frigate:getCameras',
        instance: '${data.instance}',
        // Re-query when the instance changes, so the list matches the selected adapter
        alsoDependsOn: ['instance'],
        sm: 12,
    },
    // `name` is the display-name slot of WidgetSettingsBase, which renderTile() already prefers over
    // the camera name - it only had no field in the dialog so far
    name: {
        type: 'text',
        label: 'frigate_name',
        help: 'frigate_name_help',
        sm: 12,
    },
    bbox: {
        type: 'checkbox',
        label: 'frigate_bbox',
        default: false,
        sm: 12,
        md: 6,
    },
    timestamp: {
        type: 'checkbox',
        label: 'frigate_timestamp',
        default: false,
        sm: 12,
        md: 6,
    },
};

export abstract class FrigateWidgetBase<
    TSettings extends FrigateWidgetSettings = FrigateWidgetSettings,
    TState extends FrigateWidgetState = FrigateWidgetState,
> extends WidgetGeneric<TState, TSettings> {
    protected camera: CameraRef | null = null;

    /** Last seen dialog state, so `componentDidUpdate` can spot the switch */
    private dialogWasOpen = false;

    constructor(props: WidgetGenericProps<TSettings>) {
        super(props);
        this.state = {
            ...this.state,
            dialogOpen: false,
            error: '',
        };
        this.camera = resolveCamera(props.settings);
    }

    /** Start delivering pictures. Called once the camera reference is known. */
    protected abstract startCamera(): void;

    /** Stop delivering pictures and release every timer. */
    protected abstract stopCamera(): void;

    /** The `<img>` itself - this is where the two widgets actually differ. */
    protected abstract renderImage(full?: boolean): React.JSX.Element | null;

    componentDidMount(): void {
        if (this.camera) {
            this.startCamera();
        }
    }

    componentWillUnmount(): void {
        this.stopCamera();
    }

    componentDidUpdate(prevProps: WidgetGenericProps<TSettings>): void {
        if (
            prevProps.settings.instance !== this.props.settings.instance ||
            prevProps.settings.camera !== this.props.settings.camera ||
            prevProps.settings.cameraObjectId !== this.props.settings.cameraObjectId
        ) {
            this.stopCamera();
            this.camera = resolveCamera(this.props.settings);
            this.setState({ error: '' } as Partial<TState> as TState);
            if (this.camera) {
                this.startCamera();
            }
        }

        // Tracked here rather than read from a `prevState` argument, so the signature stays the one
        // the subclasses already override
        if (this.dialogWasOpen !== this.state.dialogOpen) {
            this.dialogWasOpen = this.state.dialogOpen;
            this.onDialogToggled();
        }
    }

    /**
     * Called after the fullscreen dialog opened or closed; read `this.state.dialogOpen` for the new
     * state. Widgets that deliver at a fixed rate use it to switch rate without waiting for the
     * currently running interval to elapse.
     */
    protected onDialogToggled(): void {
        // Nothing to do by default
    }

    protected setError(error: string): void {
        this.setState({ error } as Partial<TState> as TState);
    }

    /** Height the picture should have. Bigger tiles ask Frigate for a bigger picture. */
    protected getRequestedHeight(full?: boolean): number {
        if (full) {
            return 720;
        }
        return this.props.settings.size === '1x1' ? 240 : 480;
    }

    /** Parameters that Frigate understands on both endpoints */
    protected getDrawParams(): { bbox?: number; timestamp?: number } {
        return {
            bbox: this.props.settings.bbox ? 1 : undefined,
            timestamp: this.props.settings.timestamp ? 1 : undefined,
        };
    }

    /** Style of the picture inside the tile, which has a fixed aspect ratio to fill */
    protected static imageStyle: React.CSSProperties = {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        display: 'block',
    };

    /**
     * Style of the enlarged picture.
     *
     * The dialog has no fixed height, so `height: 100%` would resolve against `auto` and let a tall
     * frame grow past the viewport - which is what made the dialog scroll. `height: auto` keeps the
     * aspect ratio, and the viewport-relative cap keeps the whole frame on screen. 80px is what the
     * dialog costs around the picture: 2x32px paper margin plus 2x8px content padding.
     */
    protected static fullImageStyle: React.CSSProperties = {
        width: '100%',
        height: 'auto',
        maxHeight: 'calc(100vh - 80px)',
        objectFit: 'contain',
        display: 'block',
        margin: '0 auto',
    };

    /**
     * Picture style for the view being rendered.
     *
     * @param full true while the fullscreen dialog is open
     */
    protected static styleFor(full?: boolean): React.CSSProperties {
        return full ? FrigateWidgetBase.fullImageStyle : FrigateWidgetBase.imageStyle;
    }

    protected renderPicture(full?: boolean): React.JSX.Element {
        if (!this.camera) {
            return (
                <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', p: 1 }}
                >
                    {FrigateWidgetBase.t('frigate_no_camera')}
                </Typography>
            );
        }

        if (this.state.error) {
            return (
                <Typography
                    variant="caption"
                    sx={{ color: 'error.main', p: 1, overflow: 'hidden' }}
                >
                    {this.state.error}
                </Typography>
            );
        }

        const image = this.renderImage(full);
        if (!image) {
            return (
                <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', p: 1 }}
                >
                    {FrigateWidgetBase.t('frigate_loading')}
                </Typography>
            );
        }

        return image;
    }

    /** Minimal translation helper - the host installs the bundle's translations globally */
    static t(word: string): string {
        const i18n = (window as any).systemDictionary || (window as any).translations;
        const lang: string = (window as any).sysLang || 'en';
        return i18n?.[word]?.[lang] || word;
    }

    protected renderDialog(): React.JSX.Element | null {
        if (!this.state.dialogOpen) {
            return null;
        }

        return (
            <Dialog
                open={!0}
                fullWidth
                maxWidth="lg"
                onClose={() => this.setState({ dialogOpen: false } as Partial<TState> as TState)}
            >
                {/* `overflow: hidden` instead of the default `auto`: the picture is capped to the
                    viewport, so there is nothing to scroll to and a scrollbar would only shrink it */}
                <DialogContent
                    sx={{
                        position: 'relative',
                        p: 1,
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <IconButton
                        onClick={() => this.setState({ dialogOpen: false } as Partial<TState> as TState)}
                        sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
                        size="small"
                    >
                        <CloseIcon />
                    </IconButton>
                    {this.renderPicture(true)}
                </DialogContent>
            </Dialog>
        );
    }

    /** Tile body shared by all three sizes */
    private renderTile(aspectRatio: string, styleFn: (theme: any) => React.CSSProperties): React.JSX.Element {
        const isActive = this.isTileActive();
        const accent = this.getAccentColor();
        const settingsButton = this.renderSettingsButton();
        const indicators = this.renderIndicators(settingsButton);
        const label = this.props.settings.name || this.camera?.name || '';

        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={(theme: any) => styleFn(theme)}
            >
                <Box
                    onClick={() => this.setState({ dialogOpen: true } as Partial<TState> as TState)}
                    sx={(theme: any) => ({
                        display: 'flex',
                        flexDirection: 'column',
                        width: '100%',
                        aspectRatio,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        ...(getTileStyles(theme, isActive, accent) as any),
                        padding: isNeumorphicTheme(theme) ? '4px' : '6px',
                    })}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'contents' }}
                    >
                        {indicators}
                    </div>
                    {label ? (
                        <Typography
                            variant="caption"
                            sx={{
                                fontWeight: 700,
                                color: 'text.secondary',
                                px: 0.5,
                                pb: 0.25,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {label}
                        </Typography>
                    ) : null}
                    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{this.renderPicture()}</Box>
                </Box>
                {this.renderDialog()}
            </Box>
        );
    }

    override renderCompact(): React.JSX.Element {
        return this.renderTile('1', theme => WidgetGeneric.getStyleCompact(theme));
    }

    override renderWide(): React.JSX.Element {
        return this.renderTile('2', theme => WidgetGeneric.getStyleWide(theme));
    }

    override renderWideTall(): React.JSX.Element {
        return this.renderTile('1', theme => WidgetGeneric.getStyleWideTall(theme));
    }

    /**
     * Both widgets share the base fields; subclasses add their own on top
     *
     * @param name translation key of the widget name
     * @param extraItems additional settings items of the subclass
     */
    static buildConfigSchema(
        name: string,
        extraItems: Record<string, unknown>,
    ): { name: string; schema: ConfigItemPanel | ConfigItemTabs } {
        return {
            name,
            schema: {
                type: 'panel',
                items: {
                    ...commonConfigItems,
                    ...extraItems,
                },
            } as ConfigItemPanel,
        };
    }
}

export default FrigateWidgetBase;
