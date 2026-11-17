// Single mutable app state. No reactivity — main.js orchestrates updates.

export const state = {
  // working image (<= CONFIG.workMaxSize longest side)
  baseBitmap: null,
  baseW: 0,
  baseH: 0,
  fileName: '',
  fileSize: 0,

  // detection
  faces: [],          // [{landmarks, blendshapes, geometry}]
  faceIndex: 0,

  // crop (working-image coords, aspect-locked to output)
  crop: null,         // {x,y,w,h}
  transform: null,    // {s,tx,ty}
  autoFlags: null,    // {noFace, clampedX, clampedY, upscaled}

  // straighten (rotate base by -roll, re-detect)
  straighten: false,
  straightenedBase: null,   // cached {bitmap,w,h}
  originalBase: null,       // cached {bitmap,w,h}

  overlays: { landmarks: false, guides: true },

  manualChecks: {},

  scores: null,       // analyzer output
  busy: false,
  hasImage: false,
};

export function geomSrc() {
  const f = state.faces[state.faceIndex];
  return f ? f.geometry : null;
}

export function blendshapes() {
  const f = state.faces[state.faceIndex];
  return f ? f.blendshapes : null;
}
