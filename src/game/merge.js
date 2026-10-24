import Matter from 'matter-js';
import { TIER_COUNT, getTier } from './tiers.js';
import { WORLD, createItem } from './world.js';

const { Events, Composite, Body } = Matter;

// Watches collisions and merges same-tier pairs.
//
// Edge cases handled:
// - One body touching two same-tier bodies in the same step: the first pair
//   wins and both bodies are flagged `merging`, so the other pair is ignored.
// - Bodies can't be removed mid-step (Matter is still iterating pairs), so
//   merges are queued during collision events and applied in `afterUpdate`.
// - A freshly merged body may already overlap another body of its new tier.
//   That shows up as a new pair, so it chains on the next step.
// - Merges in the tube only happen when the result fits through it.
// - Tier 6 + tier 6 can't go higher, so both pop instead.
// Leaves some slack so a merged item doesn't wedge between the tube walls.
function fitsTube(tier) {
  return tier <= TIER_COUNT && getTier(tier).radius * 2 <= WORLD.neckWidth - 12;
}

export function setupMerging(engine, { onMerge, onPop }) {
  let queue = [];

  function collect(event) {
    for (const { bodyA: a, bodyB: b } of event.pairs) {
      if (a.label !== 'item' || b.label !== 'item') continue;
      if (a.tier !== b.tier || a.merging || b.merging) continue;
      // In the tube, only merge if the result still fits through it, or a
      // big merged item would jam it. Small merges up there keep the tube
      // from backing up when the bulb is busy.
      const inTube = a.position.y < WORLD.neckBottomY || b.position.y < WORLD.neckBottomY;
      if (inTube && !fitsTube(a.tier + 1)) continue;
      a.merging = true;
      b.merging = true;
      queue.push([a, b]);
    }
  }

  Events.on(engine, 'collisionStart', collect);

  Events.on(engine, 'afterUpdate', () => {
    if (queue.length === 0) return;
    const pending = queue;
    queue = [];

    for (const [a, b] of pending) {
      Composite.remove(engine.world, [a, b]);
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;

      if (a.tier >= TIER_COUNT) {
        onPop({ x, y });
        continue;
      }

      const merged = createItem(a.tier + 1, x, y);
      // Keep a bit of the momentum so merges don't feel dead.
      Body.setVelocity(merged, {
        x: (a.velocity.x + b.velocity.x) / 4,
        y: (a.velocity.y + b.velocity.y) / 4,
      });
      Composite.add(engine.world, merged);
      onMerge({ tier: merged.tier, x, y });
    }
  });
}
