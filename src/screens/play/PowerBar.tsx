import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { POWER_ORDER, type PowerId, type PowerRun } from '../../game/core/powers';
import { POWER_INFO } from '../../game/core/pyramids';
import { POWER_H, SOCKET, socketX, socketY } from '../../game/render/drawPowerBar';

/** What the bar's accessibility labels say; computed with the HUD text (at most 4 times a second). */
export type PowerText = Array<{ id: PowerId; label: string; disabled: boolean }>;

export function powerTextOf(powers: readonly PowerRun[]): PowerText {
  return powers.map((p) => {
    const info = POWER_INFO[p.id];
    const state = p.left > 0 ? 'active' : `${p.uses} ${p.uses === 1 ? 'use' : 'uses'} left`;
    return { id: p.id, label: `${info.name}, ${state}, ${info.verb.toLowerCase()}`, disabled: p.uses <= 0 && p.left <= 0 };
  });
}

/**
 * One Pressable per owned socket over the power bar drawn in the board canvas (drawPowerBar.ts).
 * A tap uses the power (core `step({ type: 'power' })`); web keys 1-4 do the same.
 */
export const PowerBar = memo(function PowerBar({ text, width, top, onUse }: { text: PowerText; width: number; top: number; onUse: (id: PowerId) => void }) {
  return (
    <View style={{ position: 'absolute', left: 0, top, width, height: POWER_H }} pointerEvents="box-none">
      {text.map((p) => (
        <Pressable
          key={p.id}
          onPress={() => onUse(p.id)}
          accessibilityRole="button"
          accessibilityLabel={p.label}
          accessibilityState={{ disabled: p.disabled }}
          hitSlop={6}
          style={{ position: 'absolute', left: socketX(POWER_ORDER.indexOf(p.id), width), top: socketY, width: SOCKET, height: SOCKET, borderRadius: SOCKET / 2 }}
        />
      ))}
    </View>
  );
});
