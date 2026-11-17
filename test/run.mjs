// Node test runner for pure modules: faceGeometry, autocrop, metrics, analyzer.
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { computeGeometry, mapGeometry } from '../js/faceGeometry.js';
import { computeAutoCrop, transformFor, headMargins } from '../js/autocrop.js';
import {
  lumaStats, saturationStats, laplacianVar, redEyeFrac, skinCoverage,
  ellipseMask, buildFaceMask, buildEyeMask, buildBackgroundMask, computeAllMetrics,
} from '../js/metrics.js';
import { analyze, bandScore, lowerScore, upperScore } from '../js/analyzer.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);

// ---------------- synthetic landmark set ----------------
// Frontal synthetic face on a 1600x1200 canvas.
function syntheticLandmarks({ eyeY = 500, tilt = 0, eyeGap = 200, chinY = 800 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  const eyeAx = 800 - eyeGap / 2, eyeBx = 800 + eyeGap / 2;
  const tiltOff = Math.tan(tilt * Math.PI / 180) * (eyeGap / 2);

  lm[10] = { x: 800, y: eyeY - 200 };
  lm[152] = { x: 800, y: chinY };
  lm[234] = { x: 800 - 320, y: eyeY + 100 };
  lm[454] = { x: 800 + 320, y: eyeY + 100 };
  lm[1] = { x: 800, y: eyeY + (chinY - eyeY) * 0.42 };
  lm[61] = { x: 800 - 90, y: chinY - 80 };
  lm[291] = { x: 800 + 90, y: chinY - 80 };
  lm[13] = { x: 800, y: chinY - 92 };
  lm[14] = { x: 800, y: chinY - 92 };

  // eye 1 (left in image)
  lm[33] = { x: eyeAx - 50, y: eyeY + tiltOff };
  lm[133] = { x: eyeAx + 50, y: eyeY + tiltOff };
  lm[159] = { x: eyeAx, y: eyeY - 15 + tiltOff };
  lm[145] = { x: eyeAx, y: eyeY + 15 + tiltOff };
  lm[468] = { x: eyeAx, y: eyeY + tiltOff };
  // eye 2 (right in image)
  lm[263] = { x: eyeBx + 50, y: eyeY - tiltOff };
  lm[362] = { x: eyeBx - 50, y: eyeY - tiltOff };
  lm[386] = { x: eyeBx, y: eyeY - 15 - tiltOff };
  lm[374] = { x: eyeBx, y: eyeY + 15 - tiltOff };
  lm[473] = { x: eyeBx, y: eyeY - tiltOff };
  return lm;
}

// ---------------- faceGeometry ----------------
test('computeGeometry: frontal face basics', () => {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  assert.ok(g.ok);
  approx(g.eyeDist, 200, 1, 'eyeDist');
  approx(g.headH, 600, 1, 'headH'); // crown = 500 - 300 = 200; chin 800 -> 600
  approx(g.roll, 0, 0.01, 'roll');
  approx(g.faceW, 640, 1, 'faceW');
  approx(g.mouthW, 180, 1, 'mouthW');
  approx(g.lipGap, 0, 0.01, 'lipGap');
});

test('computeGeometry: roll detection', () => {
  const g = computeGeometry(syntheticLandmarks({ tilt: 10 }), CONFIG);
  approx(g.roll, -10, 1.5, 'roll negative when right eye higher');
});

test('computeGeometry: eye aspect ratio', () => {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  approx(g.earA, 30 / 100, 0.01, 'earA');
  approx(g.earB, 30 / 100, 0.01, 'earB');
});

test('computeGeometry: yaw ~0 frontal, grows when nose off-center', () => {
  const lm = syntheticLandmarks();
  const g0 = computeGeometry(lm, CONFIG);
  approx(g0.yaw, 0, 1, 'frontal yaw');
  lm[1] = { x: 750, y: 630 }; // nose toward left eye
  const g1 = computeGeometry(lm, CONFIG);
  assert.ok(g1.yaw < -5, `yaw should be negative, got ${g1.yaw}`);
});

test('mapGeometry: scale+translate maps points and sizes', () => {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  const t = { s: 2, tx: 10, ty: 20 };
  const g2 = mapGeometry(g, t);
  approx(g2.eyeMid.x, g.eyeMid.x * 2 + 10, 0.01, 'eyeMid.x');
  approx(g2.headH, g.headH * 2, 0.01, 'headH');
});

// ---------------- autocrop ----------------
test('computeAutoCrop: standard geometry', () => {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  const s = 0.75 * 810 / 600; // 1.0125
  approx(r.s, s, 1e-6, 'scale');
  approx(r.crop.w, 630 / s, 0.01, 'crop width');
  approx(r.crop.h, 810 / s, 0.01, 'crop height');
  // eye line lands at 45% from top
  const eyeYinCrop = g.eyeMid.y - r.crop.y;
  approx(eyeYinCrop / r.crop.h, 0.45, 0.001, 'eye line frac');
  // face centered
  approx((g.eyeMid.x - r.crop.x) / r.crop.w, 0.5, 0.001, 'centered');
  assert.ok(!r.flags.clampedX && !r.flags.clampedY && !r.flags.upscaled, 'no flags');
});

test('computeAutoCrop: clamps near left edge', () => {
  const lm = syntheticLandmarks();
  // shift face to the far left by translating all landmarks
  const shifted = lm.map((p) => ({ x: p.x - 700, y: p.y }));
  const g = computeGeometry(shifted, CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  approx(r.crop.x, 0, 0.01, 'clamped to left edge');
  assert.ok(r.flags.clampedX, 'clampedX flag');
});

test('computeAutoCrop: no face fallback fills height', () => {
  const r = computeAutoCrop(null, 1600, 1200, CONFIG);
  approx(r.crop.h, 1200, 0.01, 'fills height');
  approx(r.crop.w, 1200 * 630 / 810, 0.01, 'aspect width');
  assert.ok(r.flags.noFace, 'noFace flag');
});

test('headMargins: clean margins', () => {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  const gOut = mapGeometry(g, r.transform);
  const m = headMargins(gOut, 630, 810, CONFIG);
  assert.ok(m.ok, `margins ok: crown ${m.crown}, chin ${m.chin}, left ${m.left}, right ${m.right}`);
});

// ---------------- metrics ----------------
function makeImg(w, h, fill) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = typeof fill === 'function' ? fill(i % w, Math.floor(i / w), i) : fill;
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

test('lumaStats: flat gray', () => {
  const s = lumaStats(makeImg(64, 64, [128, 128, 128]));
  approx(s.mean, 128, 1, 'mean');
  approx(s.std, 0, 0.01, 'std');
  approx(s.overPct, 0, 1e-6, 'overPct');
  approx(s.underPct, 0, 1e-6, 'underPct');
});

test('lumaStats: over/under exposure fractions', () => {
  const img = makeImg(100, 100, (x, y) => (x < 5 ? [255, 255, 255] : (y < 5 ? [0, 0, 0] : [128, 128, 128])));
  const s = lumaStats(img);
  approx(s.overPct, 0.05, 0.005, 'overPct');
  approx(s.underPct, 0.05, 0.005, 'underPct');
});

test('laplacianVar: flat = 0, noise > 0', () => {
  const flat = laplacianVar(makeImg(64, 64, [128, 128, 128]));
  approx(flat, 0, 1e-6, 'flat var');
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const noise = laplacianVar(makeImg(64, 64, () => {
    const v = 100 + rnd() * 100;
    return [v, v, v];
  }));
  assert.ok(noise > 1000, `noise var ${noise}`);
});

test('redEyeFrac: detects red dot in eye mask', () => {
  const img = makeImg(100, 100, [200, 200, 200]);
  // paint red dot at (50,50)
  const d = img.data;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const p = ((50 + dy) * 100 + (50 + dx)) * 4;
      d[p] = 255; d[p + 1] = 40; d[p + 2] = 40;
    }
  }
  const mask = ellipseMask(100, 100, 50, 50, 10, 10);
  const frac = redEyeFrac(img, mask, CONFIG.redEye);
  assert.ok(frac > 0.05 && frac < 0.5, `redFrac ${frac}`);
});

test('skinCoverage: skin-ish pixels pass', () => {
  const img = makeImg(50, 50, [222, 184, 148]); // warm skin tone
  const mask = ellipseMask(50, 50, 25, 25, 20, 20);
  const cov = skinCoverage(img, mask, CONFIG.skin);
  assert.ok(cov > 0.9, `coverage ${cov}`);
  const gray = makeImg(50, 50, [190, 190, 190]);
  const cov2 = skinCoverage(gray, mask, CONFIG.skin);
  assert.ok(cov2 < 0.05, `gray coverage ${cov2}`);
});

test('saturationStats: gray has no chroma', () => {
  const s = saturationStats(makeImg(32, 32, [130, 130, 130]));
  approx(s.meanSat, 0, 1e-6, 'sat');
  approx(s.chromaFrac, 0, 1e-6, 'chroma');
});

// ---------------- analyzer ----------------
function goodMetrics() {
  return {
    exposure: { count: 510300, mean: 180, std: 55, p5: 60, p95: 235, overPct: 0.002, underPct: 0.001 },
    color: { count: 510300, meanSat: 0.28, chromaFrac: 0.7 },
    skinCoverage: 0.7,
    uniformity: { lr: 4, tb: 5 },
    bgWhite: 0.97,
    bgShadow: { std: 3, darkFrac: 0 },
    redEye: 0.0005,
    glare: 0.003,
    sharpness: 900,
  };
}

function goodGeomOut() {
  const g = computeGeometry(syntheticLandmarks(), CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  return mapGeometry(g, r.transform);
}

const GOOD_BS = { eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05, jawOpen: 0.02, mouthSmileLeft: 0, mouthSmileRight: 0 };

test('analyzer: good scenario scores high', () => {
  const a = analyze({ geomOut: goodGeomOut(), blendshapes: GOOD_BS, metrics: goodMetrics(), cfg: CONFIG });
  assert.ok(a.overall >= 80, `overall ${a.overall}`);
  for (const r of a.results) {
    assert.ok(r.score >= 78, `${r.id} score ${r.score}: ${r.detail}`);
  }
});

test('analyzer: dark photo fails brightness', () => {
  const good = analyze({ geomOut: goodGeomOut(), blendshapes: GOOD_BS, metrics: goodMetrics(), cfg: CONFIG });
  const metrics = { ...goodMetrics(), exposure: { ...goodMetrics().exposure, mean: 40, std: 20, p5: 10, p95: 90 } };
  const a = analyze({ geomOut: goodGeomOut(), blendshapes: GOOD_BS, metrics, cfg: CONFIG });
  const b = a.results.find((r) => r.id === 'brightness');
  assert.ok(b.score < 50, `brightness score ${b.score}`);
  assert.ok(a.overall <= good.overall - 10, `overall ${a.overall} should drop from ${good.overall}`);
});

test('analyzer: closed eyes fail', () => {
  const a = analyze({ geomOut: goodGeomOut(), blendshapes: { ...GOOD_BS, eyeBlinkLeft: 0.95, eyeBlinkRight: 0.95 }, metrics: goodMetrics(), cfg: CONFIG });
  const e = a.results.find((r) => r.id === 'eyes-open');
  assert.ok(e.score <= 10, `eyes score ${e.score}`);
});

test('analyzer: open mouth fails', () => {
  const gOut = goodGeomOut();
  const gOpen = { ...gOut, lipGap: gOut.mouthW * 0.4 };
  const a = analyze({ geomOut: gOpen, blendshapes: { ...GOOD_BS, jawOpen: 0.8 }, metrics: goodMetrics(), cfg: CONFIG });
  const m = a.results.find((r) => r.id === 'mouth');
  assert.ok(m.score <= 10, `mouth score ${m.score}`);
});

test('analyzer: gray background fails bg-white', () => {
  const metrics = { ...goodMetrics(), bgWhite: 0.4, bgShadow: { std: 5, darkFrac: 0 } };
  const a = analyze({ geomOut: goodGeomOut(), blendshapes: GOOD_BS, metrics, cfg: CONFIG });
  const b = a.results.find((r) => r.id === 'bg-white');
  assert.ok(b.score <= 30, `bg score ${b.score}`);
});

test('analyzer: heavy tilt fails roll', () => {
  const g = computeGeometry(syntheticLandmarks({ tilt: 12 }), CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  const gOut = mapGeometry(g, r.transform);
  const a = analyze({ geomOut: gOut, blendshapes: GOOD_BS, metrics: goodMetrics(), cfg: CONFIG });
  const roll = a.results.find((res) => res.id === 'roll');
  assert.ok(roll.score < 50, `roll score ${roll.score}`);
});

test('analyzer: no face -> geometry N/A, exposure still scored', () => {
  const img = makeImg(630, 810, [190, 190, 190]);
  const metrics = computeAllMetrics(img, null, CONFIG);
  const a = analyze({ geomOut: null, blendshapes: null, metrics, cfg: CONFIG });
  assert.equal(typeof a.overall, 'number', 'overall should be a number (exposure scored)');
  const geo = a.results.filter((r) => r.category === 'geometry');
  assert.ok(geo.every((r) => r.state === 'na'), 'geometry N/A');
  const b = a.results.find((r) => r.id === 'brightness');
  assert.ok(b.score > 0, `brightness ${b.score}`);
});

// integration: full pipeline on a synthetic portrait image
test('integration: synthetic portrait pipeline scores reasonably', () => {
  const w = 630, h = 810;
  const g = computeGeometry(syntheticLandmarks({ eyeGap: 180 }), CONFIG);
  const r = computeAutoCrop(g, 1600, 1200, CONFIG);
  const gOut = mapGeometry(g, r.transform);
  const faceMask = buildFaceMask(w, h, gOut);
  const bgMask = buildBackgroundMask(w, h, gOut);
  const img = makeImg(w, h, (x, y, i) => {
    const noise = ((i * 2654435761) % 31) - 15; // +-15
    if (faceMask[i]) return [170 + noise, 140 + noise, 110 + noise];
    if (bgMask[i]) return [246, 246, 246];
    return [240, 240, 240];
  });
  const metrics = computeAllMetrics(img, gOut, CONFIG);
  const a = analyze({ geomOut: gOut, blendshapes: GOOD_BS, metrics, cfg: CONFIG });
  assert.ok(a.overall >= 70, `overall ${a.overall}`);
  for (const res of a.results) {
    assert.ok(res.score >= 50, `${res.id} score ${res.score}: ${res.detail}`);
  }
});

test('scoring ramps behave', () => {
  assert.equal(bandScore(0.75, 0.7, 0.8, 0.05), 100);
  assert.equal(bandScore(0.70, 0.7, 0.8, 0.05), 100);
  assert.equal(bandScore(0.68, 0.7, 0.8, 0.05), 60);
  assert.equal(bandScore(0.60, 0.7, 0.8, 0.05), 0);
  assert.equal(lowerScore(5, 5, 15), 100);
  assert.equal(lowerScore(15, 5, 15), 0);
  assert.equal(lowerScore(10, 5, 15), 50);
  assert.equal(upperScore(95, 95, 80), 100);
  assert.equal(upperScore(80, 95, 80), 0);
  assert.equal(upperScore(87.5, 95, 80), 50);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
