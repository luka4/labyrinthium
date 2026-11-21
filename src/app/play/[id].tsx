import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PYRAMIDS, isPyramidId } from '../../game/core/pyramids';
import { isUnlocked, useProgress } from '../../state/progress';
import { GameScreen } from '../../screens/GameScreen';

/**
 * A descent. `from=camp` resumes at the saved camp; `from=floor&floor=<n>` replays one floor alone (n is
 * 1-based; any floor reached, the basement once its artifact is taken); anything else starts at the top.
 */
export default function PlayRoute() {
  const { id, from, floor } = useLocalSearchParams<{ id: string; from?: string; floor?: string }>();
  // read once: the checkpoint changes during the run, the start floor must not
  const [start] = useState(() => {
    if (!isPyramidId(id)) return { at: 0, replay: false };
    const st = useProgress.getState();
    if (from === 'floor') {
      const p = PYRAMIDS[id];
      const at = Math.floor(Number(floor)) - 1;
      const reached = at >= 0 && at < p.floorCount && at <= (st.deepest[id] ?? 0) && (at < p.floorCount - 1 || !!st.artifacts[id]);
      if (reached) return { at, replay: true };
    }
    return { at: from === 'camp' ? (st.camp[id] ?? 0) : 0, replay: false };
  });
  const unlocked = useProgress((s) => isPyramidId(id) && isUnlocked(id, s.artifacts));

  if (!isPyramidId(id) || !unlocked) return <Redirect href="/map" />;
  if (from === 'floor' && !start.replay) return <Redirect href={{ pathname: '/pyramid/[id]', params: { id } }} />;
  return <GameScreen pyramid={PYRAMIDS[id]} fromFloor={start.at} mode={start.replay ? 'replay' : 'descent'} />;
}
