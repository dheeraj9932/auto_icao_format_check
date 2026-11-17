// Rendering: preview canvas (interactive) + output canvas (630x810).
// Browser only.

import { CONFIG } from './config.js';
import { state, geomSrc } from './state.js';

const OUT = CONFIG.output;

export function drawPreview(canvas, hitInfo = null) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!state.baseBitmap) return null;

  // fit base into canvas
  const scale = Math.min(cssW / state.baseW, cssH / state.baseH);
  const dw = state.baseW * scale, dh = state.baseH * scale;
  const ox = (cssW - dw) / 2, oy = (cssH - dh) / 2;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(state.baseBitmap, 0, 0);

  const crop = state.crop;
  if (crop) {
    // dim outside the crop rect
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, state.baseW, crop.y);
    ctx.fillRect(0, crop.y, crop.x, crop.h);
    ctx.fillRect(crop.x + crop.w, crop.y, state.baseW - crop.x - crop.w, crop.h);
    ctx.fillRect(0, crop.y + crop.h, state.baseW, state.baseH - crop.y - crop.h);

    // undimmed crop region
    ctx.save();
    ctx.beginPath();
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.clip();
    ctx.drawImage(state.baseBitmap, 0, 0);
    ctx.restore();

    // border
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

    if (state.overlays.guides) {
      drawGuides(ctx, crop, scale);
    }
  }

  if (state.overlays.landmarks) drawLandmarks(ctx, scale);

  ctx.restore();

  // screen-space handles on top (not affected by image transform)
  if (crop) drawHandles(ctx, { ox, oy, scale }, hitInfo);

  return { ox, oy, scale }; // view transform for pointer mapping
}

function drawGuides(ctx, crop, scale) {
  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([6 / scale, 6 / scale]);

  // thirds
  for (let i = 1; i <= 2; i++) {
    const x = crop.x + (crop.w * i) / 3;
    ctx.beginPath(); ctx.moveTo(x, crop.y); ctx.lineTo(x, crop.y + crop.h); ctx.stroke();
    const y = crop.y + (crop.h * i) / 3;
    ctx.beginPath(); ctx.moveTo(crop.x, y); ctx.lineTo(crop.x + crop.w, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // eye-line target zone: 40-50% from top of the crop (= 50-60% from bottom)
  const zTop = crop.y + crop.h * 0.40;
  const zBot = crop.y + crop.h * 0.50;
  ctx.fillStyle = 'rgba(34,197,94,0.12)';
  ctx.fillRect(crop.x, zTop, crop.w, zBot - zTop);
  ctx.strokeStyle = 'rgba(34,197,94,0.8)';
  ctx.beginPath();
  ctx.moveTo(crop.x, (zTop + zBot) / 2);
  ctx.lineTo(crop.x + crop.w, (zTop + zBot) / 2);
  ctx.stroke();
  ctx.restore();
}

function drawLandmarks(ctx, scale) {
  const g = geomSrc();
  const f = state.faces[state.faceIndex];
  if (!g || !g.ok || !f) return;
  ctx.save();
  ctx.fillStyle = 'rgba(56,189,248,0.9)';
  const r = 1.6 / scale;
  for (const p of f.landmarks) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(244,63,94,0.95)';
  for (const p of [g.eyeA, g.eyeB, g.chin, g.crown, g.nose]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const HANDLE_R = 7; // screen px

function drawHandles(ctx, view, hitInfo) {
  const crop = state.crop;
  if (!crop) return;
  const pts = handlePoints(crop, view);
  ctx.save();
  for (const h of pts) {
    ctx.beginPath();
    ctx.arc(h.sx, h.sy, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = h.hit === (hitInfo?.handle) ? '#fbbf24' : '#ffffff';
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function handlePoints(crop, view) {
  const S = (x, y) => ({ sx: view.ox + x * view.scale, sy: view.oy + y * view.scale, x, y });
  return [
    { id: 'nw', ...S(crop.x, crop.y) },
    { id: 'ne', ...S(crop.x + crop.w, crop.y) },
    { id: 'sw', ...S(crop.x, crop.y + crop.h) },
    { id: 'se', ...S(crop.x + crop.w, crop.y + crop.h) },
  ];
}

export function handleAt(sx, sy, view) {
  if (!state.crop) return null;
  for (const h of handlePoints(state.crop, view)) {
    if (Math.hypot(sx - h.sx, sy - h.sy) <= HANDLE_R + 4) return h.id;
  }
  return null;
}

export function insideCrop(sx, sy, view) {
  if (!state.crop) return false;
  const x = (sx - view.ox) / view.scale;
  const y = (sy - view.oy) / view.scale;
  const c = state.crop;
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}

// Render the final 630x810 output from the current crop.
export function renderOutput(outCanvas) {
  outCanvas.width = OUT.width;
  outCanvas.height = OUT.height;
  const ctx = outCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, OUT.width, OUT.height);
  if (!state.baseBitmap || !state.crop) return;

  const t = state.transform;
  ctx.setTransform(t.s, 0, 0, t.s, t.tx, t.ty);
  ctx.drawImage(state.baseBitmap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
