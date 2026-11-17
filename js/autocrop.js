// Pure crop-geometry: auto-crop derivation + transform mapping. No DOM.
//
// Crop rect lives in working-image pixel coordinates and is aspect-locked to
// the output size (630x810). The render transform is a uniform scale+translate:
//   out = src * s + t
// so landmarks map to output space with mapGeometry().

import { CONFIG } from './config.js';
import { mapGeometry } from './faceGeometry.js';

const OUT = () => CONFIG.output;

// Derive the crop rect that places the head at ICAO geometry targets.
export function computeAutoCrop(geom, baseW, baseH, cfg = CONFIG) {
  const { width: outW, height: outH } = cfg.output;
  const ac = cfg.autoCrop;

  if (!geom || !geom.ok) {
    // No face: fill height, center horizontally.
    const h = baseH;
    const w = Math.min(baseW, h * outW / outH);
    const x = (baseW - w) / 2;
    const y = 0;
    return {
      crop: { x, y, w, h },
      s: outH / h,
      flags: { noFace: true, upscaled: outH / h > 1, clampedX: false, clampedY: false },
      transform: transformFor({ x, y, w, h }, outW, outH),
    };
  }

  const targetHeadH = ac.headHeightFrac * outH;
  const s = targetHeadH / geom.headH;

  let w = outW / s;
  let h = outH / s;

  // eye line target from top edge
  const eyeFracFromTop = 1 - ac.eyeLineFromBottom;
  let x0 = geom.eyeMid.x - w / 2;
  let y0 = geom.eyeMid.y - h * eyeFracFromTop;

  // clamp inside the image
  let clampedX = false, clampedY = false;
  if (x0 < 0) { x0 = 0; clampedX = true; }
  if (y0 < 0) { y0 = 0; clampedY = true; }
  if (x0 + w > baseW) { x0 = baseW - w; clampedX = true; }
  if (y0 + h > baseH) { y0 = baseH - h; clampedY = true; }

  // crop larger than the image: shrink to fit (upscaled output)
  let upscaled = false;
  if (w > baseW || h > baseH) {
    const shrink = Math.min(baseW / w, baseH / h);
    w *= shrink; h *= shrink;
    s *= shrink;
    upscaled = true;
  }

  const crop = { x: x0, y: y0, w, h };
  return {
    crop,
    s,
    flags: { noFace: false, clampedX, clampedY, upscaled },
    transform: transformFor(crop, outW, outH),
  };
}

export function transformFor(crop, outW, outH) {
  const s = outW / crop.w;
  return { s, tx: -crop.x * s, ty: -crop.y * s };
}

export function mapPoint(t, p) {
  return { x: p.x * t.s + t.tx, y: p.y * t.s + t.ty };
}

export function mapGeometryOut(geom, t) {
  return mapGeometry(geom, t);
}

// Check that the head keeps a minimum margin from the frame edges.
export function headMargins(geomOut, outW, outH, cfg = CONFIG) {
  if (!geomOut || !geomOut.ok) return { crown: null, chin: null, left: null, right: null, ok: null };
  const min = cfg.autoCrop.minMarginPx;
  const left = geomOut.faceCenter.x - geomOut.faceW / 2;
  const right = outW - (geomOut.faceCenter.x + geomOut.faceW / 2);
  const crown = geomOut.crown.y;
  const chin = outH - geomOut.chin.y;
  const ok = crown >= min * 0.5 && chin >= min && left >= -geomOut.faceW * 0.05 && right >= -geomOut.faceW * 0.05;
  return { crown, chin, left, right, ok };
}
