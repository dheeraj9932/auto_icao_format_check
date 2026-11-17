// Pure pixel math over ImageData-like objects ({data, width, height}).
// No DOM, node-testable. All fraction outputs are 0..1 unless noted.

const OVER = 250, UNDER = 15; // exposure clip levels (also in CONFIG)

export function toLuma(img) {
  const { data, width, height } = img;
  const n = width * height;
  const luma = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    luma[i] = (data[p] * 77 + data[p + 1] * 151 + data[p + 2] * 28) >> 8;
  }
  return luma;
}

// Stats over masked pixels (mask null = all). Values in 0..255 space.
export function lumaStats(img, mask = null) {
  const luma = toLuma(img);
  const hist = new Uint32Array(256);
  let count = 0, sum = 0, sumSq = 0;
  const n = luma.length;
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    const v = luma[i];
    hist[v]++; count++; sum += v; sumSq += v * v;
  }
  if (!count) return { count: 0, mean: 0, std: 0, p5: 0, p95: 0, overPct: 0, underPct: 0 };
  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  let acc = 0, p5 = 0, p95 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= count * 0.05) { p5 = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= count * 0.05) { p95 = v; break; } }
  let over = 0, under = 0;
  for (let v = OVER; v < 256; v++) over += hist[v];
  for (let v = 0; v <= UNDER; v++) under += hist[v];
  return { count, mean, std, p5, p95, overPct: over / count, underPct: under / count };
}

// Mean HSL saturation (0..1) and fraction of pixels with real chroma.
export function saturationStats(img, mask = null) {
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, satSum = 0, chroma = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (mask && !mask[i]) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    count++;
    const sat = max === 0 ? 0 : (max - min) / max;
    satSum += sat;
    if (max - min > 12) chroma++;
  }
  if (!count) return { count: 0, meanSat: 0, chromaFrac: 0 };
  return { count, meanSat: satSum / count, chromaFrac: chroma / count };
}

// Fraction of masked pixels that read as natural skin tone.
export function skinCoverage(img, mask, cfg) {
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, skin = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!mask[i]) continue;
    count++;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const { h, s, l } = rgb2hsl(r, g, b);
    const hdeg = h < 0 ? h + 360 : h;
    if (hdeg >= cfg.hueMin && hdeg <= cfg.hueMax &&
        s >= cfg.satMin && s <= cfg.satMax &&
        l >= cfg.lumMin && l <= cfg.lumMax) skin++;
  }
  return count ? skin / count : 0;
}

export function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d) * 60;
  else if (max === g) h = (2 + (b - r) / d) * 60;
  else h = (4 + (r - g) / d) * 60;
  return { h, s, l };
}

// Normalized Laplacian variance over masked interior pixels.
export function laplacianVar(img, mask = null) {
  const { width, height } = img;
  const luma = toLuma(img);
  let count = 0, sum = 0, sumSq = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      const c = luma[i];
      const v = 4 * c - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width];
      count++; sum += v; sumSq += v * v;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sumSq / count - mean * mean);
}

// Fraction of masked pixels that look like red-eye reflex.
export function redEyeFrac(img, mask, cfg) {
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, red = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!mask[i]) continue;
    count++;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r > cfg.minR && r > cfg.ratio * ((g + b) / 2)) red++;
  }
  return count ? red / count : 0;
}

// Fraction of masked pixels that are very bright and desaturated (specular
// glare, e.g. glasses reflex).
export function glareFrac(img, mask, cfg) {
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, glare = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!mask[i]) continue;
    count++;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r * 77 + g * 151 + b * 28) / 256;
    if (lum >= cfg.lum && sat <= cfg.satMax) glare++;
  }
  return count ? glare / count : 0;
}

// Mean-luma delta between left/right halves and top/bottom halves of a mask,
// split at the face mid lines. Returns absolute deltas (0..255).
export function faceUniformity(img, mask, geom) {
  const { width } = img;
  const luma = toLuma(img);
  const splitX = geom.faceCenter.x, splitY = geom.eyeMid.y;
  const acc = [0, 0, 0, 0], cnt = [0, 0, 0, 0]; // LT RT LB RB
  const n = mask.length;
  for (let i = 0, y = 0; i < n; i++) {
    const x = i % width;
    if (x === 0 && i > 0) y++;
    if (!mask[i]) continue;
    const q = (y < splitY ? 0 : 2) + (x < splitX ? 0 : 1);
    acc[q] += luma[i]; cnt[q]++;
  }
  const mean = (a, c) => (c ? a / c : null);
  const lt = mean(acc[0], cnt[0]), rt = mean(acc[1], cnt[1]);
  const lb = mean(acc[2], cnt[2]), rb = mean(acc[3], cnt[3]);
  const top = [lt, rt].filter((v) => v !== null);
  const bot = [lb, rb].filter((v) => v !== null);
  const lr = lt !== null && rt !== null ? Math.abs(lt - rt) : (lb !== null && rb !== null ? Math.abs(lb - rb) : 0);
  const tb = top.length && bot.length
    ? Math.abs((top[0] + (top[1] ?? top[0])) / top.length - (bot[0] + (bot[1] ?? bot[0])) / bot.length)
    : 0;
  return { lr, tb };
}

// Fraction of masked pixels near-white and neutral.
export function whiteFrac(img, mask, cfg) {
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, white = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!mask[i]) continue;
    count++;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min >= cfg.whiteMin && max - min <= cfg.maxSpread) white++;
  }
  return count ? white / count : 0;
}

// Std-dev and dark-pixel fraction of the background ring (shadow check).
export function backgroundShadowStats(img, mask) {
  const s = lumaStats(img, mask);
  const { data, width, height } = img;
  const n = width * height;
  let count = 0, dark = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!mask[i]) continue;
    count++;
    if (data[p] < 200 && data[p + 1] < 200 && data[p + 2] < 200) dark++;
  }
  return { std: s.std, darkFrac: count ? dark / count : 0 };
}

// ---------------- aggregated metrics for the analyzer ----------------

// imgData: output-space ImageData; geomOut: geometry mapped to output px (or null).
export function computeAllMetrics(imgData, geomOut, cfg) {
  const { width, height } = imgData;
  const total = width * height;
  const hasFace = !!(geomOut && geomOut.ok);

  const faceMask = hasFace ? buildFaceMask(width, height, geomOut) : null;
  const eyeMask = hasFace ? buildEyeMask(width, height, geomOut) : null;
  const bgMask = hasFace ? buildBackgroundMask(width, height, geomOut) : null;

  const ringPx = bgMask ? countMask(bgMask) : 0;
  const ringOk = ringPx / total >= cfg.bgWhite.minRingPx;

  return {
    exposure: lumaStats(imgData),
    color: saturationStats(imgData),
    skinCoverage: faceMask ? skinCoverage(imgData, faceMask, cfg.skin) : null,
    uniformity: faceMask ? faceUniformity(imgData, faceMask, geomOut) : null,
    bgWhite: bgMask && ringOk ? whiteFrac(imgData, bgMask, cfg.bgWhite) : null,
    bgShadow: bgMask && ringOk ? backgroundShadowStats(imgData, bgMask) : null,
    redEye: eyeMask ? redEyeFrac(imgData, eyeMask, cfg.redEye) : null,
    glare: eyeMask ? glareFrac(imgData, eyeMask, cfg.glare) : null,
    sharpness: laplacianVar(imgData, faceMask),
  };
}

function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

// ---------------- mask builders (pure, geometry in output px) ----------------

export function ellipseMask(w, h, cx, cy, rx, ry) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1) m[y * w + x] = 1;
    }
  }
  return m;
}

// Face ellipse: centered between crown and chin, slightly grown.
export function buildFaceMask(w, h, geom, grow = 0.10) {
  const cx = geom.faceCenter.x;
  const cy = geom.faceCenter.y;
  const rx = (geom.faceW / 2) * 1.12 + grow * geom.headH;
  const ry = (geom.headH / 2) * 1.12 + grow * geom.headH;
  return ellipseMask(w, h, cx, cy, rx, ry);
}

// Union of two circles around the irises.
export function buildEyeMask(w, h, geom) {
  const r = geom.eyeDist * 0.35;
  const a = ellipseMask(w, h, geom.eyeA.x, geom.eyeA.y, r, r);
  const b = ellipseMask(w, h, geom.eyeB.x, geom.eyeB.y, r, r);
  for (let i = 0; i < a.length; i++) a[i] = a[i] || b[i];
  return a;
}

// Background ring: outside a grown head ellipse and above the shoulder line.
export function buildBackgroundMask(w, h, geom) {
  const cx = geom.faceCenter.x;
  const cy = geom.faceCenter.y;
  const rx = (geom.faceW / 2) * 1.35 + geom.headH * 0.18;
  const ry = (geom.headH / 2) * 1.30 + geom.headH * 0.18;
  const shoulderY = geom.chin.y + geom.headH * 0.30;
  const m = new Uint8Array(w * h);
  const inner = ellipseMask(w, h, cx, cy, rx, ry);
  for (let y = 0; y < h; y++) {
    if (y > shoulderY) break;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inner[i]) m[i] = 1;
    }
  }
  return m;
}
