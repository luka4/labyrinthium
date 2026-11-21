import { Canvas, Picture, createPicture, type SkPicture } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import type { GameState } from '../../game/core/game';
import { createSandRenderer, drawGame, viewWindow, type View } from '../../game/render/drawGame';
import { STRIP_H, drawLightHud } from '../../game/render/drawLightHud';
import { secretAtSeal } from '../../game/core/secrets';
import type { SecretFx } from '../../game/render/drawSecrets';
import type { FloorArt } from '../../game/render/floorArt';
import type { LightMask } from '../../game/render/lightMask';
import type { FloorTheme } from '../../game/render/themes';
import { hash01 } from '../../game/render/art';

/** Gap between the light strip and the board, in px. */
export const STRIP_GAP = 8;

export type BoardProps = {
  game: MutableRefObject<GameState>;
  cam: MutableRefObject<{ x: number; y: number }>;
  art: FloorArt | null;
  theme: FloorTheme;
  mask: LightMask;
  reducedMotion: boolean;
  boardSize: number;
  tilePx: number;
  /** register the redraw function; the screen's frame loop calls it */
  drawRef: MutableRefObject<((time: number) => void) | null>;
};

/**
 * The one canvas: light strip on top, board below. It owns the latest picture as its own
 * state, so a redraw re-renders only this small component, never the whole screen.
 */
export const Board = memo(function Board(props: BoardProps) {
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const anim = useRef({ floor: null as unknown, prevPos: 0, lastPos: 0, quakeSeq: 0, quakeAt: -10, fallAt: -1, wisps: [] as Array<{ at: number; t0: number }>, fx: { knock: [], taken: [] } as SecretFx });
  const sand = useMemo(() => createSandRenderer(props.theme), [props.theme]);
  useEffect(() => () => sand.dispose(), [sand]);

  useEffect(() => {
    props.drawRef.current = (time: number) => {
      const p = latest.current;
      const s = p.game.current;
      const a = anim.current;
      if (a.floor !== s.floor) {
        a.floor = s.floor;
        a.prevPos = s.pos;
        a.lastPos = s.pos;
        a.quakeSeq = s.eventSeq;
        a.fallAt = -1;
        a.wisps = [];
        a.fx = { knock: [], taken: [] };
      } else if (s.pos !== a.lastPos) {
        a.prevPos = a.lastPos;
        a.lastPos = s.pos;
      }
      // the quake shakes the camera for 0.6 s; a fall takes 0.25 s
      for (const e of s.events) {
        if (e.seq > a.quakeSeq && e.type === 'quake') a.quakeAt = time;
        // a flame the guardian put out: a wisp of smoke for 1.5 s
        if (e.seq > a.quakeSeq && e.type === 'snuffed' && e.at >= 0) a.wisps.push({ at: e.at, t0: time });
        // a push on the plaster and a grave good lifted: short effects (plan 05)
        if (e.seq > a.quakeSeq && e.type === 'secretKnock') a.fx.knock.push({ k: secretAtSeal(s.floor, e.at), t0: time });
        if (e.seq > a.quakeSeq && e.type === 'treasure') a.fx.taken.push({ k: s.floor.secrets.findIndex((x) => x.spot === e.at), t0: time });
      }
      if (a.wisps.length) a.wisps = a.wisps.filter((w) => time - w.t0 < 1.6);
      a.quakeSeq = s.eventSeq;
      let shakeX = 0;
      let shakeY = 0;
      const u = (time - a.quakeAt) / 0.6;
      if (u >= 0 && u < 1 && !p.reducedMotion) {
        const amp = 0.15 * (1 - u) * (1 - u);
        const n = Math.floor(time * 45);
        shakeX = (hash01(n) - 0.5) * 2 * amp;
        shakeY = (hash01(n + 91) - 0.5) * 2 * amp;
      }
      if (s.status === 'falling') {
        if (a.fallAt < 0) a.fallAt = time;
      } else a.fallAt = -1;
      const fall = a.fallAt < 0 ? 0 : Math.min(1, (time - a.fallAt) / 0.25);
      const view: View = { camX: p.cam.current.x + shakeX, camY: p.cam.current.y + shakeY, board: p.boardSize, tilePx: p.tilePx };
      const frame = { time, prevPos: a.prevPos, fall, wisps: a.wisps, secretFx: a.fx };
      // rasterise the floor art the view needs (chunks), then prefetch within a small budget
      const win = viewWindow(view, s.floor.size, 1);
      p.art?.ensure(win, 6);
      setPicture(
        createPicture(
          (canvas) => {
            canvas.save();
            canvas.translate(0, STRIP_H + STRIP_GAP);
            drawGame(canvas, s, { art: p.art, mask: p.mask, sand, theme: p.theme }, view, frame);
            canvas.restore();
            drawLightHud(canvas, s, p.boardSize, time);
          },
          { width: p.boardSize, height: STRIP_H + STRIP_GAP + p.boardSize },
        ),
      );
    };
    const ref = props.drawRef;
    return () => {
      ref.current = null;
    };
  }, [props.drawRef, sand]);

  return (
    <Canvas style={{ width: props.boardSize, height: STRIP_H + STRIP_GAP + props.boardSize }}>
      {picture && <Picture picture={picture} />}
    </Canvas>
  );
});
