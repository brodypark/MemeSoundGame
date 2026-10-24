import Matter from 'matter-js';
import { getTier } from './tiers.js';

const { Engine, Bodies, Body, Composite, Events } = Matter;

// Logical world size in game units. The renderer scales this to the screen,
// so physics behaves the same on every device.
//
// Layout: a flask. Items drop into a narrow tube at the top, fall through it
// single file, and bounce around in the round bulb below. The bulb is wide
// and the tube short so the big items have room; on landscape screens the
// height limits the scale, so the extra width is free.
const width = 600;
const neckWidth = 150; // a bit under two tier 1s, so they queue single file
const bulbCenterY = 468;
const bulbRadius = 280;

export const WORLD = {
  width,
  height: 760,
  gravity: 0.1, // Matter's default is 1; lower = floatier
  // Thick walls: big items can squeeze small ones through thin ones. Only
  // the inner edge matters; the outline is drawn separately.
  wallThickness: 60,
  centerX: width / 2,
  neckWidth,
  bulbCenterY,
  bulbRadius,
  // Where the tube's walls meet the bulb's circle. Items only merge below
  // this line, so a big merged item can never jam the tube.
  neckBottomY: bulbCenterY - Math.sqrt(bulbRadius ** 2 - (neckWidth / 2) ** 2),
};

// Angles (canvas convention: y down, clockwise) where the tube walls meet
// the bulb. The bulb wall runs the long way round from left to right.
export function neckAngles() {
  const dy = WORLD.neckBottomY - WORLD.bulbCenterY;
  return {
    left: Math.atan2(dy, -WORLD.neckWidth / 2),
    right: Math.atan2(dy, WORLD.neckWidth / 2),
  };
}

// The bulb wall as a ring of short static bars. Matter has no concave
// bodies, so a circle wall has to be approximated by segments. Each bar's
// inner edge sits on the circle; bars are slightly overlong so the joints
// leave no gaps for small items to slip through.
function bulbWall(options) {
  const { centerX: cx, bulbCenterY: cy, bulbRadius: R, wallThickness: T } = WORLD;
  const { left, right } = neckAngles();
  const sweep = 2 * Math.PI - (right - left); // everything except the neck opening
  const segments = 72;
  const step = sweep / segments;
  const mid = R + T / 2;
  const bars = [];
  for (let i = 0; i < segments; i++) {
    // Walk anticlockwise from the left join, down and around to the right.
    const a = left - step * (i + 0.5);
    const length = 2 * mid * Math.sin(step / 2) + 2;
    bars.push(
      Bodies.rectangle(cx + mid * Math.cos(a), cy + mid * Math.sin(a), length, T, {
        ...options,
        angle: a + Math.PI / 2,
      }),
    );
  }
  return bars;
}

export function createWorld() {
  const engine = Engine.create();
  engine.gravity.y = WORLD.gravity;
  // Extra solver iterations keep tall stacks of circles from jittering.
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  const { centerX: cx, neckWidth: N, neckBottomY, wallThickness: T, height: H } = WORLD;
  // Matter uses the higher restitution of the two bodies in a collision.
  // Walls are near-perfect springs; 1 would never lose energy.
  const wall = { isStatic: true, friction: 0.2, restitution: 0.95, label: 'wall' };
  // Tube walls run from the bulb to well above the top, so items that
  // bounce back up the tube can't escape.
  const tubeTop = -H * 2;
  const tubeHeight = neckBottomY - tubeTop;
  const tube = { ...wall, friction: 0 }; // slippery so nothing parks in the tube

  Composite.add(engine.world, [
    Bodies.rectangle(cx - N / 2 - T / 2, tubeTop + tubeHeight / 2, T, tubeHeight, tube),
    Bodies.rectangle(cx + N / 2 + T / 2, tubeTop + tubeHeight / 2, T, tubeHeight, tube),
    ...bulbWall(wall),
  ]);

  Events.on(engine, 'afterUpdate', () => containItems(engine));
  return engine;
}

// Safety net. When a merge or a spawn lands on top of a crowd, Matter's
// overlap correction can shove small neighbours through the walls. Anything
// more than half its radius into a wall is put back on the inside, and its
// outward velocity is dropped.
function containItems(engine) {
  const { centerX: cx, bulbCenterY: cy, bulbRadius: R, neckBottomY, neckWidth: N } = WORLD;
  for (const body of Composite.allBodies(engine.world)) {
    if (body.label !== 'item') continue;
    const r = getTier(body.tier).radius;
    if (body.position.y < neckBottomY) {
      // In the tube: keep x between the tube walls.
      const limit = N / 2 - r * 0.5;
      const dx = body.position.x - cx;
      if (Math.abs(dx) > limit) {
        Body.setPosition(body, { x: cx + Math.sign(dx) * Math.max(0, N / 2 - r), y: body.position.y });
        Body.setVelocity(body, { x: 0, y: body.velocity.y });
      }
      continue;
    }
    const dx = body.position.x - cx;
    const dy = body.position.y - cy;
    // Just below the tube, an item coming down is still in the bulb's
    // opening, not in a wall, even though it's outside the circle. Without
    // this it got snapped ~36 units down mid-fall (a visible stutter).
    if (dy < 0 && 2 * r < N && Math.abs(dx) <= N / 2 - r * 0.5) continue;
    const d = Math.hypot(dx, dy);
    if (d <= R - r * 0.5) continue;
    const nx = dx / d;
    const ny = dy / d;
    Body.setPosition(body, { x: cx + nx * (R - r), y: cy + ny * (R - r) });
    const outward = body.velocity.x * nx + body.velocity.y * ny;
    if (outward > 0) {
      Body.setVelocity(body, { x: body.velocity.x - outward * nx, y: body.velocity.y - outward * ny });
    }
  }
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
