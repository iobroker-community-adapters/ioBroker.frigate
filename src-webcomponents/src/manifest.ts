/**
 * The manifests of `<iob-frigate-snapshot>` and `<iob-frigate-live>`. Read by the build only (`vite.config.ts`),
 * which writes each as `<name>.json` next to its module - a host reads that file for its palette and its settings
 * without loading the module.
 *
 * Most words come from the devices widgets: the name and the description from `common.deviceWidgets` in
 * `io-package.json`, the labels from `src-devices/src/i18n/`. The build reads them; only the words the devices
 * widgets do not have live here.
 */
import type {
    WebComponentManifest,
    WebComponentSetting,
    WebComponentSettingsPanel,
    WebComponentText,
} from '@iobroker/web-components';

// with the extension: `vite.config.ts` imports this file, and Vite may load its config natively
import {
    DEFAULT_HEIGHT,
    FULL_HEIGHT,
    getModuleFile,
    HEIGHTS,
    LIVE_TAG,
    SNAPSHOT_TAG,
    type ComponentName,
} from './constants.ts';

/** The words of the devices widgets, read by the build */
export interface ManifestTexts {
    /**
     * `label` of the devices widget in `io-package.json`. The same name, per language, makes devices offer its own
     * widget instead of this component
     */
    name: WebComponentText;
    /** `description` of the devices widget in `io-package.json` */
    description: WebComponentText;
    /** A word of the devices widgets (`src-devices/src/i18n/`) in every language */
    devices: (key: string) => WebComponentText;
}

const CAMERA_HELP: WebComponentText = {
    en: 'The device of the camera: frigate.0.<camera>',
    de: 'Das Gerät der Kamera: frigate.0.<Kamera>',
    ru: 'Устройство камеры: frigate.0.<камера>',
    pt: 'O dispositivo da câmera: frigate.0.<câmera>',
    nl: 'Het apparaat van de camera: frigate.0.<camera>',
    fr: "L'appareil de la caméra : frigate.0.<caméra>",
    it: 'Il dispositivo della telecamera: frigate.0.<telecamera>',
    es: 'El dispositivo de la cámara: frigate.0.<cámara>',
    pl: 'Urządzenie kamery: frigate.0.<kamera>',
    uk: 'Пристрій камери: frigate.0.<камера>',
    'zh-cn': '摄像机的设备：frigate.0.<摄像机>',
};

const SHOW_NAME: WebComponentText = {
    en: 'Show name',
    de: 'Namen anzeigen',
    ru: 'Показывать название',
    pt: 'Mostrar nome',
    nl: 'Naam tonen',
    fr: 'Afficher le nom',
    it: 'Mostra nome',
    es: 'Mostrar nombre',
    pl: 'Pokaż nazwę',
    uk: 'Показувати назву',
    'zh-cn': '显示名称',
};

const HEIGHT: WebComponentText = {
    en: 'Picture height (px)',
    de: 'Bildhöhe (px)',
    ru: 'Высота изображения (px)',
    pt: 'Altura da imagem (px)',
    nl: 'Beeldhoogte (px)',
    fr: "Hauteur de l'image (px)",
    it: "Altezza dell'immagine (px)",
    es: 'Altura de la imagen (px)',
    pl: 'Wysokość obrazu (px)',
    uk: 'Висота зображення (px)',
    'zh-cn': '图像高度（像素）',
};

const HEIGHT_HELP: WebComponentText = {
    en: `Frigate scales the picture of the tile down to this height. A smaller picture loads faster; the enlarged view always asks for ${FULL_HEIGHT} px.`,
    de: `Frigate verkleinert das Bild der Kachel auf diese Höhe. Ein kleineres Bild lädt schneller; die vergrößerte Ansicht fragt immer ${FULL_HEIGHT} px an.`,
    ru: `Frigate уменьшает изображение плитки до этой высоты. Меньшее изображение загружается быстрее; увеличенный вид всегда запрашивает ${FULL_HEIGHT} px.`,
    pt: `O Frigate reduz a imagem do bloco para esta altura. Uma imagem menor carrega mais rápido; a vista ampliada pede sempre ${FULL_HEIGHT} px.`,
    nl: `Frigate verkleint het beeld van de tegel tot deze hoogte. Een kleiner beeld laadt sneller; de vergrote weergave vraagt altijd ${FULL_HEIGHT} px.`,
    fr: `Frigate réduit l'image de la tuile à cette hauteur. Une image plus petite se charge plus vite ; la vue agrandie demande toujours ${FULL_HEIGHT} px.`,
    it: `Frigate riduce l'immagine del riquadro a questa altezza. Un'immagine più piccola si carica più velocemente; la vista ingrandita chiede sempre ${FULL_HEIGHT} px.`,
    es: `Frigate reduce la imagen del mosaico a esta altura. Una imagen más pequeña carga más rápido; la vista ampliada pide siempre ${FULL_HEIGHT} px.`,
    pl: `Frigate zmniejsza obraz kafelka do tej wysokości. Mniejszy obraz ładuje się szybciej; powiększony widok zawsze pobiera ${FULL_HEIGHT} px.`,
    uk: `Frigate зменшує зображення плитки до цієї висоти. Менше зображення завантажується швидше; збільшений вигляд завжди запитує ${FULL_HEIGHT} px.`,
    'zh-cn': `Frigate 将磁贴的图像缩小到此高度。图像越小加载越快；放大视图始终请求 ${FULL_HEIGHT} 像素。`,
};

/** The settings of both components: which camera, its name, the size of the picture and what Frigate draws in */
function cameraItems(devices: ManifestTexts['devices']): Record<string, WebComponentSetting> {
    return {
        camera: {
            type: 'objectId',
            // cameras are devices right below the instance: frigate.0.<camera>
            types: 'device',
            // every instance of the adapter; the element takes the instance from the ID
            root: 'frigate',
            label: devices('frigate_camera'),
            help: CAMERA_HELP,
        },
        showName: {
            type: 'checkbox',
            default: true,
            label: SHOW_NAME,
        },
        name: {
            type: 'text',
            label: devices('frigate_name'),
            help: devices('frigate_name_help'),
            hidden: 'data.showName === false',
        },
        height: {
            type: 'select',
            default: String(DEFAULT_HEIGHT),
            options: HEIGHTS.map(height => ({ value: height, label: `${height} px` })),
            label: HEIGHT,
            help: HEIGHT_HELP,
        },
        bbox: {
            type: 'checkbox',
            default: false,
            label: devices('frigate_bbox'),
        },
        timestamp: {
            type: 'checkbox',
            default: false,
            label: devices('frigate_timestamp'),
        },
    };
}

function snapshotSettings(devices: ManifestTexts['devices']): WebComponentSettingsPanel {
    return {
        type: 'panel',
        items: {
            ...cameraItems(devices),
            pollingInterval: {
                type: 'number',
                default: 2000,
                min: 500,
                max: 600000,
                label: devices('frigate_pollingInterval'),
                help: devices('frigate_pollingInterval_help'),
            },
            dialogPollingInterval: {
                type: 'number',
                default: 500,
                min: 200,
                max: 600000,
                label: devices('frigate_dialogPollingInterval'),
                help: devices('frigate_dialogPollingInterval_help'),
            },
        },
    };
}

function liveSettings(devices: ManifestTexts['devices']): WebComponentSettingsPanel {
    return {
        type: 'panel',
        items: {
            ...cameraItems(devices),
            _webHint: {
                type: 'staticText',
                text: devices('frigate_live_needs_web'),
            },
            _fallbackHint: {
                type: 'staticText',
                text: devices('frigate_live_fallback'),
            },
            webUrl: {
                type: 'text',
                label: devices('frigate_webUrl'),
                help: devices('frigate_webUrl_help'),
            },
            fps: {
                type: 'number',
                default: 5,
                min: 1,
                max: 30,
                label: devices('frigate_fps'),
                help: devices('frigate_fps_help'),
            },
        },
    };
}

/**
 * The manifest of a component
 *
 * @param component which one
 * @param texts the words of the devices widget of the same name
 */
export function buildManifest(component: ComponentName, texts: ManifestTexts): WebComponentManifest {
    return {
        $schema: 'https://raw.githubusercontent.com/ioBroker/web-components/main/schemas/manifest.json',
        manifestVersion: 1,
        tag: component === 'frigate-live' ? LIVE_TAG : SNAPSHOT_TAG,
        name: texts.name,
        description: texts.description,
        // relative to this file: /adapter/frigate/frigate.png
        icon: '../frigate.png',
        module: getModuleFile(component),
        // a 16:9 picture with its name below, as a tile of a dashboard
        size: { width: 400, height: 250 },
        settings: component === 'frigate-live' ? liveSettings(texts.devices) : snapshotSettings(texts.devices),
    };
}
