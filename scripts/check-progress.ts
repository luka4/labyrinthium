/**
 * Progress v6 (plan 06): migration from older saves and revision reconciliation. Pure, no storage.
 * Called from check-floors.ts.
 */
import { PYRAMIDS, type PyramidId } from '../src/game/core/pyramids';
import { EMPTY, PROGRESS_VERSION, migrateProgress, ownedPowers, reconcileRevisions, type ProgressData } from '../src/state/migrateProgress';

type Report = { fail: (m: string) => void; warn: (m: string) => void };

const clone = <T>(v: T): T => structuredClone(v);

export function runProgressChecks({ fail }: Report) {
  if (PROGRESS_VERSION !== 6) fail(`progress: version ${PROGRESS_VERSION}, want 6`);
  const ids = Object.keys(PYRAMIDS) as PyramidId[];
  const revsNow = Object.fromEntries(ids.map((id) => [id, PYRAMIDS[id].rev]));

  // saves of every older version become v6: revs current, focus null, the rest as the v5 migration gives it
  const v1 = { deepest: { egypt: 99 }, camp: { egypt: 3 } };
  const v3 = { artifacts: { egypt: true }, camp: { egypt: 9 }, deepest: { egypt: 12, maya: 2 }, completions: { egypt: 1 }, blackUnlockSeen: false, endingSeen: false, hints: { plate: true }, records: {} };
  const v4 = { ...v3, records: { egypt: { escapes: 2, bestEscape: 31, untouched: 1 } } };
  const v5 = { ...v4, floors: { egypt: { 0: { s: 3, t: 12.5, f: 1, n: 1 } } } };
  for (const [name, save, from] of [['v1', v1, 1], ['v3', v3, 3], ['v4', v4, 4], ['v5', v5, 5]] as const) {
    const m = migrateProgress(clone(save), from);
    if (JSON.stringify(m.revs) !== JSON.stringify(revsNow)) fail(`progress ${name}: revs are not all current`);
    if (m.focus !== null) fail(`progress ${name}: focus is not null`);
    // everything else equals what the previous version's migration gave
    const prev = from === 5 ? { ...EMPTY, ...clone(save) } : migrateProgress(clone(save), from === 1 ? 1 : from);
    const strip = (d: Partial<ProgressData>) => JSON.stringify({ ...d, revs: undefined, focus: undefined });
    if (strip(m) !== strip(prev) && from === 5) fail(`progress ${name}: other fields changed`);
  }
  const m5 = migrateProgress(clone(v5), 5);
  if (JSON.stringify(m5.floors) !== JSON.stringify(v5.floors) || m5.camp.egypt !== 9 || m5.records.egypt?.escapes !== 2) fail('progress v5: a v5 save was rewritten beyond revs and focus');
  // a v6 save is left alone
  const v6 = { ...EMPTY, revs: { egypt: 1, maya: 1 }, focus: 'china' as const, deepest: { maya: 3 } };
  const m6 = migrateProgress(clone(v6), 6);
  if (m6.focus !== 'china' || JSON.stringify(m6.revs) !== JSON.stringify(v6.revs)) fail('progress: a v6 save was rewritten');

  // reconcileRevisions with maya rebuilt (rev 2)
  const data: ProgressData = {
    ...EMPTY,
    artifacts: { egypt: true, maya: true },
    camp: { egypt: 9, maya: 4 },
    deepest: { egypt: 12, maya: 4 },
    completions: { maya: 1, egypt: 1 },
    records: { maya: { escapes: 1, bestEscape: 40, untouched: 1 } },
    floors: { egypt: { 0: { s: 1, t: null, f: 0, n: 1 } }, maya: { 0: { s: 1, t: null, f: 0, n: 1 }, 3: { s: 3, t: 20, f: 1, n: 1 } } },
    revs: { egypt: 1, maya: 1, cambodia: 1, china: 1, black: 1 },
  };
  const revOf = (id: PyramidId) => (id === 'maya' ? 2 : 1);
  const r = reconcileRevisions(clone(data), revOf);
  if (r.camp.maya !== undefined || r.deepest.maya !== undefined || r.floors.maya !== undefined) fail('reconcile: maya camp/deepest/floors were not cleared');
  if (!r.artifacts.maya || r.completions.maya !== 1 || r.records.maya?.escapes !== 1) fail('reconcile: maya artifact, completions or records were lost');
  if (r.camp.egypt !== 9 || r.deepest.egypt !== 12 || !r.floors.egypt?.[0] || !r.artifacts.egypt) fail('reconcile: egypt was touched');
  if (r.revs.maya !== 2) fail('reconcile: revs.maya not updated');
  const again = reconcileRevisions(clone(r), revOf);
  if (JSON.stringify(again) !== JSON.stringify(r)) fail('reconcile: a second call changed something');
  // missing revs entries are left alone and stamped
  const partial = reconcileRevisions({ ...clone(data), revs: { egypt: 1 } }, revOf);
  if (partial.camp.maya !== 4 || partial.deepest.maya !== 4 || partial.revs.maya !== 2 || partial.revs.china !== 1) fail('reconcile: a pyramid with no stored revision was cleared or not stamped');
  // the input is not mutated
  const frozen = clone(data);
  const snap = JSON.stringify(frozen);
  reconcileRevisions(frozen, revOf);
  if (JSON.stringify(frozen) !== snap) fail('reconcile: mutated its input');

  // powers owned
  if (ownedPowers({}).length) fail('progress: powers owned with no artifacts');
  if (ownedPowers({ china: true, egypt: true }).join() !== 'scarab,jade') fail('progress: ownedPowers order');
}
