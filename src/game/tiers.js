// All tier tuning lives here: size, pitch, border color, placeholder, points.
//
// Sizes grow ~1.4x per tier. Pitch drops 4 semitones per tier, so tier 6 is
// 20 semitones (~1.7 octaves) below the original sound: the sigma rumble.

export const TIER_COUNT = 6;

export const TIERS = [
  { tier: 1, radius: 15, semitonesDown: 0, color: '#ff9ecf', placeholder: '🐣', points: 0 },
  { tier: 2, radius: 21, semitonesDown: 4, color: '#7fd4ff', placeholder: '🐥', points: 4 },
  { tier: 3, radius: 29, semitonesDown: 8, color: '#7dffa8', placeholder: '🐤', points: 10 },
  { tier: 4, radius: 41, semitonesDown: 12, color: '#b98cff', placeholder: '🐔', points: 25 },
  { tier: 5, radius: 58, semitonesDown: 16, color: '#ffd700', placeholder: '🦅', points: 60 },
  // Tier 6 border is drawn as an animated rainbow; `color` is the fallback.
  { tier: 6, radius: 81, semitonesDown: 20, color: '#ffd700', placeholder: '🐉', points: 150, rainbow: true },
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
