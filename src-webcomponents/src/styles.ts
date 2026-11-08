/**
 * The styles of the shadow roots. The element fills the box of the host; it has a transparent background and
 * inherits `color` and `font`, so it follows the theme of the host. The rest comes from the theme variables of the
 * host (`--iob-primary`, `--iob-text-secondary`, `--iob-error`, ...), so it looks right in light and dark.
 *
 * The sizes follow the box by container queries (`cqmin`) - the element never measures itself.
 */

/** What the tile and the enlarged view share: the picture, the spinner and the hints */
const PICTURE_STYLES = `
.picture {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
}
.picture img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.stream {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}
.overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
.spinner {
    box-sizing: border-box;
    width: clamp(16px, 14cqmin, 40px);
    height: clamp(16px, 14cqmin, 40px);
    border-radius: 50%;
    border: clamp(2px, 1.2cqmin, 4px) solid color-mix(in srgb, var(--iob-primary) 25%, transparent);
    border-top-color: var(--iob-primary);
    animation: spin 0.9s linear infinite;
}
@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}
.hint {
    box-sizing: border-box;
    max-width: 100%;
    max-height: 100%;
    padding: 0.5em;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4em;
    text-align: center;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--iob-text-secondary);
    font-size: clamp(10px, 5cqmin, 15px);
    line-height: 1.35;
}
.hint.error {
    color: var(--iob-error);
}
.hint svg {
    flex: none;
    width: clamp(18px, 13cqmin, 40px);
    height: clamp(18px, 13cqmin, 40px);
    fill: currentColor;
    opacity: 0.6;
}
`;

/** The tile: the picture, its name below it. The shared styles first: those of the tile win over them */
export const STYLES = `
${PICTURE_STYLES}
:host {
    display: block;
    width: 100%;
    height: 100%;
}
.mount {
    width: 100%;
    height: 100%;
    /* the size of the box does not depend on what is in it - no loop between measuring and laying out */
    container-type: size;
}
.tile {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: clamp(2px, 1.5cqmin, 6px);
    overflow: hidden;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}
.tile.clickable {
    cursor: pointer;
}
.tile.edit {
    pointer-events: none;
}
.tile:focus-visible {
    outline: 2px solid var(--iob-primary);
    outline-offset: -2px;
    border-radius: var(--iob-border-radius);
}
.tile > .picture {
    flex: 1;
    min-height: 0;
    border-radius: var(--iob-border-radius);
}
.tile > .picture.empty {
    background: color-mix(in srgb, currentColor 6%, transparent);
}
.label {
    flex: none;
    padding: 0 0.3em;
    font-size: clamp(10px, 5.5cqmin, 16px);
    font-weight: 700;
    line-height: 1.4;
    color: var(--iob-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
`;

/** The enlarged view in the dialog of the host: the picture as big as the dialog allows */
export const DIALOG_STYLES = `
${PICTURE_STYLES}
:host {
    display: block;
}
.full {
    width: 100%;
    display: flex;
    justify-content: center;
}
.full > .picture {
    width: 100%;
}
.full .stream {
    height: auto;
}
.full img {
    height: auto;
    /* the whole frame on the screen: what the dialog takes around the picture is about 140 px */
    max-height: calc(100vh - 140px);
}
/* a picture that is not there yet has no height: keep about the place of a 16:9 picture meanwhile */
.full > .picture.empty,
.full .stream.loading {
    min-height: min(50vh, 56vw);
}
.full .spinner {
    width: 40px;
    height: 40px;
    border-width: 4px;
}
.full .hint {
    font-size: 15px;
}
.full .hint svg {
    width: 40px;
    height: 40px;
}
`;
