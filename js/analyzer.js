// Pure scoring engine. No DOM, node-testable.
//
// analyze() consumes:
//   geomOut      - geometry mapped into output px space (or null = no face)
//   blendshapes  - {name: score} from MediaPipe (or null)
//   metrics      - computed by metrics.computeAllMetrics()
//   cfg          - CONFIG
// and returns { overall, results, manualChecks, notes }.
// Each result: { id, label, category, score 0..100, state, detail, guideline }.

import { CONFIG, GUIDELINES as G } from './config.js';
import { headMargins } from './autocrop.js';

export function analyze({ geomOut = null, blendshapes = null, metrics, cfg = CONFIG }) {
  const results = [];
  const { width: outW, height: outH } = cfg.output;

  const hasFace = !!(geomOut && geomOut.ok);

  // ---------------- A. geometry ----------------
  if (hasFace) {
    // 1. head size
    const headFrac = geomOut.headH / outH;
    results.push(rule('head-size', 'Head size', 'geometry',
      bandScore(headFrac, cfg.head.heightTargetMin, cfg.head.heightTargetMax, cfg.head.grace),
      `head height ${(headFrac * 100).toFixed(0)}% of frame — target ${(cfg.head.heightTargetMin * 100).toFixed(0)}–${(cfg.head.heightTargetMax * 100).toFixed(0)}%`,
      G.headSize));

    // 2. centered horizontally
    const cxDelta = Math.abs(geomOut.faceCenter.x - outW / 2) / outW;
    results.push(rule('centered', 'Head centered', 'geometry',
      lowerScore(cxDelta, cfg.centerX.tol, cfg.centerX.worst),
      `face center off by ${(cxDelta * 100).toFixed(1)}% of width — target ≤ ${(cfg.centerX.tol * 100).toFixed(0)}%`,
      G.centered));

    // 3. eye line height
    const eyeFrac = (outH - geomOut.eyeMid.y) / outH;
    results.push(rule('eye-line', 'Eye line height', 'geometry',
      bandScore(eyeFrac, cfg.eyeLine.minFromBottom, cfg.eyeLine.maxFromBottom, cfg.eyeLine.grace),
      `eye line ${(eyeFrac * 100).toFixed(0)}% up from bottom — target ${(cfg.eyeLine.minFromBottom * 100).toFixed(0)}–${(cfg.eyeLine.maxFromBottom * 100).toFixed(0)}%`,
      G.eyeLine));

    // 4. roll
    results.push(rule('roll', 'Head straight (no tilt)', 'geometry',
      lowerScore(Math.abs(geomOut.roll), cfg.roll.good, cfg.roll.worst),
      `tilt ${Math.abs(geomOut.roll).toFixed(1)}° — target ≤ ${cfg.roll.good}°`,
      G.centered));

    // 5. facing camera
    const facing = Math.max(Math.abs(geomOut.yaw), Math.abs(geomOut.pitch));
    results.push(rule('facing', 'Facing the camera', 'geometry',
      lowerScore(facing, cfg.yaw.good, cfg.yaw.worst),
      `yaw ${fmtSigned(geomOut.yaw)}°, pitch ${fmtSigned(geomOut.pitch)}° (estimate)`,
      G.facing));

    // 6. full head in frame
    const m = headMargins(geomOut, outW, outH, cfg);
    const mScore = m.ok ? 100 : worstOf(
      bandScore(m.crown, 4, outH, outH * 0.06),
      bandScore(m.chin, 8, outH, outH * 0.08));
    const parts = [];
    if (m.crown < 0 || m.crown < 8) parts.push('crown tight');
    if (m.chin < 8) parts.push('chin tight');
    results.push(rule('in-frame', 'Full head in frame', 'geometry', mScore,
      parts.length ? parts.join(', ') : 'crown and chin clear of edges',
      G.headSize));
  } else {
    for (const [id, label, guide] of [
      ['head-size', 'Head size', G.headSize],
      ['centered', 'Head centered', G.centered],
      ['eye-line', 'Eye line height', G.eyeLine],
      ['roll', 'Head straight (no tilt)', G.centered],
      ['facing', 'Facing the camera', G.facing],
      ['in-frame', 'Full head in frame', G.headSize],
    ]) {
      results.push(rule(id, label, 'geometry', null, 'no face detected', guide));
    }
  }

  // ---------------- B. exposure & color ----------------
  const ex = metrics.exposure;
  results.push(rule('brightness', 'Brightness', 'exposure',
    bandScore(ex.mean / 255, cfg.brightness.min, cfg.brightness.max, cfg.brightness.grace),
    `mean brightness ${(ex.mean / 2.55).toFixed(0)}% — target ${(cfg.brightness.min * 100).toFixed(0)}–${(cfg.brightness.max * 100).toFixed(0)}%`,
    G.brightness));

  const cSpan = ex.p95 - ex.p5;
  const cScore = Math.min(
    bandScore(ex.std, cfg.contrast.stdMin, cfg.contrast.stdMax, 15),
    upperScore(cSpan, cfg.contrast.spanMin, cfg.contrast.spanMin * 0.5));
  results.push(rule('contrast', 'Contrast', 'exposure', cScore,
    `std ${ex.std.toFixed(0)}, 5–95% span ${cSpan.toFixed(0)} — target span ≥ ${cfg.contrast.spanMin}`,
    G.brightness));

  if (hasFace && metrics.uniformity) {
    results.push(rule('uniform', 'Uniform lighting on face', 'exposure',
      Math.min(
        lowerScore(metrics.uniformity.lr, cfg.uniformLR.good, cfg.uniformLR.worst),
        lowerScore(metrics.uniformity.tb, cfg.uniformTB.good, cfg.uniformTB.worst)),
      `left/right Δ${metrics.uniformity.lr.toFixed(0)}, top/bottom Δ${metrics.uniformity.tb.toFixed(0)} — targets ≤ ${cfg.uniformLR.good}/${cfg.uniformTB.good}`,
      G.uniform));
  } else {
    results.push(rule('uniform', 'Uniform lighting on face', 'exposure', null, 'no face detected', G.uniform));
  }

  if (hasFace && metrics.bgWhite !== null) {
    results.push(rule('bg-white', 'White background', 'exposure',
      upperScore(metrics.bgWhite, cfg.bgWhite.good, cfg.bgWhite.worst),
      `${(metrics.bgWhite * 100).toFixed(0)}% of background near-white — target ≥ ${(cfg.bgWhite.good * 100).toFixed(0)}%`,
      G.bgWhite));
    results.push(rule('bg-shadow', 'No background shadows', 'exposure',
      Math.min(
        lowerScore(metrics.bgShadow.std, cfg.bgShadow.stdGood, cfg.bgShadow.stdWorst),
        lowerScore(metrics.bgShadow.darkFrac, cfg.bgShadow.darkPct, cfg.bgShadow.darkPct * 5)),
      `background std ${metrics.bgShadow.std.toFixed(0)}, dark ${(metrics.bgShadow.darkFrac * 100).toFixed(1)}%`,
      G.bgShadow));
  } else {
    results.push(rule('bg-white', 'White background', 'exposure', null, 'background not measurable', G.bgWhite));
    results.push(rule('bg-shadow', 'No background shadows', 'exposure', null, 'background not measurable', G.bgShadow));
  }

  results.push(rule('exposure-clip', 'No over/under exposure', 'exposure',
    Math.min(
      lowerScore(ex.overPct, cfg.exposure.maxPct, cfg.exposure.maxPct + cfg.exposure.grace),
      lowerScore(ex.underPct, cfg.exposure.maxPct, cfg.exposure.maxPct + cfg.exposure.grace)),
    `blown ${(ex.overPct * 100).toFixed(1)}%, crushed ${(ex.underPct * 100).toFixed(1)}% — target ≤ 1% each`,
    G.exposure));

  const col = metrics.color;
  results.push(rule('color', 'Color photo, natural tones', 'exposure',
    Math.min(
      bandScore(col.meanSat, cfg.saturation.min, cfg.saturation.max, cfg.saturation.grace),
      col.chromaFrac > 0.02 ? 100 : 0,
      hasFace && metrics.skinCoverage !== null
        ? bandScore(metrics.skinCoverage, cfg.skin.minCoverage, 1.0, 0.2)
        : 100),
    `mean saturation ${(col.meanSat * 100).toFixed(0)}%, chroma ${(col.chromaFrac * 100).toFixed(0)}%${hasFace && metrics.skinCoverage !== null ? `, skin ${(metrics.skinCoverage * 100).toFixed(0)}%` : ''}`,
    G.color));

  // ---------------- C. face details ----------------
  if (hasFace) {
    // eyes open: blendshapes preferred, EAR fallback
    const blink = blendshapes
      ? Math.max(blendshapes.eyeBlinkLeft ?? 0, blendshapes.eyeBlinkRight ?? 0)
      : null;
    const ear = Math.min(geomOut.earA, geomOut.earB);
    let eyeScore, eyeDetail;
    if (blink !== null) {
      eyeScore = lowerScore(blink, cfg.eyes.blinkGood, cfg.eyes.blinkWorst);
      eyeDetail = `eye-blink signal ${blink.toFixed(2)} — target ≤ ${cfg.eyes.blinkGood}`;
    } else {
      eyeScore = upperScore(ear, cfg.eyes.earGood, cfg.eyes.earWorst);
      eyeDetail = `eye aspect ratio ${ear.toFixed(2)} — target ≥ ${cfg.eyes.earGood}`;
    }
    results.push(rule('eyes-open', 'Eyes open and visible', 'face', eyeScore, eyeDetail, G.eyes));

    // mouth closed
    const jaw = blendshapes ? (blendshapes.jawOpen ?? 0) : 0;
    const gapFrac = geomOut.mouthW > 0 ? geomOut.lipGap / geomOut.mouthW : 0;
    const mouthScore = Math.min(
      lowerScore(jaw, cfg.mouth.jawGood, cfg.mouth.jawWorst),
      lowerScore(gapFrac, cfg.mouth.gapPct * 0.4, cfg.mouth.gapPct));
    const smile = blendshapes
      ? Math.max(blendshapes.mouthSmileLeft ?? 0, blendshapes.mouthSmileRight ?? 0)
      : 0;
    results.push(rule('mouth', 'Mouth closed', 'face', mouthScore,
      `lip gap ${(gapFrac * 100).toFixed(0)}% of mouth width${smile > 0.5 ? ' · smile detected (see manual check)' : ''}`,
      G.mouth));

    // red-eye
    results.push(rule('red-eye', 'No red-eye', 'face',
      lowerScore(metrics.redEye, cfg.redEye.maxPct, cfg.redEye.maxPct + cfg.redEye.grace),
      `red-eye pixels ${(metrics.redEye * 100).toFixed(2)}% of eye area — target ≤ ${(cfg.redEye.maxPct * 100).toFixed(1)}%`,
      G.redEye));

    // sharpness
    results.push(rule('sharpness', 'Not blurred', 'face',
      upperScore(metrics.sharpness, cfg.sharpness.varGood, cfg.sharpness.varWorst),
      `edge detail ${metrics.sharpness.toFixed(0)} — target ≥ ${cfg.sharpness.varGood}`,
      G.sharpness));

    // glasses glare (weak signal -> amber cap)
    const glareScore = lowerScore(metrics.glare, cfg.glare.pctFlag, cfg.glare.pctFlag * 3);
    results.push(rule('glare', 'No glare on glasses', 'face',
      Math.min(glareScore, 78), // capped below pass: heuristic only, see manual check
      `specular ${(metrics.glare * 100).toFixed(1)}% of eye area — also check manually`,
      G.glare));
  } else {
    for (const [id, label, guide] of [
      ['eyes-open', 'Eyes open and visible', G.eyes],
      ['mouth', 'Mouth closed', G.mouth],
      ['red-eye', 'No red-eye', G.redEye],
      ['sharpness', 'Not blurred', G.sharpness],
      ['glare', 'No glare on glasses', G.glare],
    ]) {
      results.push(rule(id, label, 'face', null, 'no face detected', guide));
    }
  }

  // ---------------- aggregate ----------------
  const cats = { geometry: [], exposure: [], face: [] };
  for (const r of results) if (r.category) cats[r.category].push(r);
  let wSum = 0, acc = 0;
  for (const [cat, w] of Object.entries(cfg.weights)) {
    const scored = cats[cat].filter((r) => r.score !== null);
    if (!scored.length) continue;
    acc += w * mean(scored.map((r) => r.score));
    wSum += w;
  }
  const overall = wSum > 0 ? Math.round(acc / wSum) : null;

  const manualChecks = [
    { id: 'hair', label: 'Hair across the eyes', text: 'No hair over the eyes; eyes fully visible.' },
    { id: 'glasses', label: 'Glasses reflections', text: 'No reflection on lenses. Guidelines recommend taking glasses off.' },
    { id: 'headwear', label: 'Head covering', text: 'Only for religious reasons; full face from chin to forehead and both face edges must be visible.' },
    { id: 'expression', label: 'Natural expression', text: 'Neutral or natural look, mouth closed, no exaggerated smile.' },
    { id: 'children', label: 'Child photos', text: 'Same rules apply; supporting hands/toys must not be visible.' },
  ];
  const notes = [];
  if (!hasFace) notes.push('No face detected — geometry and face rules are hidden. You can still crop manually and check exposure/color scores.');

  return { overall, results, manualChecks, notes };
}

// ---------------- scoring ramps ----------------

// 100 inside [lo, hi], linear down to 0 at lo-grace / hi+grace.
export function bandScore(v, lo, hi, grace) {
  if (v >= lo && v <= hi) return 100;
  if (v < lo) return Math.max(0, Math.round(100 * (1 - (lo - v) / grace)));
  return Math.max(0, Math.round(100 * (1 - (v - hi) / grace)));
}

// Lower is better: 100 at <= good, 0 at >= worst.
export function lowerScore(v, good, worst) {
  if (v <= good) return 100;
  if (v >= worst) return 0;
  return Math.round(100 * (worst - v) / (worst - good));
}

// Higher is better: 100 at >= good, 0 at <= worst.
export function upperScore(v, good, worst) {
  if (v >= good) return 100;
  if (v <= worst) return 0;
  return Math.round(100 * (v - worst) / (good - worst));
}

function rule(id, label, category, score, detail, guideline) {
  let state;
  if (score === null) state = 'na';
  else if (score >= CONFIG.passScore) state = 'pass';
  else if (score >= CONFIG.warnScore) state = 'warn';
  else state = 'fail';
  return { id, label, category, score, state, detail, guideline };
}

const fmtSigned = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const worstOf = (...v) => Math.min(...v);
