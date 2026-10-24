// Draws a mono AudioBuffer as a min/max waveform filling the canvas.
export function drawWaveform(canvas, buffer, color = '#ffd700') {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // One vertical line per CSS pixel, spanning the min..max of the samples
  // that fall into that column.
  const data = buffer.getChannelData(0);
  const perPx = Math.max(1, Math.floor(data.length / w));
  const mid = h / 2;
  ctx.fillStyle = color;
  for (let x = 0; x < w; x++) {
    let min = 0;
    let max = 0;
    const from = x * perPx;
    for (let i = from; i < from + perPx && i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    ctx.fillRect(x, mid - max * mid, 1, Math.max(1, (max - min) * mid));
  }
}
