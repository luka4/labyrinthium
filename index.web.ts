// `@expo/metro-runtime` must come first for Fast Refresh on web; `expo` sets up
// the loader that the dynamic import below needs.
import '@expo/metro-runtime';
import 'expo';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// Web only (a preview, not device verification): CanvasKit must load before any
// module touches Skia, so the router (and with it every route) is imported after it.
LoadSkiaWeb({ locateFile: (file) => `/${file}` }).then(async () => {
  await import('./src/web-root');
});
