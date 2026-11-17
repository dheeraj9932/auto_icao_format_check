// Central configuration: every threshold, band and weight lives here.
// Tune scoring behaviour without touching analyzer logic.

export const CONFIG = {
  output: { width: 630, height: 810 },

  // Working image is downscaled to this size (longest side) before face
  // inference and cropping. Output is rendered from this base; 1600 px is
  // comfortably above the 630x810 target for any head-sized crop.
  workMaxSize: 1600,

  head: {
    // Head height (crown->chin) as a fraction of the 810 px output height.
    // ICAO 9303 geometry; Indian 35x45 mm spec maps to the same band.
    heightTargetMin: 0.70,
    heightTargetMax: 0.80,
    grace: 0.05,
    // Crown estimate: eyes sit near the vertical middle of the skull.
    // crownY = eyeY - crownFactor * (chinY - eyeY)
    crownFactor: 1.0,
  },

  eyeLine: {
    // Eye line height above the bottom edge, fraction of output height.
    minFromBottom: 0.50,
    maxFromBottom: 0.60,
    grace: 0.06,
  },

  centerX: { tol: 0.05, worst: 0.12 },   // fraction of 630 px width
  roll:    { good: 5, worst: 15 },       // degrees
  yaw:     { good: 10, worst: 25 },      // degrees (estimate)
  pitch:   { good: 10, worst: 25 },      // degrees (estimate)
  yawScale: 75,                          // proxy->degree mapping
  pitchRatio0: 0.42,                     // canonical nose position between eyes and chin
  pitchScale: 120,

  brightness: { min: 0.60, max: 0.80, grace: 0.08 },   // mean luma / 255
  contrast:   { stdMin: 45, stdMax: 70, spanMin: 120 },
  uniformLR:  { good: 12, worst: 25 },   // mean-luma delta left/right face halves
  uniformTB:  { good: 15, worst: 30 },

  bgWhite: {
    good: 0.95, worst: 0.80,             // fraction of background ring near-white
    whiteMin: 240, maxSpread: 10,        // min(RGB) >= whiteMin, max-min <= maxSpread
    minRingPx: 0.03,                     // need >=3% of frame as visible background
  },
  bgShadow: { stdGood: 8, stdWorst: 20, darkLevel: 200, darkPct: 0.01 },

  exposure: { overLevel: 250, underLevel: 15, maxPct: 0.01, grace: 0.04 },

  saturation: { min: 0.15, max: 0.45, grace: 0.08 },
  skin: {
    hueMin: 10, hueMax: 45,              // degrees
    satMin: 0.15, satMax: 0.60,
    lumMin: 0.25, lumMax: 0.92,
    minCoverage: 0.50,                   // fraction of face mask that reads as skin
  },

  eyes: {
    blinkGood: 0.30, blinkWorst: 0.55,   // MediaPipe eyeBlink blendshape
    earGood: 0.20, earWorst: 0.12,       // eye-aspect-ratio fallback
  },
  mouth: { jawGood: 0.15, jawWorst: 0.40, gapPct: 0.10 },

  redEye: { ratio: 1.7, minR: 120, maxPct: 0.005, grace: 0.02 },
  sharpness: { varGood: 100, varWorst: 30 },  // normalized Laplacian variance
  glare: { lum: 245, satMax: 0.10, pctFlag: 0.02 },

  // Category weights for the overall score (N/A rules are re-normalized).
  weights: { geometry: 0.30, exposure: 0.40, face: 0.30 },

  passScore: 80,   // >= this: green
  warnScore: 50,   // >= this: amber, else red

  autoCrop: {
    headHeightFrac: 0.75,       // head height in output (of 810)
    eyeLineFromBottom: 0.55,    // eye line above bottom edge
    minMarginPx: 8,             // min head-to-frame-edge margin in output px
  },
};

// Quoted guideline text shown in the score panel (Indian Embassy Berlin PDF).
export const GUIDELINES = {
  headSize: 'Face takes up 80-85% of the photograph; full head from top of hair to bottom of chin.',
  centered: 'Centre head within frame (head should not be tilted).',
  eyeLine: 'Full face, front view, eyes open and clearly visible.',
  facing: 'Show the applicant looking directly at the camera.',
  brightness: 'Have appropriate brightness and contrast.',
  uniform: 'Uniform lighting, no shadows or flash reflections on the face or background.',
  bgWhite: 'Background of the photograph should be White.',
  bgShadow: 'No distracting shadows in the background.',
  exposure: 'Not over- or under-exposed.',
  color: 'The photograph should be in color; natural skin tones; no excessive saturation.',
  eyes: 'Show the applicants eyes open and clearly visible.',
  mouth: 'Mouth should not be open.',
  redEye: 'Illumination shall not cause any red eye effects visible in the eyes.',
  sharpness: 'Should not be blurred.',
  glare: 'Should not have reflection of the glasses; glasses to be taken off to avoid reflections.',
  dimensions: 'Dimensions should be 630x810 Pixels.',
};
