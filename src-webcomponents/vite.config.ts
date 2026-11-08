import react from '@vitejs/plugin-react';
import { checkManifest, getReactImportPath, REACT_SPECIFIERS, type WebComponentText } from '@iobroker/web-components';
import { readFileSync } from 'node:fs';
import type { Plugin, UserConfig } from 'vite';

// with the extension: Vite may load its config natively, without a bundler that would add it
import {
    COMPONENT_NAMES,
    DEVICES_WIDGETS,
    DEVICES_WORDS,
    getManifestFile,
    getModuleFile,
    getModulePath,
    type ComponentName,
} from './src/constants.ts';
import { buildManifest } from './src/manifest.ts';

/**
 * The web components `<iob-frigate-snapshot>` and `<iob-frigate-live>`: one ES module each,
 * `admin/webcomponents/frigate-snapshot.js` and `frigate-live.js`, and its manifest `<name>.json` next to it
 * (`common.webComponents`). Every host - vis-2, devices, Aura, admin - reads them from
 * `/adapter/frigate/webcomponents/`. No module federation: the host shares nothing but the socket.
 *
 * One build per component - `vite build --mode frigate-snapshot`, `vite build --mode frigate-live`
 * (`npm run build`): a host imports exactly one URL per component, so each module is one file, with the shared code
 * compiled into both. One build with two entries would move the shared code into a chunk of its own.
 *
 * React is not bundled: the four React imports point at `lib/esm/react-19.js`, which web and admin serve
 * beside `adapter/`. The path is relative to the module, so a path prefix of a reverse proxy stays.
 */

const LANGUAGES: ioBroker.Languages[] = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

/** The module of each component */
const ENTRIES: Record<ComponentName, string> = {
    'frigate-snapshot': './src/Snapshot.tsx',
    'frigate-live': './src/Live.tsx',
};

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

/** The dictionaries of the devices widgets, by language */
const DEVICES_DICTIONARY = Object.fromEntries(
    LANGUAGES.map(lang => [lang, readJson<Record<string, string>>(`../src-devices/src/i18n/${lang}.json`)]),
) as Record<ioBroker.Languages, Record<string, string>>;

/**
 * A word of the devices widgets in every language
 *
 * @param key the key in `src-devices/src/i18n/<lang>.json`
 */
function devicesWord(key: string): WebComponentText {
    const text: Partial<Record<ioBroker.Languages, string>> = {};
    for (const lang of LANGUAGES) {
        if (!DEVICES_DICTIONARY[lang][key]) {
            throw new Error(`src-devices/src/i18n/${lang}.json has no "${key}"`);
        }
        text[lang] = DEVICES_DICTIONARY[lang][key];
    }
    return text as WebComponentText;
}

/**
 * The words of the devices widgets that the element of a component shows, by language: `__FRIGATE_WORDS__`
 *
 * @param name the component
 */
function pickWords(name: ComponentName): Record<string, Record<string, string>> {
    const picked: Record<string, Record<string, string>> = {};
    for (const key of DEVICES_WORDS[name]) {
        const text = devicesWord(key) as Record<string, string>;
        for (const lang of LANGUAGES) {
            picked[lang] ||= {};
            picked[lang][key] = text[lang];
        }
    }
    return picked;
}

/**
 * A text of `io-package.json`, which must be there in every language
 *
 * @param text the text
 * @param what where it is, for the error
 */
function translated(text: ioBroker.StringOrTranslated | undefined, what: string): WebComponentText {
    for (const lang of LANGUAGES) {
        if (!text || typeof text !== 'object' || !text[lang]) {
            throw new Error(`io-package.json: ${what} has no text in "${lang}"`);
        }
    }
    return text as WebComponentText;
}

/**
 * Writes `<name>.json` next to the module, checked like a host checks it
 *
 * @param name the component
 */
function manifestFile(name: ComponentName): Plugin {
    return {
        name: 'frigate-web-component-manifest',
        generateBundle() {
            let manifest;
            try {
                const ioPackage = readJson<ioBroker.AdapterObject>('../io-package.json');
                const widgetName = DEVICES_WIDGETS[name];
                const widget = ioPackage.common.deviceWidgets?.components.find(c => c.name === widgetName);
                if (!widget) {
                    throw new Error(`io-package.json has no devices widget "${widgetName}"`);
                }
                manifest = buildManifest(name, {
                    name: translated(widget.label, `the label of ${widgetName}`),
                    description: translated(widget.description, `the description of ${widgetName}`),
                    devices: devicesWord,
                });
            } catch (e) {
                this.error(`${getManifestFile(name)}: ${(e as Error).message}`);
            }
            const problem = checkManifest(manifest);
            if (problem) {
                this.error(`${getManifestFile(name)}: ${problem}`);
            }
            if (manifest.module !== getModuleFile(name)) {
                this.error(`${getManifestFile(name)}: "module" must be "${getModuleFile(name)}"`);
            }
            this.emitFile({
                type: 'asset',
                fileName: getManifestFile(name),
                source: `${JSON.stringify(manifest, null, 4)}\n`,
            });
        },
    };
}

export default ({ mode }: { mode: string }): UserConfig => {
    const name = COMPONENT_NAMES.find(component => component === mode);
    if (!name) {
        throw new Error(`Build one component at a time: vite build --mode <${COMPONENT_NAMES.join('|')}>`);
    }
    const reactImport = getReactImportPath(getModulePath(name));

    return {
        plugins: [react(), manifestFile(name)],
        define: {
            __FRIGATE_WORDS__: JSON.stringify(pickWords(name)),
            'process.env.NODE_ENV': JSON.stringify('production'),
        },
        build: {
            target: 'es2022',
            outDir: './build',
            // the builds of all components write into the same folder: only the first one empties it
            emptyOutDir: name === COMPONENT_NAMES[0],
            lib: {
                entry: ENTRIES[name],
                formats: ['es'],
                fileName: (): string => getModuleFile(name),
            },
            rollupOptions: {
                external: [...REACT_SPECIFIERS],
                output: {
                    paths: Object.fromEntries(REACT_SPECIFIERS.map(specifier => [specifier, reactImport])),
                    // one file: a host imports exactly one URL
                    codeSplitting: false,
                    // library mode keeps whitespace for the bundler of a consumer; this module is loaded as it is
                    minify: true,
                },
            },
        },
    };
};
