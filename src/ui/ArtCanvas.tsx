import { Canvas, Picture, createPicture, type SkCanvas } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Time in ms since mount, updated `fps` times a second while `active`.
 * Menu art is cheap (one Picture), so a modest JS-driven redraw is enough;
 * it stops while inactive, while the screen is covered by another one, and
 * while the app is in the background.
 */
export function useTicker(fps: number, active = true): number {
  const [time, setTime] = useState(0);
  // running time only: paused stretches (covered screen, background) don't count,
  // so an animation timed against it never skips ahead after a pause
  const elapsed = useRef(0);
  const focused = useIsFocused();
  const running = active && focused;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let prev: number | null = null;
    let emitted = elapsed.current;
    let foreground = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => (foreground = s === 'active'));
    const loop = (t: number) => {
      if (prev !== null && foreground) elapsed.current += Math.min(100, t - prev);
      prev = t;
      if (elapsed.current - emitted >= 1000 / fps) {
        emitted = elapsed.current;
        setTime(elapsed.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      sub.remove();
    };
  }, [fps, running]);
  return time;
}

/** One Skia canvas showing an imperatively drawn picture. `deps` decide when it redraws. */
export function ArtCanvas({
  width,
  height,
  draw,
  deps,
  style,
}: {
  width: number;
  height: number;
  draw: (canvas: SkCanvas, width: number, height: number) => void;
  deps: readonly unknown[];
  style?: StyleProp<ViewStyle>;
}) {
  const picture = useMemo(
    () => createPicture((c) => draw(c, width, height), { width, height }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, ...deps],
  );
  return (
    // flattened: Skia's web canvas does not accept style arrays
    <Canvas style={StyleSheet.flatten([{ width, height }, style])} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}
