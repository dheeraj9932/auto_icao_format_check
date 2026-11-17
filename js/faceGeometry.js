// Pure landmark -> geometry mapping. No DOM, node-testable.
//
// Input: face landmarks in pixel coordinates of the working image
// (array of {x, y}, MediaPipe FaceLandmarker order, 478 points).
// Output: measurements consumed by autocrop.js and analyzer.js.

// Landmark indices (MediaPipe FaceMesh / FaceLandmarker).
export const IDX = {
  foreheadTop: 10,
  chin: 152,
  faceEdgeA: 234,
  faceEdgeB: 454,
  eye1Outer: 33, eye1Inner: 133, eye1Top: 159, eye1Bottom: 145, iris1: 468,
  eye2Outer: 263, eye2Inner: 362, eye2Top: 386, eye2Bottom: 374, iris2: 473,
  noseTip: 1,
  mouthR: 61, mouthL: 291, lipUpper: 13, lipLower: 14,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function computeGeometry(lm, cfg = { head: { crownFactor: 1.0 }, yawScale: 75, pitchRatio0: 0.42, pitchScale: 120 }) {
  const P = (i) => lm[i];
  const need = [IDX.foreheadTop, IDX.chin, IDX.faceEdgeA, IDX.faceEdgeB, IDX.noseTip];
  for (const i of need) {
    if (!P(i)) return { ok: false, reason: 'missing landmarks' };
  }

  // --- eyes: cluster 1 and 2, then name A/B by image-space x (A = left in image)
  const eye1 = {
    outer: P(IDX.eye1Outer), inner: P(IDX.eye1Inner),
    top: P(IDX.eye1Top), bottom: P(IDX.eye1Bottom),
    center: P(IDX.iris1) ?? mid(P(IDX.eye1Outer), P(IDX.eye1Inner)),
  };
  const eye2 = {
    outer: P(IDX.eye2Outer), inner: P(IDX.eye2Inner),
    top: P(IDX.eye2Top), bottom: P(IDX.eye2Bottom),
    center: P(IDX.iris2) ?? mid(P(IDX.eye2Outer), P(IDX.eye2Inner)),
  };
  const eye1EAR = eyeAspect(eye1);
  const eye2EAR = eyeAspect(eye2);
  const [eyeA, eyeB, earA, earB, swapped] = eye1.center.x <= eye2.center.x
    ? [eye1, eye2, eye1EAR, eye2EAR, false]
    : [eye2, eye1, eye2EAR, eye1EAR, true];

  const eyeMid = mid(eyeA.center, eyeB.center);
  const eyeDist = dist(eyeA.center, eyeB.center);

  // --- head verticals
  const chin = P(IDX.chin);
  const nose = P(IDX.noseTip);
  const foreheadTop = P(IDX.foreheadTop);
  const crownFactor = cfg.head?.crownFactor ?? 1.0;
  const chinEye = chin.y - eyeMid.y;
  // Crown = top of skull (hair included). Eyes sit near the skull's vertical
  // middle, so crownY = eyeY - (chinY - eyeY). Never let the estimate fall
  // below the forehead-top landmark (physically impossible).
  let crownY = eyeMid.y - chinEye * crownFactor;
  const minY = foreheadTop.y - 0.10 * chinEye;
  if (crownY > minY) crownY = minY;
  const crown = { x: eyeMid.x, y: crownY };
  const headH = chin.y - crownY;

  // --- face width
  const edgeA = P(IDX.faceEdgeA), edgeB = P(IDX.faceEdgeB);
  let faceW = dist(edgeA, edgeB);
  if (!(faceW > eyeDist * 1.1 && faceW < eyeDist * 4.0)) faceW = eyeDist * 2.2;

  // --- pose estimates
  const rollDeg = Math.atan2(eyeB.center.y - eyeA.center.y, eyeB.center.x - eyeA.center.x) * 180 / Math.PI;

  // Yaw proxy: nose tip position between the two eyes, normalized to [-1, 1].
  const spanL = nose.x - eyeA.center.x;
  const spanR = eyeB.center.x - nose.x;
  let r = spanR <= 0 && spanL <= 0 ? 1 : (spanR <= 0 ? 99 : spanL / spanR);
  if (spanR <= 0) r = 99; // degenerate: clamp hard
  const d = clamp((r - 1) / (r + 1), -1, 1);
  const yawDeg = clamp(d * (cfg.yawScale ?? 75), -90, 90);

  // Pitch proxy: nose tip vertical position between eye line and chin vs the
  // frontal canon.
  const denom = chin.y - eyeMid.y;
  const p = denom > 0 ? (nose.y - eyeMid.y) / denom : cfg.pitchRatio0 ?? 0.42;
  const pitchDeg = clamp((p - (cfg.pitchRatio0 ?? 0.42)) * (cfg.pitchScale ?? 120), -60, 60);

  // --- mouth
  const mouthW = dist(P(IDX.mouthR), P(IDX.mouthL));
  const lipGap = Math.abs(P(IDX.lipLower).y - P(IDX.lipUpper).y);

  const xs = [eyeA.outer.x, eyeA.inner.x, eyeB.outer.x, eyeB.inner.x, chin.x];
  const ys = [crown.y, chin.y, eyeA.top.y, eyeB.top.y];

  return {
    ok: true,
    eyeA: eyeA.center, eyeB: eyeB.center,
    eyeMid, eyeDist,
    earA, earB, swapped,
    chin, nose, crown, foreheadTop,
    headH, faceW,
    faceCenter: { x: eyeMid.x, y: eyeMid.y + headH * 0.25 },
    roll: rollDeg, yaw: yawDeg, pitch: pitchDeg,
    mouthW, lipGap,
    bbox: {
      x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    },
  };
}

function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

function eyeAspect(eye) {
  const w = dist(eye.outer, eye.inner);
  if (w <= 0) return 0;
  return Math.abs(eye.top.y - eye.bottom.y) / w;
}

// Map a geometry object (and its points) through an affine crop transform
// {s, tx, ty}: out = src * s + t.
export function mapGeometry(g, t) {
  if (!g || !g.ok) return g;
  const map = (p) => ({ x: p.x * t.s + t.tx, y: p.y * t.s + t.ty });
  const out = { ...g, ok: true };
  for (const k of ['eyeA', 'eyeB', 'eyeMid', 'chin', 'nose', 'crown', 'faceCenter']) {
    out[k] = map(g[k]);
  }
  out.headH = g.headH * t.s;
  out.faceW = g.faceW * t.s;
  out.eyeDist = g.eyeDist * t.s;
  out.mouthW = g.mouthW * t.s;
  out.lipGap = g.lipGap * t.s;
  out.bbox = {
    x: g.bbox.x * t.s + t.tx, y: g.bbox.y * t.s + t.ty,
    w: g.bbox.w * t.s, h: g.bbox.h * t.s,
  };
  // pose angles unchanged by uniform scale+translate
  out.earA = g.earA; out.earB = g.earB;
  return out;
}
