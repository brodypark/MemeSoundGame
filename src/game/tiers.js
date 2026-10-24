// All tier tuning lives here: size, pitch, effect color, placeholder, points.
//
// Tier 1 is big and sizes grow only ~1.13x per tier, so the bulb doesn't
// clog up with high tiers (one of each tier should cover about a third of
// the bulb's area at most) and two tier 6s still fit side by side.
//
// Pitch drops 4 semitones per tier. Merges play the new tier's pitch, so
// the first sound you hear is tier 2 at the original pitch; tier 1 sits one
// step above it (negative = higher). Tier 6 is 16 semitones (1 1/3 octaves)
// below the original: the sigma rumble.

export const TIER_COUNT = 6;

export const TIERS = [
  { tier: 1, radius: 45, semitonesDown: -4, color: '#ff9ecf', placeholder: '🐣', points: 0 },
  { tier: 2, radius: 51, semitonesDown: 0, color: '#7fd4ff', placeholder: '🐥', points: 4 },
  { tier: 3, radius: 58, semitonesDown: 4, color: '#7dffa8', placeholder: '🐤', points: 10 },
  { tier: 4, radius: 66, semitonesDown: 8, color: '#b98cff', placeholder: '🐔', points: 25 },
  { tier: 5, radius: 75, semitonesDown: 12, color: '#ffd700', placeholder: '🦅', points: 60 },
  { tier: 6, radius: 85, semitonesDown: 16, color: '#ffd700', placeholder: '🐉', points: 150 },
];

// Bonus for two tier 6s touching: they pop instead of merging.
export const POP_BONUS = 500;

export function getTier(tier) {
  return TIERS[tier - 1];
}

// Semitones -> playback rate: each semitone is a factor of 2^(1/12),
// so dropping N semitones means rate = 2^(-N/12).
export function playbackRateFor(tier) {
  return 2 ** (-getTier(tier).semitonesDown / 12);
}
