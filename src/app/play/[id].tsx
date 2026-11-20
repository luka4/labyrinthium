import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { PYRAMIDS, isPyramidId } from '../../game/core/pyramids';
import { isUnlocked, useProgress } from '../../state/progress';
import { GameScreen } from '../../screens/GameScreen';

/** A descent. `from=camp` resumes at the saved camp; anything else starts at the top. */
export default function PlayRoute() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  // read once: the checkpoint changes during the run, the start floor must not
  const [startAt] = useState(() => (isPyramidId(id) && from === 'camp' ? (useProgress.getState().camp[id] ?? 0) : 0));
  const unlocked = useProgress((s) => isPyramidId(id) && isUnlocked(id, s.artifacts));

  if (!isPyramidId(id) || !unlocked) return <Redirect href="/map" />;
  return <GameScreen pyramid={PYRAMIDS[id]} fromFloor={startAt} />;
}
