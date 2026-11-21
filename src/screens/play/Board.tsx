import { Canvas, Picture, createPicture, type SkImage, type SkPicture } from '@shopify/react-native-skia';
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { GameState } from '../../game/core/game';
import { drawGame, type View } from '../../game/render/drawGame';
import { STRIP_H, drawLightHud } from '../../game/render/drawLightHud';
import type { LightMask } from '../../game/render/lightMask';

/** Gap between the light strip and the board, in px. */
export const STRIP_GAP = 8;

export type BoardProps = {
  game: MutableRefObject<GameState>;
  cam: MutableRefObject<{ x: number; y: number }>;
  art: SkImage | null;
  mask: LightMask;
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
  const anim = useRef({ floor: null as unknown, prevPos: 0, lastPos: 0 });

  useEffect(() => {
    props.drawRef.current = (time: number) => {
      const p = latest.current;
      const s = p.game.current;
      const a = anim.current;
      if (a.floor !== s.floor) {
        a.floor = s.floor;
        a.prevPos = s.pos;
        a.lastPos = s.pos;
      } else if (s.pos !== a.lastPos) {
        a.prevPos = a.lastPos;
        a.lastPos = s.pos;
      }
      const view: View = { camX: p.cam.current.x, camY: p.cam.current.y, board: p.boardSize, tilePx: p.tilePx };
      const frame = { time, prevPos: a.prevPos };
      setPicture(
        createPicture(
          (canvas) => {
            canvas.save();
            canvas.translate(0, STRIP_H + STRIP_GAP);
            drawGame(canvas, s, p.art, p.mask, view, frame);
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
  }, [props.drawRef]);

  return (
    <Canvas style={{ width: props.boardSize, height: STRIP_H + STRIP_GAP + props.boardSize }}>
      {picture && <Picture picture={picture} />}
    </Canvas>
  );
});
