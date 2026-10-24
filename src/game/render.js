import { TIERS, getTier } from './tiers.js';
import { WORLD } from './world.js';

const VISUAL_SIZE = 256;

// Each tier visual is drawn once to an offscreen canvas: a soft gradient in
// the tier color, with either the generated image or an emoji on top. The
// renderer only cares that each visual is something drawImage() accepts.
function tierCanvas(color) {
  const c = document.createElement('canvas');
  c.width = c.height = VISUAL_SIZE;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(
    VISUAL_SIZE * 0.4, VISUAL_SIZE * 0.35, VISUAL_SIZE * 0.05,
    VISUAL_SIZE / 2, VISUAL_SIZE / 2, VISUAL_SIZE / 2,
  );
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, VISUAL_SIZE, VISUAL_SIZE);
  return { c, g };
}

function placeholderVisual({ color, placeholder }) {
  const { c, g } = tierCanvas(color);
  g.font = `${VISUAL_SIZE * 0.62}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(placeholder, VISUAL_SIZE / 2, VISUAL_SIZE * 0.54);
  return c;
}

// Generated images are square with a plain white background, so they fill
// the whole visual; the circle clip and the tier-colored border frame them.
function imageVisual(image, { color }) {
  const { c, g } = tierCanvas(color);
  g.drawImage(image, 0, 0, VISUAL_SIZE, VISUAL_SIZE);
  return c;
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

  function borderStyle(tier, angle, time) {
    const t = getTier(tier);
    if (t.rainbow && ctx.createConicGradient) {
      const grad = ctx.createConicGradient(angle + time / 600, 0, 0);
      ['#ff4d4d', '#ffb347', '#fff04d', '#5dff7a', '#4dc3ff', '#b64dff', '#ff4d4d'].forEach((c, i, all) =>
        grad.addColorStop(i / (all.length - 1), c),
      );
      return grad;
    }
    return t.color;
  }

  function drawItem(visuals, tier, x, y, angle, time) {
    const { radius: r, rainbow, color } = getTier(tier);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    ctx.drawImage(visuals[tier - 1], -r, -r, r * 2, r * 2);
    ctx.restore();

    if (rainbow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 18 + 6 * Math.sin(time / 200);
    }
    ctx.lineWidth = Math.max(2.5, r * 0.09);
    ctx.strokeStyle = borderStyle(tier, angle, time);
    ctx.stroke();
    ctx.restore();
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

  function drawFunnel(body) {
    ctx.beginPath();
    body.vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();
    ctx.fillStyle = '#4a4266';
    ctx.fill();
  }

  // state: { bodies, visuals, effects, time }
  function draw(state) {
    const { time } = state;

    ctx.fillStyle = '#1e1a2b';
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (const body of state.bodies) {
      if (body.label === 'funnel') drawFunnel(body);
      else if (body.label === 'item') {
        drawItem(state.visuals, body.tier, body.position.x, body.position.y, body.angle, time);
      }
    }

    drawEffects(state.effects, time);
  }

  return { resize, draw };
}
