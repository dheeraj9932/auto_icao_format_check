// Interactive crop box: pointer events for move + corner resize.
// Browser only. Crop rect is aspect-locked to 630:810.

import { CONFIG } from './config.js';
import { state } from './state.js';
import { handleAt, insideCrop, drawPreview } from './renderer.js';

const ASPECT = CONFIG.output.width / CONFIG.output.height; // 7:9
const MIN_W = 40;

export function initCropper(canvas, onChange) {
  let view = null;
  let drag = null; // {mode:'move'|'resize', handle?, startCrop, startX, startY}

  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.crop) return;
    if (!view) view = drawPreview(canvas);
    canvas.setPointerCapture(e.pointerId);
    const { sx, sy } = toCanvas(e);
    const h = handleAt(sx, sy, view);
    if (h) {
      drag = { mode: 'resize', handle: h, startCrop: { ...state.crop }, sx, sy };
    } else if (insideCrop(sx, sy, view)) {
      drag = { mode: 'move', startCrop: { ...state.crop }, sx, sy };
    }
    if (drag) {
      canvas.style.cursor = drag.mode === 'move' ? 'grabbing' : 'nwse-resize';
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const { sx, sy } = toCanvas(e);
    if (!drag) {
      const h = handleAt(sx, sy, view);
      canvas.style.cursor = h ? 'nwse-resize' : (insideCrop(sx, sy, view) ? 'grab' : 'default');
      if (h !== cursorHandle) { cursorHandle = h; requestPreview(); }
      return;
    }
    const dxSrc = (sx - drag.sx) / view.scale;
    const dySrc = (sy - drag.sy) / view.scale;
    if (drag.mode === 'move') {
      const c = drag.startCrop;
      state.crop = {
        ...c,
        x: clamp(c.x + dxSrc, 0, state.baseW - c.w),
        y: clamp(c.y + dySrc, 0, state.baseH - c.h),
      };
    } else {
      state.crop = resize(drag.handle, drag.startCrop, dxSrc, dySrc);
    }
    state.transform = transformFromCrop(state.crop);
    requestPreview();
    e.preventDefault();
  });

  let cursorHandle = null;
  function requestPreview() {
    if (!pending) {
      pending = requestAnimationFrame(() => {
        pending = 0;
        view = drawPreview(canvas);
        if (onChange) onChange(false); // false = not final (skip heavy rescore)
      });
    }
  }
  let pending = 0;

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    canvas.releasePointerCapture(e.pointerId);
    drag = null;
    canvas.style.cursor = 'default';
    if (onChange) onChange(true); // final: trigger full rescore
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  // expose current view so main.js can redraw with the same mapping
  return {
    getView: () => view,
    setView: (v) => { view = v; },
  };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Corner resize with locked aspect. Anchor = opposite corner.
function resize(handle, c, dx, dy) {
  const anchor =
    handle === 'nw' ? { x: c.x + c.w, y: c.y + c.h } :
    handle === 'ne' ? { x: c.x, y: c.y + c.h } :
    handle === 'sw' ? { x: c.x + c.w, y: c.y } :
    { x: c.x, y: c.y }; // se

  const signX = handle.includes('w') ? -1 : 1;
  const signY = handle.includes('n') ? -1 : 1;

  // choose driven axis by dominant pointer movement
  let w = signX * dx;
  const hFromW = w / ASPECT;
  let h = hFromW;

  // clamp w so the rect stays inside the image and above min size
  const maxW = signX > 0 ? state.baseW - anchor.x : anchor.x;
  const maxH = signY > 0 ? state.baseH - anchor.y : anchor.y;
  w = clamp(w, MIN_W, Math.min(maxW, maxH * ASPECT));
  h = w / ASPECT;

  const x = signX > 0 ? anchor.x : anchor.x - w;
  const y = signY > 0 ? anchor.y : anchor.y - h;
  return { x, y, w, h };
}

export function transformFromCrop(crop) {
  return { s: CONFIG.output.width / crop.w, tx: -crop.x * (CONFIG.output.width / crop.w), ty: -crop.y * (CONFIG.output.width / crop.w) };
}
