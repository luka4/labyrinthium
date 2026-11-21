import { Canvas, Picture, createPicture, type SkPicture } from '@shopify/react-native-skia';
import { useIsFocused } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { PYRAMIDS, type PyramidId } from '../../game/core/pyramids';
import { drawGlobe, globeRadius, project, type GlobeView } from '../../game/render/drawGlobe';
import { SITE_ORDER, turn, viewFor, visible, type LonLat } from '../../game/world/geo';
import { warmLand } from '../../game/world/projectLand';

/** The globe: drag to turn, release to coast, a coast that ends near a site snaps to it, tap a marker to select. */
const TURN_MS = 700;
const COAST_DECAY = 4;
const SNAP_DEG = 12;
const TAP_DP = 28;
const IDLE_FPS = 15;
const DEG = 180 / Math.PI;

const clampLat = (v: number) => Math.max(-20, Math.min(45, v));
const wrapLon = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;

export type GlobeProps = {
  size: number;
  selected: PyramidId;
  collected: Partial<Record<PyramidId, true>>;
  /** a seal filling in: the arc is drawn up to `t` (0..1) */
  filling?: { id: PyramidId; t: number } | null;
  /** the centre follows this great-circle turn while a seal travels (overrides dragging) */
  follow?: { from: PyramidId; to: PyramidId; t: number } | null;
  /** 0..1 the haze thinning */
  unlock: number;
  reducedMotion: boolean;
  onSelect: (id: PyramidId) => void;
};

type Motion = { center: LonLat; vel: { lon: number; lat: number }; turn: { from: LonLat; to: LonLat; t0: number; ms: number } | null; coasting: boolean };

export const Globe = memo(function Globe(props: GlobeProps) {
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const focused = useIsFocused();
  const motion = useRef<Motion>({ center: viewFor(props.selected), vel: { lon: 0, lat: 0 }, turn: null, coasting: false });
  const clock = useRef(0);
  const drag = useRef({ active: false, x: 0, y: 0, x0: 0, y0: 0, t0: 0, samples: [] as Array<{ t: number; x: number; y: number }> });
  const lastSelected = useRef(props.selected);
  const picturePending = useRef(true);

  // the land is parsed once, lazily, on the first mount (about 15 ms)
  useEffect(() => {
    warmLand();
  }, []);

  const startTurn = (to: LonLat) => {
    const m = motion.current;
    m.coasting = false;
    if (latest.current.reducedMotion) {
      m.center = to;
      m.turn = null;
    } else m.turn = { from: m.center, to, t0: clock.current, ms: TURN_MS };
  };

  // a new selection from the pager turns the globe to it (the globe's own snap already did)
  useEffect(() => {
    if (lastSelected.current === props.selected) return;
    lastSelected.current = props.selected;
    const to = viewFor(props.selected);
    const m = motion.current;
    if (m.turn && Math.abs(m.turn.to.lon - to.lon) < 1e-6 && Math.abs(m.turn.to.lat - to.lat) < 1e-6) return;
    startTurn(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected]);

  useEffect(() => {
    if (!focused) return;
    let raf = 0;
    let prev: number | null = null;
    let sinceDraw = 1;
    let foreground = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => (foreground = s === 'active'));
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = prev === null || !foreground ? 0 : Math.min(0.1, (t - prev) / 1000);
      prev = t;
      clock.current += dt;
      const p = latest.current;
      const m = motion.current;
      let moving = false;
      if (p.follow) {
        m.center = turn(viewFor(p.follow.from), viewFor(p.follow.to), p.follow.t);
        m.turn = null;
        m.coasting = false;
        moving = true;
      } else if (m.turn) {
        const u = Math.min(1, (clock.current - m.turn.t0) / (m.turn.ms / 1000));
        m.center = turn(m.turn.from, m.turn.to, u);
        if (u >= 1) m.turn = null;
        moving = true;
      } else if (m.coasting) {
        const k = Math.exp(-COAST_DECAY * dt);
        m.center = { lon: wrapLon(m.center.lon + m.vel.lon * dt), lat: clampLat(m.center.lat + m.vel.lat * dt) };
        m.vel = { lon: m.vel.lon * k, lat: m.vel.lat * k };
        moving = true;
        if (Math.hypot(m.vel.lon, m.vel.lat) < 2) {
          m.coasting = false;
          // a coast that ends near a site snaps to it and selects it
          let best: PyramidId | null = null;
          let bd = SNAP_DEG;
          for (const id of SITE_ORDER) {
            const v = viewFor(id);
            const d = Math.hypot(wrapLon(v.lon - m.center.lon) * Math.cos((m.center.lat * Math.PI) / 180), v.lat - m.center.lat);
            if (d < bd) {
              bd = d;
              best = id;
            }
          }
          if (best) {
            startTurn(viewFor(best));
            lastSelected.current = best;
            p.onSelect(best);
          }
        }
      } else if (drag.current.active) moving = true;
      sinceDraw += dt;
      const animating = moving || !!p.filling || p.unlock > 0 && p.unlock < 1;
      if (animating || (!p.reducedMotion && sinceDraw >= 1 / IDLE_FPS) || picturePending.current) {
        sinceDraw = 0;
        picturePending.current = false;
        const view: GlobeView = {
          center: m.center,
          selected: p.selected,
          collected: p.collected,
          filling: p.filling ? { id: p.filling.id, t: p.filling.t } : undefined,
          unlock: p.unlock,
          time: clock.current,
          reducedMotion: p.reducedMotion,
        };
        setPicture(createPicture((canvas) => drawGlobe(canvas, p.size, p.size, view), { width: p.size, height: p.size }));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      sub.remove();
    };
  }, [focused]);
  // anything that changes what is drawn redraws once (also when the loop idles with reduced motion)
  useEffect(() => {
    picturePending.current = true;
  }, [props.size, props.selected, props.collected, props.unlock, props.filling]);

  // ---- touch ----------------------------------------------------------------------------------------------------
  const R = globeRadius(props.size, props.size);
  const onGrant = (e: GestureResponderEvent) => {
    const d = drag.current;
    const { locationX: x, locationY: y, timestamp } = e.nativeEvent;
    d.active = true;
    d.x = d.x0 = x;
    d.y = d.y0 = y;
    d.t0 = timestamp;
    d.samples = [{ t: timestamp, x, y }];
    motion.current.coasting = false;
    motion.current.turn = null;
  };
  const onMove = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d.active || latest.current.follow) return;
    const { locationX: x, locationY: y, timestamp } = e.nativeEvent;
    const m = motion.current;
    m.center = { lon: wrapLon(m.center.lon - ((x - d.x) / R) * DEG), lat: clampLat(m.center.lat + ((y - d.y) / R) * DEG) };
    d.x = x;
    d.y = y;
    d.samples.push({ t: timestamp, x, y });
    while (d.samples.length > 2 && timestamp - d.samples[0].t > 80) d.samples.shift();
  };
  const onEnd = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const { locationX: x, locationY: y, timestamp } = e.nativeEvent;
    const moved = Math.hypot(x - d.x0, y - d.y0);
    const m = motion.current;
    if (moved < 8 && timestamp - d.t0 < 400) {
      // a tap: the marker within 28 dp that faces you
      const cx = props.size / 2;
      let best: PyramidId | null = null;
      let bd = TAP_DP;
      for (const id of SITE_ORDER) {
        const s = PYRAMIDS[id].site;
        if (!visible(m.center, s)) continue;
        const q = project(m.center, R, cx, cx, s.lon, s.lat);
        const dist = Math.hypot(q.x - x, q.y - 6 - y);
        if (dist < bd) {
          bd = dist;
          best = id;
        }
      }
      if (best) {
        lastSelected.current = best;
        startTurn(viewFor(best));
        latest.current.onSelect(best);
      }
      return;
    }
    const first = d.samples[0];
    const span = Math.max(1, timestamp - first.t);
    const vx = ((x - first.x) / span) * 1000; // dp per second
    const vy = ((y - first.y) / span) * 1000;
    if (Math.hypot(vx, vy) > 60 && !latest.current.reducedMotion) {
      m.vel = { lon: -(vx / R) * DEG, lat: (vy / R) * DEG };
      m.coasting = true;
    } else {
      // released at rest: snap to a site within reach, else stay
      m.vel = { lon: 0, lat: 0 };
      m.coasting = true;
    }
  };

  return (
    <View style={{ width: props.size, height: props.size }}>
      <Canvas style={StyleSheet.flatten([{ width: props.size, height: props.size }])} pointerEvents="none">
        {picture && <Picture picture={picture} />}
      </Canvas>
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onEnd}
        onResponderTerminate={onEnd}
        accessibilityLabel="Globe. Choose a pyramid with the cards below."
      />
    </View>
  );
});

