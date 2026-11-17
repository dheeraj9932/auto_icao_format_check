// MediaPipe FaceLandmarker loader + detection wrapper (browser only).

import { FaceLandmarker, FilesetResolver } from '../vendor/tasks-vision/vision_bundle.mjs';
import { CONFIG } from './config.js';
import { computeGeometry } from './faceGeometry.js';

let landmarker = null;
let loadPromise = null;

export function onModelLoad(cb) { loadCbs.push(cb); }
const loadCbs = [];

export function modelReady() { return !!landmarker; }

export async function ensureLandmarker() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks('./vendor/tasks-vision');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: './vendor/tasks-vision/face_landmarker.task', delegate },
      runningMode: 'IMAGE',
      numFaces: 5,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    for (const cb of loadCbs) { try { cb(); } catch { /* noop */ } }
    return landmarker;
  })();
  return loadPromise;
}

// Detect faces on an ImageBitmap/canvas. Returns pixel-space landmarks.
export function detectFaces(bitmap) {
  if (!landmarker) throw new Error('landmarker not loaded');
  const res = landmarker.detect(bitmap);
  const faces = [];
  const n = res.faceLandmarks?.length ?? 0;
  for (let f = 0; f < n; f++) {
    const lm = res.faceLandmarks[f].map((p) => ({ x: p.x * bitmap.width, y: p.y * bitmap.height }));
    const bs = {};
    const cats = res.faceBlendshapes?.[f]?.categories ?? [];
    for (const c of cats) bs[c.categoryName] = c.score;
    faces.push({
      landmarks: lm,
      blendshapes: bs,
      geometry: computeGeometry(lm, CONFIG),
    });
  }
  // largest face first
  faces.sort((a, b) => faceArea(b) - faceArea(a));
  return faces;
}

function faceArea(f) {
  if (!f.geometry?.ok) return 0;
  const g = f.geometry;
  return g.faceW * g.headH;
}
