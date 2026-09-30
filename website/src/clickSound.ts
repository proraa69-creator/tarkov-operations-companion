/**
 * The website plays exactly the desktop app's UI sounds: the same recording (src/assets/sounds/click.mp3), the same
 * processing (level, low-pass, soft attack), the same hover tick and the same list of clickable elements — by reusing
 * the app's own component instead of a copy that could drift apart.
 */
export { UiSounds } from '../../src/components/UiSounds'
