/**
 * Haptic patterns and the sequencer (plan 05, section 14): pure TypeScript, no device calls, so
 * scripts/check-sounds.ts can test it. A pattern is a list of pulses [ms offset, style]; a sequencer plays
 * them on a clock it is given, so a pause freezes a pattern in the middle. Budget ERM motors blur pulses
 * closer than ~50 ms, so the sequencer spaces them out, keeps at most 6 queued (dropping the least
 * important) and never stacks the heartbeat.
 */
export type HapticStyle = 'selection' | 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' | 'success' | 'warning' | 'error';
type Pulse = readonly [number, HapticStyle];
type Pattern = { pulses: readonly Pulse[]; priority: number };

const P = (priority: number, ...pulses: Pulse[]): Pattern => ({ pulses, priority });

/** the decaying door grind: a pulse every 150 ms for 1.5 s, medium -> light -> soft */
const GRIND: Pulse[] = Array.from({ length: 10 }, (_, k): Pulse => [k * 150, k < 3 ? 'medium' : k < 6 ? 'light' : 'soft']);

export const PATTERNS = {
  tap: P(1, [0, 'selection']),
  stepSand: P(0, [0, 'soft']),
  pickup: P(2, [0, 'light']),
  refill: P(2, [0, 'soft'], [90, 'light']),
  ignite: P(2, [0, 'soft']),
  plate: P(4, [0, 'rigid']),
  block: P(6, [0, 'heavy'], [70, 'rigid'], [180, 'light']),
  portcullis: P(6, [0, 'rigid'], [380, 'heavy']),
  sandfall: P(5, [0, 'light'], [200, 'soft'], [420, 'soft']),
  trapdoor: P(6, [0, 'medium']),
  land: P(6, [0, 'heavy']),
  quake: P(7, [0, 'heavy'], [90, 'medium'], [200, 'medium'], [330, 'light'], [500, 'light'], [700, 'soft']),
  heartbeat: P(3, [0, 'medium'], [140, 'light']),
  wake: P(6, [0, 'heavy'], [160, 'medium'], [400, 'soft']),
  spotted: P(7, [0, 'heavy'], [120, 'heavy']),
  touch: P(7, [0, 'error']),
  caught: P(8, [0, 'heavy'], [180, 'medium'], [380, 'light']),
  lowLight: P(3, [0, 'soft'], [260, 'soft']),
  artifact: P(7, [0, 'success'], [300, 'medium'], [450, 'light'], [600, 'light']),
  grind: P(5, ...GRIND),
  knock: P(3, [0, 'light']),
  break: P(5, [0, 'heavy'], [120, 'medium']),
  found: P(4, [0, 'success']),
  star: P(4, [0, 'light']),
  wall: P(1, [0, 'light']),
} as const satisfies Record<string, Pattern>;

export type HapticName = keyof typeof PATTERNS;

const MIN_GAP_MS = 50;
const MAX_QUEUE = 6;
/** heartbeat period in seconds: 1.1 at 8 path steps down to 0.6 at 2 */
export const heartbeatPeriod = (steps: number) => 0.6 + (Math.max(2, Math.min(8, steps)) - 2) * (0.5 / 6);

export type HapticSequencer = {
  /** queue a pattern; its pulses start now */
  play: (name: HapticName) => void;
  /** advance the clock by `dt` seconds and fire what is due */
  tick: (dt: number) => void;
  /** a heartbeat every `period` seconds (never stacks), or null to stop */
  heartbeat: (period: number | null) => void;
  clear: () => void;
  /** pulses waiting (tests) */
  pending: () => number;
};

/** A sequencer on the clock its owner ticks. `out` is where pulses go (the device by default). */
export function createHapticSequencer(out: (style: HapticStyle) => void): HapticSequencer {
  type Queued = { at: number; style: HapticStyle; priority: number };
  let queue: Queued[] = [];
  let now = 0;
  let lastFire = -1e9;
  let beat: number | null = null;
  let nextBeat = 0;
  const push = (name: HapticName) => {
    const pat = PATTERNS[name];
    for (const [ms, style] of pat.pulses) queue.push({ at: now + ms / 1000, style, priority: pat.priority });
    // keep the most important ones when too many wait
    if (queue.length > MAX_QUEUE) {
      queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
      queue = queue.slice(0, MAX_QUEUE).sort((a, b) => a.at - b.at);
    }
  };
  return {
    play: push,
    heartbeat(period) {
      if (period === null) {
        beat = null;
        return;
      }
      if (beat === null) nextBeat = now;
      beat = period;
    },
    tick(dt) {
      now += dt;
      if (beat !== null && now >= nextBeat) {
        // one heartbeat at a time: skip while its own pulses are still waiting
        if (!queue.some((q) => q.priority === PATTERNS.heartbeat.priority && q.at > now - 0.01)) push('heartbeat');
        nextBeat = now + beat;
      }
      if (!queue.length) return;
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= now) {
        if (now - lastFire < MIN_GAP_MS / 1000) {
          // too soon after the last pulse: push this one (and so the rest) back
          queue[0].at = lastFire + MIN_GAP_MS / 1000;
          break;
        }
        const q = queue.shift()!;
        lastFire = now;
        out(q.style);
      }
    },
    clear() {
      queue = [];
      beat = null;
    },
    pending: () => queue.length,
  };
}

