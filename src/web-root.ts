// Web only: the Expo Router root, imported by index.web.ts after CanvasKit has loaded.
// Same as expo-router/entry-classic, minus the metro runtime that index.web.ts loads first.
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

renderRootComponent(App);
