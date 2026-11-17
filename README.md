# ICAO Passport Photo Checker

Client-side web tool that checks, scores and crops a portrait photo to the ICAO /
Indian-embassy passport spec (exact **630×810 px**), based on the
[Indian Embassy Berlin guidelines](https://indianembassyberlin.gov.in/pdf/Guidelines-for-ICAO-Compliant-Photographs-and-documents-for-Passport-Application_new.pdf)
(copy in `docs/`).

**Live site:** https://dheeraj9932.github.io/auto_icao_format_check/

## What it does

1. **Upload** — drag & drop, file picker, or clipboard paste.
2. **Face landmarks** — MediaPipe FaceLandmarker (478 points + blendshapes) runs
   in your browser; the model is vendored in this repo, no CDN, no upload.
3. **Auto-crop** — derives the 630×810 crop with head height 70–80% of frame and
   eye line at 50–60% from bottom (ICAO 9303 geometry), clamped to image bounds.
4. **Score panel** — every checkable guideline gets a 0–100% bar:
   - *Framing & pose*: head size, centered, eye-line height, tilt (roll),
     facing camera (yaw/pitch estimate), full head in frame.
   - *Exposure, color & background*: brightness, contrast, uniform lighting,
     white background, background shadows, over/under exposure, color +
     saturation, natural skin tone.
   - *Face details*: eyes open (blink blendshape), mouth closed, red-eye,
     blur (Laplacian variance), glasses glare (weak heuristic).
   - *Check manually*: hair across eyes, glasses reflections, head coverings,
     expression, child photos — honest items that pixel math can't score.
5. **Manual crop** — drag the box to move, corner handles to resize
   (aspect-locked), optional straighten (auto-rotation by measured roll).
   Scores update live while you drag.
6. **Download** `passport_630x810.jpg` (JPEG q92). Only crop + rescale —
   no filters or "beautification", per the *unaltered by software* guideline.

## Privacy

Everything runs in your browser after first load. The photo is processed in
memory only, never uploaded, never stored (reload clears it). The service
worker caches only app files, never photos.

## Offline / install (PWA)

First visit caches the app + the ~19 MB face model. After that the site works
with zero network and can be installed as a desktop/phone app
(install prompt appears in supported browsers; or browser menu → Install).

## Run locally

Any static server from the repo root, e.g.:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` via `file://` will not work (ES modules + WASM need http).

## Deployment (GitHub Pages)

1. Push to `main`.
2. GitHub → Settings → Pages → Build and deployment → Source: **Deploy from a branch**.
3. Branch `main`, folder `/ (root)` → Save.
4. Live after ~1 minute at the URL above.

## Tests

Pure logic (geometry, pixel metrics, auto-crop, scoring) is DOM-free and runs
under node:

```sh
npm test        # or: node test/run.mjs
```

Browser-only parts (crop interaction, model loading) — manual QA checklist:

- [ ] Clean frontal portrait → all bars green, download works
- [ ] Too dark / overexposed / blown highlights → brightness & clip bars fail
- [ ] Tilted head → roll bar drops; Straighten fixes it and re-scores
- [ ] Open mouth / smile → mouth bar drops, manual-check note appears
- [ ] Busy/colored background → bg-white bar fails
- [ ] Blurred photo → sharpness bar fails
- [ ] Photo with no face → geometry rules N/A, manual crop still works
- [ ] Off-center subject → crop clamps, status line explains
- [ ] Low-res source → "output upscaled" warning appears
- [ ] Load once online → airplane mode → reload → app still works

## Tuning

Every threshold, target band and weight lives in `js/config.js`
(`CONFIG`), including the quoted guideline strings shown in the UI.

## Structure

```
index.html            app shell
css/style.css
js/
  config.js           all thresholds/bands/weights + guideline quotes
  faceGeometry.js     PURE landmarks -> measurements (roll, yaw, head box, ...)
  metrics.js          PURE pixel math (luma, sharpness, masks, skin, red-eye)
  autocrop.js         PURE crop derivation + transforms
  analyzer.js         PURE scoring rules + weighted overall
  face.js             MediaPipe loader + detection
  state.js            app state
  renderer.js         preview canvas + 630x810 output render
  cropper.js          pointer-driven crop box
  scores-ui.js        score panel DOM
  download.js         JPEG export
  main.js             orchestration
vendor/tasks-vision/  MediaPipe wasm + face_landmarker.task (committed)
sw.js                 cache-first service worker
manifest.webmanifest  PWA manifest
icons/                app icons
test/run.mjs          node tests for the pure modules
docs/                 guideline PDF
```

## Limitations (known, accepted)

- Yaw/pitch are geometric estimates, not a full pose model — treat as guidance.
- Crown of the head is estimated (the mesh has no skull-top point); hair-heavy
  or bald heads shift the head-size number a few percent.
- Glasses-glare and background-shadow scores are heuristics → amber at best;
  confirm by eye (manual-check list).
- The tool is advisory only; the embassy / CKGS decides what is accepted.

## Optional: offline desktop executable (not built yet)

The same folder can be wrapped by a ~20-line Python stdlib server
(`desktop/main.py`: serve repo root on a free port, `webbrowser.open`) and
packaged with PyInstaller as a double-clickable Linux executable. Not part of
the current build; see the plan file for the recipe.
