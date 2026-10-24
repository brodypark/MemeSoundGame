import Matter from 'matter-js';
import { getTier } from './tiers.js';

const { Engine, Bodies, Composite } = Matter;

// Logical world size in game units. The renderer scales this to the screen,
// so physics behaves the same on every device.
//
// Layout: items are dropped above a funnel, slide down through its neck, and
// pile up in the big box below. The funnel's slopes double as the box's roof.
export const WORLD = {
  width: 440,
  height: 720,
  wallThickness: 80,
  gravity: 0.1, // Matter's default is 1; lower = floatier
  funnelTopY: 80, // where the funnel slopes meet the side walls
  funnelBottomY: 280, // the neck; items only merge below this line
  funnelNeck: 90, // gap at the bottom of the funnel (fits a tier 3 easily)
  funnelThickness: 12,
};

// A static bar from (x1, y1) to (x2, y2). Matter rectangles are defined by
// center + size, so convert the segment to midpoint, length and angle.
function bar(x1, y1, x2, y2, thickness, options) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, length, thickness, {
    ...options,
    angle: Math.atan2(y2 - y1, x2 - x1),
  });
}

export function createWorld() {
  const engine = Engine.create();
  engine.gravity.y = WORLD.gravity;
  // Extra solver iterations keep tall stacks of circles from jittering.
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const { width: W, height: H, wallThickness: T } = WORLD;
  // Matter uses the higher restitution of the two bodies in a collision.
  // Walls and floor are near-perfect springs; 1 would never lose energy.
  const wall = { isStatic: true, friction: 0.2, restitution: 0.95, label: 'wall' };
  // Funnel is slippery so items slide down instead of parking on the slopes.
  const funnel = { isStatic: true, friction: 0, label: 'funnel' };
  const neckLeft = (W - WORLD.funnelNeck) / 2;
  const neckRight = (W + WORLD.funnelNeck) / 2;
  // Start the slopes slightly inside the side walls so there's no gap.
  const overlap = 20;

  Composite.add(engine.world, [
    // Side walls extend well above the top so nothing can escape sideways.
    Bodies.rectangle(-T / 2, H / 2 - H, T, H * 3, wall),
    Bodies.rectangle(W + T / 2, H / 2 - H, T, H * 3, wall),
    Bodies.rectangle(W / 2, H + T / 2, W + T * 2, T, wall),
    bar(-overlap, WORLD.funnelTopY - overlap, neckLeft, WORLD.funnelBottomY, WORLD.funnelThickness, funnel),
    bar(W + overlap, WORLD.funnelTopY - overlap, neckRight, WORLD.funnelBottomY, WORLD.funnelThickness, funnel),
  ]);

  return engine;
}

export function createItem(tier, x, y) {
  const body = Bodies.circle(x, y, getTier(tier).radius, {
    label: 'item',
    restitution: 0.9, // springy: items keep most of their speed on every bounce
    friction: 0.05,
    frictionAir: 0.0005, // low drag, or slow floaty falls lose all their bounce
    density: 0.001,
  });
  body.tier = tier;
  body.merging = false; // set once a merge is queued so it can't merge twice
  return body;
}
