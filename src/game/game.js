import Matter from 'matter-js';
import { getTier, playbackRateFor, POP_BONUS, TIER_COUNT } from './tiers.js';
import { WORLD, createWorld, createItem } from './world.js';
import { setupMerging } from './merge.js';
import { createRenderer } from './render.js';
import { playBuffer } from '../audio/playback.js';

const { Engine, Composite } = Matter;

const STEP_MS = 1000 / 60; // fixed physics step, independent of display Hz
const SPAWN_INTERVAL_MS = 1200; // a new tier 1 drops in this often
const MAX_ITEMS = 80; // pause spawning if the box gets this full

// Runs the simulation: tier 1s rain in from the top on their own, fall
// through the funnel, and merge in the box. No input, no game over.
// `sound` is an AudioBuffer (or null to play silently); `visuals` is one
// drawable per tier.
export function createGame({ canvas, sound, visuals, onScore }) {
  const engine = createWorld();
  const renderer = createRenderer(canvas);

  const state = {
    score: 0,
    effects: [],
  };

  function addScore(points) {
    state.score += points;
    onScore(state.score);
  }

  function addEffect(x, y, tier, big = false) {
    const { radius, color } = getTier(tier);
    state.effects.push({ x, y, radius, color, big, start: performance.now(), duration: big ? 900 : 350 });
  }

  setupMerging(engine, {
    onMerge({ tier, x, y }) {
      addScore(getTier(tier).points);
      addEffect(x, y, tier);
      playBuffer(sound, { rate: playbackRateFor(tier), gain: 0.9 });
    },
    onPop({ x, y }) {
      addScore(POP_BONUS);
      addEffect(x, y, TIER_COUNT, true);
      playBuffer(sound, { rate: playbackRateFor(TIER_COUNT) * 0.8, gain: 1 });
    },
  });

  // Spawn just above the visible area at a random x, so items slide into
  // view rather than popping into existence.
  function spawn() {
    const items = Composite.allBodies(engine.world).filter((b) => b.label === 'item');
    if (items.length >= MAX_ITEMS) return;
    const r = getTier(1).radius;
    const x = r + Math.random() * (WORLD.width - r * 2);
    Composite.add(engine.world, createItem(1, x, -r));
  }

  // --- Loop: fixed-step physics with an accumulator, render every frame.
  // Spawning is counted in simulated time so it pauses with the physics
  // (e.g. when the tab is in the background).
  let rafId = 0;
  let last = performance.now();
  let acc = 0;
  let untilSpawn = 0;

  function frame(now) {
    acc += Math.min(now - last, 100); // clamp so a background tab doesn't explode
    last = now;
    while (acc >= STEP_MS) {
      untilSpawn -= STEP_MS;
      if (untilSpawn <= 0) {
        spawn();
        untilSpawn += SPAWN_INTERVAL_MS;
      }
      Engine.update(engine, STEP_MS);
      acc -= STEP_MS;
    }
    state.effects = state.effects.filter((fx) => now - fx.start < fx.duration);
    renderer.draw({
      bodies: Composite.allBodies(engine.world),
      visuals,
      effects: state.effects,
      time: now,
    });
    rafId = requestAnimationFrame(frame);
  }

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);
  renderer.resize();
  rafId = requestAnimationFrame(frame);
  onScore(0);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      Engine.clear(engine);
    },
  };
}
