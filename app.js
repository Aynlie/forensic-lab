/**
 * Educational Forensic Hair Examination Web App (PWA)
 * Step 1: Subject & Sample Management with IndexedDB
 * Step 2: Mode Selection, Camera/Upload Image Capture & Basic Quality Check
 * Pure Vanilla JavaScript - No external libraries
 */

(function () {
  'use strict';

  // --- IndexedDB Configuration ---
  const DB_NAME = 'ForensicHairExamDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'samples';

  let dbInstance = null;
  let pendingSampleData = null; // Holds validated form data awaiting confirmation
  let activeSample = null; // Currently active sample record undergoing examination
  let currentCameraStream = null; // Active MediaStream from camera
  let cameraFacingMode = 'environment'; // Preferred camera: 'environment' (back) or 'user' (front)
  let pendingImageData = null; // Holds captured/uploaded image data awaiting save as original

  /**
   * Initializes or opens the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbInstance) {
      return Promise.resolve(dbInstance);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          store.createIndex('sampleId', 'sampleId', { unique: false });
          store.createIndex('caseNumber', 'caseNumber', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = function (event) {
        reject(new Error('IndexedDB error: ' + (event.target.error ? event.target.error.message : event.target.error)));
      };
    });
  }

  /**
   * Saves or updates a sample record in IndexedDB.
   * Uses store.put so that both new and existing records are supported.
   * @param {Object} sampleRecord
   * @returns {Promise<number>} ID of saved record
   */
  function saveSampleToDB(sampleRecord) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(sampleRecord);

        request.onsuccess = function () {
          resolve(request.result);
        };

        request.onerror = function (event) {
          reject(new Error('Failed to save sample: ' + (event.target.error ? event.target.error.message : event.target.error)));
        };
      });
    });
  }

  /**
   * Retrieves a single sample record by numeric ID.
   * @param {number} id
   * @returns {Promise<Object|null>}
   */
  function getSampleByIdFromDB(id) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = function () {
          resolve(request.result || null);
        };

        request.onerror = function (event) {
          reject(new Error('Failed to retrieve sample: ' + (event.target.error ? event.target.error.message : event.target.error)));
        };
      });
    });
  }

  /**
   * Retrieves all saved sample records from IndexedDB in reverse chronological order.
   * @returns {Promise<Array>}
   */
  function getAllSamplesFromDB() {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = function () {
          const results = request.result || [];
          results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          resolve(results);
        };

        request.onerror = function (event) {
          reject(new Error('Failed to retrieve samples: ' + (event.target.error ? event.target.error.message : event.target.error)));
        };
      });
    });
  }

  // --- DOM Elements ---
  const views = {
    dashboard: document.getElementById('view-dashboard'),
    form: document.getElementById('view-form'),
    confirmation: document.getElementById('view-confirmation'),
    savedSamples: document.getElementById('view-saved-samples'),
    modeSelection: document.getElementById('view-mode-selection'),
    capture: document.getElementById('view-capture')
  };

  const statusBanner = document.getElementById('status-banner');

  // Dashboard buttons
  const btnNewExam = document.getElementById('btn-new-exam');
  const btnSavedSamples = document.getElementById('btn-saved-samples');

  // Form navigation and form
  const btnFormBack = document.getElementById('btn-form-back');
  const examForm = document.getElementById('examination-form');

  // Confirmation buttons & summary container
  const btnEditConfirmation = document.getElementById('btn-edit-confirmation');
  const btnConfirmSave = document.getElementById('btn-confirm-save');
  const confirmationDetails = document.getElementById('confirmation-details');

  // Saved samples navigation & list container
  const btnSavedBack = document.getElementById('btn-saved-back');
  const savedSamplesContainer = document.getElementById('saved-samples-container');

  // Form input references
  const formInputs = {
    subjectName: document.getElementById('subjectName'),
    caseNumber: document.getElementById('caseNumber'),
    sampleId: document.getElementById('sampleId'),
    age: document.getElementById('age'),
    sex: document.getElementById('sex'),
    collectionDate: document.getElementById('collectionDate'),
    collectionTime: document.getElementById('collectionTime'),
    collectionLocation: document.getElementById('collectionLocation'),
    collectedBy: document.getElementById('collectedBy'),
    sampleDescription: document.getElementById('sampleDescription'),
    additionalNotes: document.getElementById('additionalNotes')
  };

  // Step 2: Mode Selection Elements
  const modeSampleInfo = document.getElementById('mode-sample-info');
  const btnSelectRegular = document.getElementById('btn-select-regular');
  const btnSelectMicroscopic = document.getElementById('btn-select-microscopic');
  const btnModeDashboard = document.getElementById('btn-mode-dashboard');

  // Step 2: Capture & Upload Elements
  const btnCaptureBack = document.getElementById('btn-capture-back');
  const activeModeText = document.getElementById('active-mode-text');
  const captureSamplePill = document.getElementById('capture-sample-pill');
  const instructionsContent = document.getElementById('instructions-content');
  const btnOpenCamera = document.getElementById('btn-open-camera');
  const btnTriggerUpload = document.getElementById('btn-trigger-upload');
  const inputFileUpload = document.getElementById('input-file-upload');
  const fileDropZone = document.getElementById('file-drop-zone');

  // Step 2: Camera Viewfinder Section
  const cameraSection = document.getElementById('camera-section');
  const cameraError = document.getElementById('camera-error');
  const cameraVideo = document.getElementById('camera-video');
  const btnSwitchCamera = document.getElementById('btn-switch-camera');
  const btnSnapPhoto = document.getElementById('btn-snap-photo');
  const btnStopCamera = document.getElementById('btn-stop-camera');

  // Step 2: Analysis Canvas (hidden)
  const analysisCanvas = document.getElementById('analysis-canvas');

  // Step 2: Preview & Quality Check Elements
  const previewSection = document.getElementById('preview-section');
  const imagePreview = document.getElementById('image-preview');
  const qualityResVal = document.getElementById('quality-res-val');
  const qualityResBadge = document.getElementById('quality-res-badge');
  const qualityBrightVal = document.getElementById('quality-bright-val');
  const qualityBrightBadge = document.getElementById('quality-bright-badge');
  const qualityContrastVal = document.getElementById('quality-contrast-val');
  const qualityContrastBadge = document.getElementById('quality-contrast-badge');
  const qualityAdvisoryMsg = document.getElementById('quality-advisory-msg');
  const btnRetakeImage = document.getElementById('btn-retake-image');
  const btnSaveOriginal = document.getElementById('btn-save-original');

  // Step 2: Preserved Originals Elements
  const originalsGrid = document.getElementById('originals-grid');
  const btnFinishToDashboard = document.getElementById('btn-finish-to-dashboard');
  const btnFinishToSamples = document.getElementById('btn-finish-to-samples');

  // --- View Switching ---
  /**
   * Switches the active view.
   * @param {string} viewKey
   */
  function switchView(viewKey) {
    // When leaving capture view, ensure camera stream is released
    if (viewKey !== 'capture') {
      stopCamera();
    }

    Object.keys(views).forEach((key) => {
      const el = views[key];
      if (!el) return;
      if (key === viewKey) {
        el.removeAttribute('hidden');
        el.classList.add('active');
      } else {
        el.setAttribute('hidden', '');
        el.classList.remove('active');
      }
    });
    window.scrollTo(0, 0);
  }

  /**
   * Displays a temporary notification banner.
   * @param {string} message
   * @param {'success'|'error'} type
   */
  function showStatus(message, type = 'success') {
    statusBanner.textContent = message;
    statusBanner.className = 'status-banner ' + type;
    statusBanner.removeAttribute('hidden');

    setTimeout(() => {
      statusBanner.setAttribute('hidden', '');
    }, 4500);
  }

  /**
   * Generates a unique Sample ID if left blank by user.
   * Format: SMP-YYYYMMDD-XXXX
   * @returns {string}
   */
  function generateSampleId() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `SMP-${y}${m}${d}-${rand}`;
  }

  /**
   * Clears error states from all form fields.
   */
  function clearErrors() {
    const errorSpans = examForm.querySelectorAll('.error-msg');
    errorSpans.forEach((span) => {
      span.textContent = '';
    });
    const errorInputs = examForm.querySelectorAll('.input-error');
    errorInputs.forEach((input) => {
      input.classList.remove('input-error');
    });
  }

  /**
   * Displays a specific error message under an input field.
   * @param {string} fieldName
   * @param {string} message
   */
  function setError(fieldName, message) {
    const input = formInputs[fieldName];
    const errorSpan = document.getElementById(`error-${fieldName}`);
    if (input) {
      input.classList.add('input-error');
    }
    if (errorSpan) {
      errorSpan.textContent = message;
    }
  }

  /**
   * Validates required form fields.
   * @returns {boolean}
   */
  function validateForm() {
    clearErrors();
    let isValid = true;
    let firstInvalidField = null;

    if (!formInputs.subjectName.value.trim()) {
      setError('subjectName', 'Subject / Owner Name is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.subjectName;
    }

    if (!formInputs.caseNumber.value.trim()) {
      setError('caseNumber', 'Case Number is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.caseNumber;
    }

    if (!formInputs.collectionDate.value) {
      setError('collectionDate', 'Collection Date is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionDate;
    }

    if (!formInputs.collectionTime.value) {
      setError('collectionTime', 'Collection Time is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionTime;
    }

    if (!formInputs.collectionLocation.value.trim()) {
      setError('collectionLocation', 'Collection Location is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionLocation;
    }

    if (!formInputs.collectedBy.value.trim()) {
      setError('collectedBy', 'Collected By examiner name is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectedBy;
    }

    if (firstInvalidField) {
      firstInvalidField.focus();
    }

    return isValid;
  }

  /**
   * Populates default date and time if empty.
   */
  function prepopulateDateTimeIfEmpty() {
    const now = new Date();
    if (!formInputs.collectionDate.value) {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      formInputs.collectionDate.value = `${year}-${month}-${day}`;
    }
    if (!formInputs.collectionTime.value) {
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      formInputs.collectionTime.value = `${hours}:${minutes}`;
    }
  }

  /**
   * Renders the confirmation summary screen with entered values.
   * @param {Object} data
   */
  function renderConfirmationSummary(data) {
    const rows = [
      { label: 'Subject / Owner Name', value: data.subjectName + ' (User-provided)' },
      { label: 'Case Number', value: data.caseNumber },
      { label: 'Sample ID', value: data.sampleId },
      { label: 'Age', value: data.age ? `${data.age} years` : 'Not specified' },
      { label: 'Sex', value: data.sex || 'Not specified' },
      { label: 'Collection Date', value: data.collectionDate },
      { label: 'Collection Time', value: data.collectionTime },
      { label: 'Collection Location', value: data.collectionLocation },
      { label: 'Collected By', value: data.collectedBy },
      { label: 'Sample Description', value: data.sampleDescription || 'None provided' },
      { label: 'Additional Notes', value: data.additionalNotes || 'None provided' }
    ];

    let html = '';
    rows.forEach((row) => {
      html += `
        <div class="summary-row">
          <span class="summary-label">${escapeHtml(row.label)}</span>
          <span class="summary-value">${escapeHtml(row.value)}</span>
        </div>
      `;
    });

    confirmationDetails.innerHTML = html;
  }

  /**
   * Helper to escape HTML characters.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Step 2: Mode Selection & Image Capture Logic ---

  /**
   * Opens the Mode Selection view for the given sample record.
   * @param {Object} sample
   */
  function openModeSelectionView(sample) {
    activeSample = sample;
    if (!activeSample.images) {
      activeSample.images = { originals: [], annotated: [] };
    }

    modeSampleInfo.innerHTML = `
      <span><strong>Sample ID:</strong> ${escapeHtml(activeSample.sampleId)}</span>
      <span>&bull;</span>
      <span><strong>Case:</strong> ${escapeHtml(activeSample.caseNumber)}</span>
      <span>&bull;</span>
      <span><strong>Subject:</strong> ${escapeHtml(activeSample.subjectName)}</span>
    `;

    switchView('modeSelection');
  }

  /**
   * Sets the examination mode for the active sample and advances to Image Capture.
   * @param {'regular'|'microscopic'} mode
   */
  function setSampleMode(mode) {
    if (!activeSample) return;

    activeSample.mode = mode;
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        openCaptureView(activeSample);
      })
      .catch((err) => {
        showStatus('Error updating sample mode: ' + err.message, 'error');
      });
  }

  /**
   * Prepares and displays the Image Capture & Upload view for the active sample.
   * @param {Object} sample
   */
  function openCaptureView(sample) {
    activeSample = sample;

    // Rule 9: Make clear which mode is active
    const isMicro = activeSample.mode === 'microscopic';
    activeModeText.textContent = isMicro ? 'Microscopic Examination' : 'Regular Camera Examination';

    captureSamplePill.textContent = `Sample: ${activeSample.sampleId} | Case: ${activeSample.caseNumber}`;

    // Populate mode-specific positioning instructions
    renderPositioningInstructions(activeSample.mode);

    // Reset capture interface states
    clearPreview();
    stopCamera();

    // Render list of preserved original images
    renderSavedOriginals();

    switchView('capture');
  }

  /**
   * Renders standardized positioning instructions based on active examination mode.
   * @param {'regular'|'microscopic'} mode
   */
  function renderPositioningInstructions(mode) {
    if (mode === 'microscopic') {
      instructionsContent.innerHTML = `
        <p>Follow standard microscopic mount preparation guidelines before image capture:</p>
        <ol class="instructions-list">
          <li><strong>Specimen Mounting:</strong> Mount hair on a clean glass slide in an appropriate mounting medium (e.g., glycerol or Permount) under a coverslip to eliminate air bubble refraction.</li>
          <li><strong>Optical Alignment:</strong> Fasten the ocular camera adapter or align the phone/camera lens squarely with the phototube/eyepiece without optical tilt.</li>
          <li><strong>Substage Condenser:</strong> Stop down the aperture diaphragm to increase contrast along outer cuticle scale edges, or open slightly when documenting internal medulla structure.</li>
          <li><strong>Two-Plane Documentation:</strong> Capture images at two focal planes: (a) Surface plane to record cuticle scale imbrication, and (b) Mid-shaft axial plane to resolve cortical fusi, pigment granules, and medulla type.</li>
          <li><strong>Stage Micrometer:</strong> If calibrating in Step 4, capture a reference photomicrograph of a certified stage micrometer at this exact objective magnification.</li>
        </ol>
      `;
    } else {
      instructionsContent.innerHTML = `
        <p>Follow these standardized macroscopic positioning guidelines for photographic evidence:</p>
        <ol class="instructions-list">
          <li><strong>Contrasting Background:</strong> Lay the hair strand flat against a non-reflective, clean contrasting surface (e.g., bright white index card for dark hair, matte black backing for light or grey hair).</li>
          <li><strong>Straight Placement:</strong> Lay the strand straight without artificial stretching or elongation to preserve natural curl and wave characteristics.</li>
          <li><strong>Uniform Illumination:</strong> Use diffused daylight or even laboratory LED lighting. Avoid direct camera flash to eliminate blinding specular reflections.</li>
          <li><strong>Orthogonal Angle:</strong> Position the camera sensor directly parallel (90° perpendicular) to the specimen surface to avoid foreshortening and geometric distortion.</li>
          <li><strong>Calibration Scale:</strong> If taking physical measurements in Step 4, place a rigid millimeter (mm) ruler directly adjacent to the hair strand in the exact same focal plane.</li>
        </ol>
      `;
    }
  }

  /**
   * Starts camera stream with visible error handling.
   * Rule 11: Handle errors visibly (permission denied, unsupported browser, etc.)
   */
  function startCamera() {
    cameraError.setAttribute('hidden', '');
    cameraError.textContent = '';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraSection.removeAttribute('hidden');
      cameraError.textContent = 'Camera API is not supported in this browser or requires a secure HTTPS connection. Please use the "Upload Image File" option.';
      cameraError.removeAttribute('hidden');
      return;
    }

    const constraints = {
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        currentCameraStream = stream;
        cameraVideo.srcObject = stream;
        cameraSection.removeAttribute('hidden');
        cameraVideo.play().catch(() => {});
      })
      .catch((err) => {
        cameraSection.removeAttribute('hidden');
        let errorMsg = 'Unable to access device camera: ' + (err.message || err.name);

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMsg = 'Camera access was denied. Please allow camera permissions in your browser settings to take photos directly, or use the "Upload Image File" option.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          errorMsg = 'No camera found on this device. Please upload an image file from your device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          errorMsg = 'Camera hardware is currently in use or locked by another application. Please close other camera apps and retry.';
        } else if (err.name === 'OverconstrainedError') {
          // Fall back to any available video stream if facingMode constraint failed
          return navigator.mediaDevices.getUserMedia({ video: true, audio: false })
            .then((fallbackStream) => {
              currentCameraStream = fallbackStream;
              cameraVideo.srcObject = fallbackStream;
              cameraSection.removeAttribute('hidden');
              cameraVideo.play().catch(() => {});
            })
            .catch((fallbackErr) => {
              cameraError.textContent = 'Camera constraint error: ' + fallbackErr.message;
              cameraError.removeAttribute('hidden');
            });
        }

        cameraError.textContent = errorMsg;
        cameraError.removeAttribute('hidden');
      });
  }

  /**
   * Stops active camera stream and hides camera viewfinder.
   */
  function stopCamera() {
    if (currentCameraStream) {
      currentCameraStream.getTracks().forEach((track) => track.stop());
      currentCameraStream = null;
    }
    if (cameraVideo) {
      cameraVideo.srcObject = null;
    }
    if (cameraSection) {
      cameraSection.setAttribute('hidden', '');
    }
    if (cameraError) {
      cameraError.setAttribute('hidden', '');
    }
  }

  /**
   * Switches between front and rear cameras.
   */
  function switchCamera() {
    cameraFacingMode = (cameraFacingMode === 'environment') ? 'user' : 'environment';
    stopCamera();
    startCamera();
  }

  /**
   * Snaps a photograph from the active camera video feed onto the analysis canvas.
   */
  function snapPhoto() {
    if (!currentCameraStream || !cameraVideo.videoWidth) {
      showStatus('Camera feed not ready to capture snapshot.', 'error');
      return;
    }

    const w = cameraVideo.videoWidth;
    const h = cameraVideo.videoHeight;

    analysisCanvas.width = w;
    analysisCanvas.height = h;
    const ctx = analysisCanvas.getContext('2d');
    ctx.drawImage(cameraVideo, 0, 0, w, h);

    const dataUrl = analysisCanvas.toDataURL('image/jpeg', 0.92);
    const fileName = `cam_capture_${Date.now()}.jpg`;

    stopCamera();
    processAndPreviewImage(dataUrl, fileName);
  }

  /**
   * Analyzes image quality using real canvas pixel math and displays preview.
   * Rule 3: Never produce fake, random, or hardcoded analysis results.
   * @param {string} dataUrl
   * @param {string} fileName
   */
  function processAndPreviewImage(dataUrl, fileName) {
    const img = new Image();
    img.onload = function () {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;

      // 1. Resolution Check
      const minDimension = Math.min(naturalWidth, naturalHeight);
      let resBadgeText = 'Adequate';
      let resBadgeClass = 'badge-pass';

      if (naturalWidth < 800 || naturalHeight < 600) {
        resBadgeText = 'Low Resolution';
        resBadgeClass = 'badge-warn';
      }

      // 2. Exposure & Contrast Calculation (Real Pixel Math)
      // Scale analysis image to max 400px dimension for responsive performance without freezing UI
      const maxDim = 400;
      const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
      const sw = Math.round(naturalWidth * scale);
      const sh = Math.round(naturalHeight * scale);

      analysisCanvas.width = sw;
      analysisCanvas.height = sh;
      const ctx = analysisCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, sw, sh);

      const imgData = ctx.getImageData(0, 0, sw, sh).data;
      const pixelCount = sw * sh;

      let totalLuminance = 0;
      const lumArray = new Float32Array(pixelCount);

      // ITU-R Rec. 601 standard luminance: Y = 0.299*R + 0.587*G + 0.114*B
      for (let i = 0, j = 0; i < imgData.length; i += 4, j++) {
        const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
        lumArray[j] = lum;
        totalLuminance += lum;
      }

      const avgLuminance = Math.round(totalLuminance / pixelCount);

      // Standard deviation of luminance for contrast evaluation
      let sumSqDiff = 0;
      for (let j = 0; j < pixelCount; j++) {
        const diff = lumArray[j] - avgLuminance;
        sumSqDiff += diff * diff;
      }
      const contrastStdDev = Math.round(Math.sqrt(sumSqDiff / pixelCount));

      // Exposure status categorization
      let brightBadgeText = 'Optimal';
      let brightBadgeClass = 'badge-pass';
      if (avgLuminance < 40) {
        brightBadgeText = 'Underexposed (Dark)';
        brightBadgeClass = 'badge-fail';
      } else if (avgLuminance < 70) {
        brightBadgeText = 'Low Light';
        brightBadgeClass = 'badge-warn';
      } else if (avgLuminance > 225) {
        brightBadgeText = 'Overexposed (Blown)';
        brightBadgeClass = 'badge-fail';
      } else if (avgLuminance > 190) {
        brightBadgeText = 'High Brightness';
        brightBadgeClass = 'badge-warn';
      }

      // Contrast status categorization
      let contrastBadgeText = 'Good Contrast';
      let contrastBadgeClass = 'badge-pass';
      if (contrastStdDev < 20) {
        contrastBadgeText = 'Low Contrast / Flat';
        contrastBadgeClass = 'badge-warn';
      }

      // Educational quality advisory notes
      const advisories = [];
      if (naturalWidth < 800 || naturalHeight < 600) {
        advisories.push('Image resolution is lower than standard recommended (800x600); fine cuticle imbrications may appear pixelated.');
      }
      if (avgLuminance < 40) {
        advisories.push('Image appears underexposed; dark regions may obscure cortex structure and melanin distribution.');
      }
      if (avgLuminance > 225) {
        advisories.push('Image highlights appear overexposed; bright spots may wash out translucent cuticle boundaries.');
      }
      if (contrastStdDev < 20) {
        advisories.push('Contrast is low; consider adjusting slide illumination, stopping down condenser, or using contrasting background.');
      }
      if (advisories.length === 0) {
        advisories.push('Image metrics satisfy standard educational laboratory criteria for forensic hair examination.');
      }

      // Update UI preview & quality assessment card
      imagePreview.src = dataUrl;
      qualityResVal.textContent = `${naturalWidth} × ${naturalHeight} px`;
      qualityResBadge.textContent = resBadgeText;
      qualityResBadge.className = 'metric-badge ' + resBadgeClass;

      qualityBrightVal.textContent = `${avgLuminance} / 255`;
      qualityBrightBadge.textContent = brightBadgeText;
      qualityBrightBadge.className = 'metric-badge ' + brightBadgeClass;

      qualityContrastVal.textContent = `σ = ${contrastStdDev}`;
      qualityContrastBadge.textContent = contrastBadgeText;
      qualityContrastBadge.className = 'metric-badge ' + contrastBadgeClass;

      qualityAdvisoryMsg.textContent = advisories.join(' ');

      // Store pending image data in memory
      pendingImageData = {
        dataUrl: dataUrl,
        fileName: fileName,
        quality: {
          width: naturalWidth,
          height: naturalHeight,
          resolution: `${naturalWidth}x${naturalHeight}`,
          avgLuminance: avgLuminance,
          contrastStdDev: contrastStdDev,
          advisory: advisories.join(' ')
        }
      };

      previewSection.removeAttribute('hidden');
      previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    img.onerror = function () {
      showStatus('Failed to load image for quality assessment.', 'error');
    };

    img.src = dataUrl;
  }

  /**
   * Clears the image preview and resets file input.
   */
  function clearPreview() {
    previewSection.setAttribute('hidden', '');
    imagePreview.src = '';
    inputFileUpload.value = '';
    pendingImageData = null;
  }

  /**
   * Saves the acquired image as an original copy in IndexedDB.
   * Rule 10: Original images must be saved separately and never overwritten.
   */
  function saveOriginalImage() {
    if (!activeSample) {
      showStatus('No active sample selected.', 'error');
      return;
    }

    if (!pendingImageData) {
      showStatus('No acquired image to save.', 'error');
      return;
    }

    if (!activeSample.images) {
      activeSample.images = { originals: [], annotated: [] };
    }
    if (!Array.isArray(activeSample.images.originals)) {
      activeSample.images.originals = [];
    }

    const originalRecord = {
      id: 'orig_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000),
      fileName: pendingImageData.fileName,
      mode: activeSample.mode,
      dataUrl: pendingImageData.dataUrl,
      capturedAt: new Date().toISOString(),
      quality: pendingImageData.quality
    };

    activeSample.images.originals.push(originalRecord);
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        showStatus(`Original image [${originalRecord.fileName}] preserved and saved.`, 'success');
        clearPreview();
        renderSavedOriginals();
      })
      .catch((err) => {
        showStatus('Error saving image to IndexedDB: ' + err.message, 'error');
      });
  }

  /**
   * Renders preserved original images for the active sample.
   * Rule 10: Original images saved separately and never overwritten.
   */
  function renderSavedOriginals() {
    if (!activeSample || !activeSample.images || !activeSample.images.originals || activeSample.images.originals.length === 0) {
      originalsGrid.innerHTML = '<p style="color: var(--color-text-muted); font-size: 0.85rem; padding: 10px 0;">No original images saved yet for this sample.</p>';
      return;
    }

    let html = '';
    activeSample.images.originals.forEach((orig, index) => {
      const dateStr = new Date(orig.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const modeLabel = orig.mode === 'microscopic' ? 'Micro' : 'Regular';
      html += `
        <div class="original-item">
          <span class="original-stamp">ORIGINAL #${index + 1}</span>
          <img src="${orig.dataUrl}" alt="Original capture ${index + 1}">
          <div class="original-meta">
            <div><strong>${modeLabel}</strong> &bull; ${escapeHtml(dateStr)}</div>
            <div>${escapeHtml(orig.quality ? orig.quality.resolution : 'Raw')}</div>
          </div>
        </div>
      `;
    });

    originalsGrid.innerHTML = html;
  }

  /**
   * Loads and renders saved records from IndexedDB.
   */
  function loadSavedSamples() {
    savedSamplesContainer.innerHTML = '<div class="empty-state"><p>Loading saved records...</p></div>';

    getAllSamplesFromDB()
      .then((samples) => {
        if (!samples || samples.length === 0) {
          savedSamplesContainer.innerHTML = `
            <div class="empty-state">
              <p>No saved examination records found in local IndexedDB storage.</p>
              <button type="button" class="btn btn-primary" id="btn-empty-new-exam">Start New Examination</button>
            </div>
          `;
          const emptyNewBtn = document.getElementById('btn-empty-new-exam');
          if (emptyNewBtn) {
            emptyNewBtn.addEventListener('click', () => {
              clearErrors();
              examForm.reset();
              prepopulateDateTimeIfEmpty();
              switchView('form');
            });
          }
          return;
        }

        let html = '';
        samples.forEach((sample) => {
          const originalCount = (sample.images && sample.images.originals) ? sample.images.originals.length : 0;
          const modeLabel = sample.mode
            ? (sample.mode === 'microscopic' ? 'Microscopic Examination' : 'Regular Camera Examination')
            : 'Not yet selected';

          html += `
            <article class="sample-item">
              <div class="sample-item-header">
                <span class="sample-item-id">${escapeHtml(sample.sampleId)}</span>
                <span class="sample-item-case">Case: ${escapeHtml(sample.caseNumber)}</span>
              </div>
              <div class="sample-field"><strong>Subject / Owner:</strong> ${escapeHtml(sample.subjectName)} <small>(User-provided)</small></div>
              <div class="sample-field"><strong>Active Mode:</strong> ${escapeHtml(modeLabel)}</div>
              <div class="sample-field"><strong>Collection:</strong> ${escapeHtml(sample.collectionDate)} at ${escapeHtml(sample.collectionTime)}</div>
              <div class="sample-field"><strong>Location:</strong> ${escapeHtml(sample.collectionLocation)}</div>
              <div class="sample-field"><strong>Collected By:</strong> ${escapeHtml(sample.collectedBy)}</div>
              ${sample.age || sample.sex ? `<div class="sample-field"><strong>Subject Demographics:</strong> ${sample.age ? escapeHtml(String(sample.age)) + ' yrs' : ''} ${sample.sex ? '(' + escapeHtml(sample.sex) + ')' : ''}</div>` : ''}
              ${sample.sampleDescription ? `<div class="sample-field"><strong>Description:</strong> ${escapeHtml(sample.sampleDescription)}</div>` : ''}
              ${sample.additionalNotes ? `<div class="sample-notes">${escapeHtml(sample.additionalNotes)}</div>` : ''}
              <div class="sample-field" style="margin-top: 8px;"><strong>Preserved Originals:</strong> ${originalCount} image(s)</div>
              <div class="sample-actions">
                <button type="button" class="btn btn-primary btn-sm btn-open-sample" data-sample-id="${sample.id}">
                  Open / Capture Images &rarr;
                </button>
              </div>
            </article>
          `;
        });

        savedSamplesContainer.innerHTML = html;
      })
      .catch((err) => {
        savedSamplesContainer.innerHTML = `
          <div class="empty-state">
            <p style="color: var(--color-danger);">Error reading from IndexedDB: ${escapeHtml(err.message)}</p>
          </div>
        `;
      });
  }

  // --- Event Listeners ---

  // Dashboard -> New Examination
  btnNewExam.addEventListener('click', () => {
    clearErrors();
    examForm.reset();
    prepopulateDateTimeIfEmpty();
    switchView('form');
  });

  // Dashboard -> Saved Samples
  btnSavedSamples.addEventListener('click', () => {
    loadSavedSamples();
    switchView('savedSamples');
  });

  // Form -> Back to Dashboard
  btnFormBack.addEventListener('click', () => {
    switchView('dashboard');
  });

  // Clear specific error on input typing
  Object.keys(formInputs).forEach((key) => {
    const input = formInputs[key];
    if (!input) return;
    input.addEventListener('input', () => {
      input.classList.remove('input-error');
      const errSpan = document.getElementById(`error-${key}`);
      if (errSpan) {
        errSpan.textContent = '';
      }
    });
  });

  // Form -> Submit (Review)
  examForm.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Auto-generate sampleId if empty
    let finalSampleId = formInputs.sampleId.value.trim();
    if (!finalSampleId) {
      finalSampleId = generateSampleId();
      formInputs.sampleId.value = finalSampleId; // reflect in input so "Edit" preserves it
    }

    pendingSampleData = {
      subjectName: formInputs.subjectName.value.trim(),
      caseNumber: formInputs.caseNumber.value.trim(),
      sampleId: finalSampleId,
      age: formInputs.age.value ? parseInt(formInputs.age.value, 10) : null,
      sex: formInputs.sex.value || null,
      collectionDate: formInputs.collectionDate.value,
      collectionTime: formInputs.collectionTime.value,
      collectionLocation: formInputs.collectionLocation.value.trim(),
      collectedBy: formInputs.collectedBy.value.trim(),
      sampleDescription: formInputs.sampleDescription.value.trim(),
      additionalNotes: formInputs.additionalNotes.value.trim(),
      createdAt: new Date().toISOString()
    };

    renderConfirmationSummary(pendingSampleData);
    switchView('confirmation');
  });

  // Confirmation -> Edit (return to form with values preserved)
  btnEditConfirmation.addEventListener('click', () => {
    switchView('form');
  });

  // Confirmation -> Confirm (save to IndexedDB and proceed to Step 2 Mode Selection)
  btnConfirmSave.addEventListener('click', () => {
    if (!pendingSampleData) {
      switchView('dashboard');
      return;
    }

    const newRecord = {
      ...pendingSampleData,
      mode: null,
      images: { originals: [], annotated: [] },
      calibration: null,
      measurements: [],
      observations: [],
      createdAt: pendingSampleData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveSampleToDB(newRecord)
      .then((recordId) => {
        newRecord.id = recordId;
        activeSample = newRecord;
        pendingSampleData = null;
        examForm.reset();
        showStatus(`Sample [${newRecord.sampleId}] registered. Please select examination mode.`, 'success');
        openModeSelectionView(activeSample);
      })
      .catch((err) => {
        showStatus('Error saving sample: ' + err.message, 'error');
      });
  });

  // Step 2: Mode Selection buttons
  btnSelectRegular.addEventListener('click', () => {
    setSampleMode('regular');
  });

  btnSelectMicroscopic.addEventListener('click', () => {
    setSampleMode('microscopic');
  });

  btnModeDashboard.addEventListener('click', () => {
    switchView('dashboard');
  });

  // Step 2: Capture View navigation
  btnCaptureBack.addEventListener('click', () => {
    stopCamera();
    clearPreview();
    if (activeSample) {
      openModeSelectionView(activeSample);
    } else {
      switchView('dashboard');
    }
  });

  // Step 2: Camera Controls
  btnOpenCamera.addEventListener('click', () => {
    startCamera();
  });

  btnStopCamera.addEventListener('click', () => {
    stopCamera();
  });

  btnSwitchCamera.addEventListener('click', () => {
    switchCamera();
  });

  btnSnapPhoto.addEventListener('click', () => {
    snapPhoto();
  });

  // Step 2: Gallery / File Upload
  btnTriggerUpload.addEventListener('click', () => {
    stopCamera();
    inputFileUpload.click();
  });

  inputFileUpload.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showStatus('Selected file is not a supported image format. Please select a JPEG, PNG, or WebP file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      processAndPreviewImage(event.target.result, file.name);
    };
    reader.onerror = function () {
      showStatus('Error reading image file from disk.', 'error');
    };
    reader.readAsDataURL(file);
  });

  // Step 2: Drag and drop support on drop zone
  fileDropZone.addEventListener('click', () => {
    stopCamera();
    inputFileUpload.click();
  });

  fileDropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      stopCamera();
      inputFileUpload.click();
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    fileDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileDropZone.classList.remove('dragover');
    });
  });

  fileDropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt && dt.files && dt.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showStatus('Dropped file is not a supported image format.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (event) {
      processAndPreviewImage(event.target.result, file.name);
    };
    reader.onerror = function () {
      showStatus('Error reading dropped image file.', 'error');
    };
    reader.readAsDataURL(file);
  });

  // Step 2: Retake and Save Original Actions
  btnRetakeImage.addEventListener('click', () => {
    clearPreview();
  });

  btnSaveOriginal.addEventListener('click', () => {
    saveOriginalImage();
  });

  btnFinishToDashboard.addEventListener('click', () => {
    stopCamera();
    switchView('dashboard');
  });

  btnFinishToSamples.addEventListener('click', () => {
    stopCamera();
    loadSavedSamples();
    switchView('savedSamples');
  });

  // Saved Samples list: delegated click to open examination for sample
  savedSamplesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-open-sample');
    if (!btn) return;

    const sampleId = parseInt(btn.getAttribute('data-sample-id'), 10);
    getSampleByIdFromDB(sampleId)
      .then((sample) => {
        if (!sample) {
          showStatus('Sample record not found in IndexedDB.', 'error');
          return;
        }
        activeSample = sample;
        if (!activeSample.images) {
          activeSample.images = { originals: [], annotated: [] };
        }
        openModeSelectionView(activeSample);
      })
      .catch((err) => {
        showStatus('Error opening sample: ' + err.message, 'error');
      });
  });

  // Saved Samples -> Back to Dashboard
  btnSavedBack.addEventListener('click', () => {
    switchView('dashboard');
  });

  // Initialize DB eagerly on page load
  openDB().catch((err) => {
    console.error('Error pre-initializing IndexedDB:', err);
  });
})();
