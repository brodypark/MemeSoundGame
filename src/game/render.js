import { TIERS, getTier } from './tiers.js';
import { WORLD, neckAngles } from './world.js';

const VISUAL_SIZE = 256; // the image/emoji itself
const GLOW_PAD = 36; // room around it for the baked-in glow
const PADDED_SIZE = VISUAL_SIZE + GLOW_PAD * 2;
// Items are drawn so the image (not the glow) spans the physics circle.
const DRAW_SCALE = PADDED_SIZE / VISUAL_SIZE;

const RAINBOW = ['#ff4d4d', '#ffb347', '#fff04d', '#5dff7a', '#4dc3ff', '#5b5bff', '#d14dff', '#ff4d4d'];

// Gemini images come back on a plain white background (there's no
// transparency option). Flood-fill from the edges and fade near-white
// pixels to transparent so the subject reads as a cutout. Only white that
// connects to the border is removed, so white fur or eyes inside the
// subject survive.
const CLEAR_BELOW = 18; // "whiteness distance" at or below this: fully transparent
const FEATHER_TO = 60; // up to this: partially transparent (soft edge)

function removeWhiteBackground(g, size) {
  let data;
  try {
    data = g.getImageData(0, 0, size, size);
  } catch {
    return; // tainted canvas or similar: keep the white background
  }
  const px = data.data;
  // 0 = pure white; grows as any channel gets darker.
  const distance = (p) => 255 - Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
  const seen = new Uint8Array(size * size);
  const stack = [];
  for (let i = 0; i < size; i++) {
    stack.push(i, (size - 1) * size + i, i * size, i * size + size - 1);
  }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const d = distance(p);
    if (d > FEATHER_TO) continue; // hit the subject: stop spreading here
    px[p * 4 + 3] = d <= CLEAR_BELOW ? 0 : Math.round((255 * (d - CLEAR_BELOW)) / (FEATHER_TO - CLEAR_BELOW));
    const x = p % size;
    if (x > 0) stack.push(p - 1);
    if (x < size - 1) stack.push(p + 1);
    if (p >= size) stack.push(p - size);
    if (p < size * (size - 1)) stack.push(p + size);
  }
  g.putImageData(data, 0, 0);
}

// Each tier visual is drawn once to an offscreen canvas: the cutout image
// (or emoji) with a soft warm glow around its silhouette. Baking the glow
// in here is much cheaper than shadowBlur on every item every frame.
function glowVisual(source, tier) {
  const c = document.createElement('canvas');
  c.width = c.height = PADDED_SIZE;
  const g = c.getContext('2d');
  g.shadowColor = tier === 6 ? '#ffd700' : '#ffcf99';
  g.shadowBlur = tier === 6 ? 34 : 22;
  g.drawImage(source, GLOW_PAD, GLOW_PAD, VISUAL_SIZE, VISUAL_SIZE);
  return c;
}

function placeholderVisual({ tier, placeholder }) {
  const c = document.createElement('canvas');
  c.width = c.height = VISUAL_SIZE;
  const g = c.getContext('2d');
  g.font = `${VISUAL_SIZE * 0.8}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(placeholder, VISUAL_SIZE / 2, VISUAL_SIZE * 0.54);
  return glowVisual(c, tier);
}

function imageVisual(image, { tier }) {
  const c = document.createElement('canvas');
  c.width = c.height = VISUAL_SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, VISUAL_SIZE, VISUAL_SIZE);
  removeWhiteBackground(g, VISUAL_SIZE);
  return glowVisual(c, tier);
}

export function createPlaceholderVisuals() {
  return TIERS.map(placeholderVisual);
}

// The visual for one tier: the generated image, or the placeholder when
// `image` is null (not generated yet, or generation failed).
export function createTierVisual(tier, image) {
  return image ? imageVisual(image, getTier(tier)) : placeholderVisual(getTier(tier));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // Fit the world into the canvas's parent while keeping its aspect ratio,
  // and render at devicePixelRatio so it stays sharp on phones.
  function resize() {
    const parent = canvas.parentElement;
    const css = getComputedStyle(parent);
    const availW = parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const availH = parent.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    const scale = Math.min(availW / WORLD.width, availH / WORLD.height);
    const cssW = Math.floor(WORLD.width * scale);
    const cssH = Math.floor(WORLD.height * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  // Items are drawn upright (ignoring the body's spin) so faces stay
  // readable, like stickers bouncing around.
  function drawItem(visuals, tier, x, y) {
    const size = getTier(tier).radius * 2 * DRAW_SCALE;
    ctx.drawImage(visuals[tier - 1], x - size / 2, y - size / 2, size, size);
  }

  function drawEffects(effects, time) {
    for (const fx of effects) {
      const p = (time - fx.start) / fx.duration; // 0 -> 1
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = fx.big ? 8 : 4;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * (1 + p * (fx.big ? 2.5 : 0.6)), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The flask outline: up the left of the tube, round the bulb the long
  // way, back up the right. Stroked just outside the physics walls' inner
  // edge with a slowly rotating rainbow and a neon glow.
  function drawFlask(time) {
    const { centerX: cx, neckWidth: N, neckBottomY, bulbCenterY: cy, bulbRadius: R } = WORLD;
    const line = 4;
    const half = N / 2 + line / 2;
    const { left, right } = neckAngles();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - half, 0);
    ctx.lineTo(cx - half, neckBottomY);
    ctx.arc(cx, cy, R + line / 2, left, right, true);
    ctx.lineTo(cx + half, 0);

    let stroke = '#ffffff';
    if (ctx.createConicGradient) {
      stroke = ctx.createConicGradient(time / 4000, cx, cy);
      RAINBOW.forEach((c, i) => stroke.addColorStop(i / (RAINBOW.length - 1), c));
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = line;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }

  // state: { bodies, visuals, effects, time }
  function draw(state) {
    const { time } = state;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (const body of state.bodies) {
      if (body.label === 'item') drawItem(state.visuals, body.tier, body.position.x, body.position.y);
    }

    drawFlask(time);
    drawEffects(state.effects, time);
  }

  return { resize, draw };
}
