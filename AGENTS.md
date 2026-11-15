AGENTS.md 

Forensic Hair Examination Web App (Educational)

Read this file fully at the start of every session. When I say "Build Step N", build exactly that step from the BUILD STEPS section below, nothing more.

## 1. Project summary

An educational Progressive Web App (PWA) for criminology students. It helps them register a hair sample, capture or upload images, make guided observations, take calibrated measurements, and export a report. It is a learning tool only. It does not replace qualified forensic examination or DNA testing.

Deadline: Wednesday, November 18, 2026. Work MVP-first.

## 2. Tech stack (fixed)

- Plain HTML, CSS, and vanilla JavaScript. Separate files: `index.html`, `styles.css`, `app.js` (split JS into modules/files only when a file becomes hard to read).
- No Flutter, no React, no frameworks, no build step, no backend, no accounts.
- Storage: IndexedDB in the browser.
- Hosting: GitHub Pages (static files only, served over HTTPS).
- Mobile-first layout (phone screen first, readable on desktop).
- Ignore any earlier instructions about Flutter, Dart, or pub.dev.

## 3. Strict rules

1. Build only the feature or step I name. No extra screens, features, or libraries unprompted.
2. Prefer no external libraries. If one is truly needed (e.g., PDF generation), it must be a real, currently maintained library; tell me its name, version, why it is needed, and how it is loaded (local file or CDN) before using it.
3. Never produce fake, random, or hardcoded analysis results. If something cannot be done honestly, leave it out and tell me.
4. No buttons, tabs, or screens that do nothing. Every visible control must work.
5. Never delete or rewrite working code unless I ask. After every change, summarize what changed and which files were touched.
6. Never claim the app identifies the owner or geographic origin of a hair. Subject names are user-provided information only.
7. Every result shown to the user must carry one label:
   - **Manually observed** (user picked it from a checklist)
   - **Calibrated measurement** (computed from a saved pixel-to-real-world calibration)
   - **Estimate** (no calibration or limited reliability)
8. Never compute real-world measurements (µm, mm, cm, in) from an uncalibrated image. Show pixels only, or require calibration first.
9. Always make clear which mode is active: Regular Camera Examination or Microscopic Examination. Never present regular-camera results as microscopic results.
10. Original images must be saved separately and never overwritten. Annotated or processed images are saved as separate copies.
11. Handle errors visibly: camera permission denied, unsupported browser, storage failure, empty required fields.
12. Keep code readable with short comments. No unnecessary abstractions.
13. Do not use localStorage for sample records. Use IndexedDB.
14. After each step, tell me how to test it (open locally, then on my phone via the GitHub Pages link) and list possible bugs you noticed.

## 4. Things this app must NOT do

- No automatic cuticle, medulla, or cortex classification, and no automatic curl/pattern classification. We have no validated model or training data. These are manual observation checklists.
- No live microscope streaming promises. Support photo upload and the device camera only. A USB/WiFi microscope works only if the browser exposes it as a normal camera; never assume it.
- No claims of scientific or legal certainty. Include this disclaimer on the results page and every PDF report: "Preliminary educational observations only. This does not replace qualified forensic examination or DNA testing."

## 5. Design direction

Clean, professional, forensic-inspired. Neutral palette (dark navy/slate with a single accent color), clear typography, large tap targets, consistent spacing, simple icons. No heavy animations, no excessive gradients, no clutter. Do not use emojis anywhere in the UI, code, or generated text. Use plain text labels or simple inline SVG icons only. The active mode banner is solid blue (#1E3A8A) with white text. Other UI colors follow the standard design direction.

## 6. Data model (keep consistent across steps)

Each sample record:

- `id` (unique), `sampleId`, `caseNumber`, `subjectName`, `age?`, `sex?`
- `collectionDate`, `collectionTime`, `collectionLocation`, `collectedBy`
- `description?`, `notes?`
- `mode` ("regular" | "microscopic")
- `images`:
  - `originals`: list of original image records `{ id, fileName, mode, blob, capturedAt, quality, calibration? }` (Note: calibration lives on each original image record: `{ referenceLabel, knownLength, unit, pixelDistance, pixelsPerMicrometer, calibratedAt, source: "two-point" | "copied", copiedFrom?, points? }`). Original image Blobs are never modified.
  - `annotated`: list of separate annotated image copies
- `measurements`: list of `{ id, imageId, imageMode, type, pixelDistance, valueUm, displayUnit, label, note, points, calibrationSnapshot, measuredAt }` (where `label` is `"Calibrated measurement"` or `"Estimate (uncalibrated, pixels only)"`, `valueUm` is null if uncalibrated, `calibrationSnapshot` is `{ pixelsPerMicrometer, source }` or null)
- `observations`: list of `{ feature, value, label }` (label per rule 7)
- `createdAt`, `updatedAt`

## 7. BUILD STEPS

Statuses: NOT STARTED / IN PROGRESS / NEEDS TESTING / COMPLETED / BLOCKED. Update the status below after each step.

**Step 1 — Dashboard and sample registration** — COMPLETED
Dashboard with "New Examination" and "Saved Samples". Subject and Sample form with fields: Subject/Owner Name*, Case Number*, Sample ID (auto-generate if blank), Age, Sex, Collection Date*, Collection Time*, Collection Location*, Collected By*, Sample Description, Additional Notes (* = required). Validation with clear messages. Confirmation screen with Edit and Confirm. Save to IndexedDB. Saved Samples list. Form note that the name is user-provided and the app does not identify the owner.

**Step 2 — Mode selection and image capture/upload** — NEEDS TESTING
Mode selection (Regular / Microscopic) shown after confirmation. Camera capture via the browser, gallery upload, preview, retake, and basic image quality check. Camera permission error handling. Positioning instructions. Original image saved separately.

**Step 3 — Image viewer, zoom/pan only (crop postponed)** — COMPLETED
Zoom and pan for saved original images (pinch, wheel, drag, Zoom In/Out/Reset buttons). Display only; stored originals are never modified. Crop is postponed unless time remains.

**Step 4 — Calibration and measurement** — COMPLETED
Step 4A (COMPLETED): Calibration inside the existing Image Viewer. Two-point calibration on a known reference scale (stage micrometer or millimeter ruler), coordinate transformation from stage pixels to image pixels, pixelsPerMicrometer calculation with unit conversion (um, mm, cm, in), validation, low-precision warning (< 50 px), per-original-image calibration persistence in IndexedDB, and copy calibration across originals with confirmation line.
Step 4B (COMPLETED): Two-point measurement inside the existing Image Viewer for "Hair strand length" or "Shaft diameter", coordinate transformation, instant unit conversion (um, mm, cm, in) when calibrated, strict uncalibrated pixel-only estimation ("Estimate (uncalibrated, pixels only)"), measurement persistence with calibration snapshots in IndexedDB, measurement overlay visualization, and deletion.

**Step 5 — Observations and color sampling** — NOT STARTED
Regular mode: user selects a region; app reports the average color (real pixel math) and user picks visible pattern manually. Microscopic mode: manual checklists for cuticle, medulla (continuous / discontinuous / fragmented / absent / not clearly visible), cortex and pigmentation, root, tip. Each saved with a "Manually observed" label. Option for "Not observable".

**Step 6 — Annotation** — NOT STARTED
Simple annotation (arrow, circle, text note) saved on a separate annotated copy.

**Step 7 — Results page and history** — NOT STARTED
Organized results page: subject info, images, observations, measurements with calibration status, date/time of analysis, limitations, disclaimer. Examination history with view and delete.

**Step 8 — PDF export** — NOT STARTED
PDF report containing the results page content and the disclaimer. Verify the library choice with me first (rule 2).

**Step 9 — PWA install and final polish** — NOT STARTED
Web app manifest and service worker so it can be added to the home screen and run offline. Fix bugs, check mobile layout, write a short demo workflow and a Known Limitations section.

## 8. Priority if time runs short

Must have: Steps 1, 2, 4, 5, 7, 8. Cut first if behind: Step 6 (annotation), then Step 3 (crop), then offline support in Step 9. Tell me immediately if the schedule is at risk.

## 9. Known limitations (keep updated)

- Microscope compatibility depends on the user's device and hardware.
- Observations are manual; the app does not automatically classify microscopic structures.
- Measurements are only as accurate as the calibration reference and image quality.