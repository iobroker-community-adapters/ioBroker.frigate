/**
 * The words the element shows, in the languages of ioBroker.
 *
 * Most of them are words of the devices widgets (`src-devices/src/i18n/`): the build picks those a component needs
 * (`DEVICES_WORDS` in `constants.ts`) into `__FRIGATE_WORDS__`, see `vite.config.ts`. Only the words the devices
 * widgets do not have live here.
 */

/** The words of the devices widgets this component shows, by language - picked by the build */
declare const __FRIGATE_WORDS__: Record<string, Record<string, string>>;

/** Once: the build writes the words in place of every mention */
const DEVICES_WORDS = __FRIGATE_WORDS__;

const EN = {
    notCamera: 'Not a camera of Frigate',
    enlarge: 'Enlarge',
};

export type OwnWordKey = keyof typeof EN;

const WORDS: Record<string, Record<OwnWordKey, string>> = {
    en: EN,
    de: {
        notCamera: 'Keine Kamera von Frigate',
        enlarge: 'Vergrößern',
    },
    ru: {
        notCamera: 'Это не камера Frigate',
        enlarge: 'Увеличить',
    },
    pt: {
        notCamera: 'Não é uma câmera do Frigate',
        enlarge: 'Ampliar',
    },
    nl: {
        notCamera: 'Geen camera van Frigate',
        enlarge: 'Vergroten',
    },
    fr: {
        notCamera: "Ce n'est pas une caméra de Frigate",
        enlarge: 'Agrandir',
    },
    it: {
        notCamera: 'Non è una telecamera di Frigate',
        enlarge: 'Ingrandisci',
    },
    es: {
        notCamera: 'No es una cámara de Frigate',
        enlarge: 'Ampliar',
    },
    pl: {
        notCamera: 'To nie jest kamera Frigate',
        enlarge: 'Powiększ',
    },
    uk: {
        notCamera: 'Це не камера Frigate',
        enlarge: 'Збільшити',
    },
    'zh-cn': {
        notCamera: '不是 Frigate 的摄像机',
        enlarge: '放大',
    },
};

/**
 * A word in the language of the system, English if there is none in it: one of this file, or one of the devices
 * widgets that the build picked for this component (`frigate_...`)
 *
 * @param lang the language of the ioBroker system
 * @param key the word
 */
export function getWord(lang: string, key: OwnWordKey | `frigate_${string}`): string {
    if (key in EN) {
        return WORDS[lang]?.[key as OwnWordKey] || EN[key as OwnWordKey];
    }
    return DEVICES_WORDS[lang]?.[key] || DEVICES_WORDS.en?.[key] || key;
}

export type Word = (key: OwnWordKey | `frigate_${string}`) => string;
