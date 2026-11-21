import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { POWERS, type PowerId } from '../../game/core/powers';
import { POWER_INFO, PYRAMIDS, type PyramidId } from '../../game/core/pyramids';
import { drawEmblem } from '../../game/render/drawEmblems';
import { ArtCanvas } from '../../ui/ArtCanvas';
import { Button } from '../../ui/Button';
import { colors, fonts, radius, space, type } from '../../ui/theme';
import { SealDoor } from './SealDoor';

export type CardData = {
  id: PyramidId;
  /** the status line ("Camp · floor 14", "Sealed · 2 of 4") */
  status: string;
  done: boolean;
  taken: boolean;
  stars: { stars: number; max: number };
  /** floor of the saved camp, or null */
  camp: number | null;
  /** an owned power that is strongest here, if any */
  attuned: PowerId | null;
  sealed: boolean;
  filled: number;
};

/**
 * One site of the pager: eyebrow (where it stands), name, status, the artifact it keeps, stars, an
 * attuned-power note and the way in. The Black Pyramid's card carries the seal door.
 */
export const SiteCard = memo(function SiteCard({
  card,
  width,
  door,
  onEnter,
  onContinue,
  onDoor,
}: {
  card: CardData;
  width: number;
  door?: { collected: Partial<Record<PyramidId, true>>; unlock: number; filling: { id: PyramidId; t: number } | null; time: number };
  onEnter: () => void;
  onContinue: () => void;
  onDoor: () => void;
}) {
  const p = PYRAMIDS[card.id];
  const black = card.id === 'black';
  const power = p.powerId;
  return (
    <View style={[styles.card, { width }]} accessible={false}>
      <Text style={type.label}>{p.site.label}</Text>
      <Text style={[type.title, black && styles.black]} numberOfLines={1} accessibilityRole="header">
        {p.name}
      </Text>
      <Text style={[styles.status, card.done && { color: colors.gold }]}>{card.status}</Text>

      {black ? (
        <View style={styles.door}>
          {door && <SealDoor collected={door.collected} unlock={door.unlock} filling={door.filling} time={door.time} />}
        </View>
      ) : (
        <View style={styles.artifact}>
          <ArtCanvas width={36} height={36} deps={[card.taken, power]} draw={(c) => drawEmblem(c, power ?? 'heart', 18, 18, 32, { lit: card.taken ? 0.6 : 0, dim: !card.taken })} />
          <View style={{ flex: 1 }}>
            <Text style={styles.artifactName}>{p.artifact}</Text>
            <Text style={type.caption}>{card.taken ? 'Taken ✓' : 'Kept in the basement'}</Text>
          </View>
        </View>
      )}

      {card.stars.stars > 0 && <Text style={type.caption}>{`Stars ${card.stars.stars} / ${card.stars.max}`}</Text>}
      {card.attuned && <Text style={[type.caption, { color: colors.gold }]}>{`Your ${POWER_INFO[card.attuned].name} is strongest here`}</Text>}
      {!black && power && !card.taken && <Text style={type.caption}>{`${POWER_INFO[power].verb}. Strongest in ${PYRAMIDS[POWERS[power].attuned as PyramidId].name}.`}</Text>}

      <View style={styles.actions}>
        {black && card.sealed ? (
          <Button variant="primary" label="The door" onPress={onDoor} accessibilityHint="Shows which artifacts are still missing" />
        ) : (
          <Button variant="primary" label="Enter" onPress={onEnter} />
        )}
        {card.camp !== null && !card.sealed && <Button label={`Continue · floor ${card.camp + 1}`} onPress={onContinue} />}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.xs },
  black: { color: '#cbc4dc' },
  status: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 14, marginBottom: space.xs },
  artifact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  artifactName: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 15 },
  door: { alignItems: 'center', paddingVertical: space.xs },
  actions: { gap: space.sm, marginTop: space.sm },
});
