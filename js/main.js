// Bootstrap + orchestration. Browser only.

import { CONFIG } from './config.js';
import { state, geomSrc, blendshapes } from './state.js';
import { ensureLandmarker, detectFaces, onModelLoad } from './face.js';
import { computeAutoCrop, mapGeometryOut } from './autocrop.js';
import { computeAllMetrics } from './metrics.js';
import { analyze } from './analyzer.js';
import { drawPreview, renderOutput } from './renderer.js';
import { initCropper, transformFromCrop } from './cropper.js';
import { renderScorePanel } from './scores-ui.js';
import { downloadOutput } from './download.js';

const $ = (id) => document.getElementById(id);

const els = {};
let view = null;          // preview view transform {ox, oy, scale}
let cropperApi = null;
let rescoreTimer = 0;
let modelStatus = 'idle'; // idle | loading | ready | error

function init() {
  for (const id of [
    'upload-card', 'dropzone', 'file-input', 'workspace', 'preview', 'scores',
    'output-canvas', 'download-btn', 'autocrop-btn', 'rotate-left', 'rotate-right',
    'straighten', 'reset-crop', 'toggle-landmarks', 'toggle-guides',
    'model-status', 'offline-badge', 'crop-status', 'file-name', 'output-card', 'new-image-btn',
  ]) {
    els[id] = $(id);
  }

  registerSW();
  wireUpload();
  wireControls();

  cropperApi = initCropper(els['preview'], (final) => {
    scheduleRescore(!final);
    if (final) updateCropStatus();
  });
  window.addEventListener('resize', () => { if (state.hasImage) redraw(); });

  onModelLoad(() => {
    modelStatus = 'ready';
    els['model-status'].textContent = 'AI model loaded';
    els['model-status'].className = 'ok';
  });
}

// Draw the preview and hand the view transform to the cropper for hit-testing.
function redraw() {
  view = drawPreview(els['preview']);
  cropperApi?.setView(view);
  return view;
}

// ---------------- service worker ----------------

function registerSW() {
  if (!('serviceWorker' in navigator)) { els['offline-badge'].textContent = 'offline unavailable'; return; }
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const check = () => {
      if (reg.active) {
        caches.has('icao-v1').then((has) => {
          els['offline-badge'].textContent = has ? 'offline ready ✓' : 'caching…';
        });
      }
    };
    check();
    reg.addEventListener('updatefound', check);
  }).catch(() => { els['offline-badge'].textContent = 'offline unavailable'; });
}

// ---------------- upload ----------------

function wireUpload() {
  els['file-input'].addEventListener('change', (e) => {
    if (e.target.files?.[0]) onFile(e.target.files[0]);
    e.target.value = ''; // allow re-selecting the same file
  });
  const dz = els['dropzone'];
  dz.addEventListener('click', () => els['file-input'].click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els['file-input'].click(); }
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) onFile(item.getAsFile());
  });
}

async function onFile(file) {
  if (!file.type.startsWith('image/')) { setStatus('Not an image file.', 'err'); return; }
  state.busy = true;
  state.fileName = file.name;
  state.fileSize = file.size;
  els['file-name'].textContent = `${file.name} (${(file.size / 1e6).toFixed(1)} MB)`;
  setStatus('Loading model…', 'busy');
  try {
    await ensureLandmarker();
    modelStatus = 'ready';
    await loadBase(file);
    await analyzeBase(true);
    els['upload-card'].classList.add('hidden');
    els['workspace'].classList.remove('hidden');
    els['output-card'].classList.remove('hidden');
    els['new-image-btn'].classList.remove('hidden');
    state.hasImage = true;
    redraw();
    scheduleRescore();   // score the fresh upload immediately
    updateCropStatus();
    setStatus('Ready.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load image: ${err.message}`, 'err');
  } finally {
    state.busy = false;
  }
}

async function loadBase(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const max = CONFIG.workMaxSize;
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  let base = bitmap;
  if (k < 1) {
    base = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * k),
      resizeHeight: Math.round(bitmap.height * k),
      resizeQuality: 'high',
    });
    bitmap.close();
  }
  state.baseBitmap = base;
  state.baseW = base.width;
  state.baseH = base.height;
  state.originalBase = { bitmap: base, w: base.width, h: base.height };
  state.straightenedBase = null;
  state.straighten = false;
  els['straighten'].checked = false;
  state.faces = [];
  state.faceIndex = 0;
  state.manualChecks = {};
}

// ---------------- detection + crop pipeline ----------------

async function analyzeBase(autoCrop = true) {
  const faces = detectFaces(state.baseBitmap);
  state.faces = faces;
  state.faceIndex = 0;
  if (autoCrop) applyAutoCrop();
}

function applyAutoCrop() {
  const g = geomSrc();
  const r = computeAutoCrop(g, state.baseW, state.baseH, CONFIG);
  state.crop = r.crop;
  state.transform = r.transform;
  state.autoFlags = r.flags;
}

function rescoreNow() {
  if (!state.crop) return;
  const outCanvas = els['output-canvas'];
  renderOutput(outCanvas);
  const ctx = outCanvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, CONFIG.output.width, CONFIG.output.height);
  const gOut = geomSrc()?.ok ? mapGeometryOut(geomSrc(), state.transform) : null;
  const metrics = computeAllMetrics(imgData, gOut, CONFIG);
  const analysis = analyze({ geomOut: gOut, blendshapes: blendshapes(), metrics, cfg: CONFIG });
  state.scores = analysis;
  renderScorePanel(els['scores'], analysis);
}

function scheduleRescore(throttleOnly = false) {
  if (rescoreTimer) return;
  rescoreTimer = setTimeout(() => {
    rescoreTimer = 0;
    rescoreNow();
  }, throttleOnly ? 60 : 120);
}

// ---------------- controls ----------------

function wireControls() {
  els['new-image-btn'].addEventListener('click', () => els['file-input'].click());

  els['autocrop-btn'].addEventListener('click', () => {
    applyAutoCrop();
    redraw();
    scheduleRescore();
    updateCropStatus();
  });

  els['reset-crop'].addEventListener('click', () => {
    applyAutoCrop();
    redraw();
    scheduleRescore();
    updateCropStatus();
  });

  els['rotate-left'].addEventListener('click', () => rotate(-90));
  els['rotate-right'].addEventListener('click', () => rotate(90));

  els['straighten'].addEventListener('change', (e) => toggleStraighten(e.target.checked));

  els['toggle-landmarks'].addEventListener('change', (e) => {
    state.overlays.landmarks = e.target.checked;
    redraw();
  });
  els['toggle-guides'].addEventListener('change', (e) => {
    state.overlays.guides = e.target.checked;
    redraw();
  });

  els['download-btn'].addEventListener('click', () => {
    renderOutput(els['output-canvas']);
    downloadOutput(els['output-canvas'], 'passport_630x810.jpg');
  });
}

async function rotate(deg) {
  if (!state.baseBitmap) return;
  setStatus('Rotating…', 'busy');
  const swap = Math.abs(deg) === 90;
  const w = swap ? state.baseH : state.baseW;
  const h = swap ? state.baseW : state.baseH;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(state.baseBitmap, -state.baseW / 2, -state.baseH / 2);
  const bitmap = await createImageBitmap(c);
  state.baseBitmap = bitmap;
  state.baseW = w; state.baseH = h;
  state.originalBase = { bitmap, w, h };
  state.straightenedBase = null;
  els['straighten'].checked = false;
  state.straighten = false;
  await analyzeBase(true);
  redraw();
  scheduleRescore();
  updateCropStatus();
  setStatus('Ready.', 'ok');
}

async function toggleStraighten(on) {
  if (!geomSrc()) { els['straighten'].checked = false; return; }
  if (on) {
    const roll = geomSrc().roll;
    if (Math.abs(roll) < 0.3) { setStatus('Already straight.', 'ok'); els['straighten'].checked = false; return; }
    setStatus('Straightening…', 'busy');
    // rotate the base by -roll so the eye line is horizontal
    const theta = -roll * Math.PI / 180;
    const cos = Math.abs(Math.cos(theta)), sin = Math.abs(Math.sin(theta));
    const w = Math.round(state.baseW * cos + state.baseH * sin);
    const h = Math.round(state.baseW * sin + state.baseH * cos);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.translate(w / 2, h / 2);
    ctx.rotate(theta);
    ctx.drawImage(state.baseBitmap, -state.baseW / 2, -state.baseH / 2);
    const bitmap = await createImageBitmap(c);
    state.straightenedBase = { bitmap, w, h };
    state.baseBitmap = bitmap;
    state.baseW = w; state.baseH = h;
    await analyzeBase(true);
    setStatus(`Straightened by ${roll.toFixed(1)}°.`, 'ok');
  } else {
    setStatus('Reverting rotation…', 'busy');
    const o = state.originalBase;
    state.baseBitmap = o.bitmap;
    state.baseW = o.w; state.baseH = o.h;
    await analyzeBase(true);
    setStatus('Ready.', 'ok');
  }
  redraw();
  scheduleRescore();
  updateCropStatus();
}

// ---------------- status helpers ----------------

function updateCropStatus() {
  const el = els['crop-status'];
  if (!state.crop) { el.textContent = ''; return; }
  const f = state.autoFlags;
  const parts = [];
  if (f?.noFace) parts.push('no face detected — manual crop only');
  if (f?.clampedX || f?.clampedY) parts.push('crop clamped to image edge — head placement off-target');
  if (f?.upscaled) parts.push('image resolution low — output upscaled');
  el.textContent = parts.join(' · ');
}

function setStatus(text, kind) {
  const el = els['model-status'];
  el.textContent = text;
  el.className = kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'busy';
}

init();
