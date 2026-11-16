/**
 * Educational Forensic Hair Examination Web App (PWA)
 * Step 1: Subject & Sample Management with IndexedDB
 * Step 2: Mode Selection, Camera/Upload Image Capture & Basic Quality Check
 * Step 3: Image Viewer (zoom and pan only, display-only; crop postponed)
 * Step 4A: Calibration inside Image Viewer (two-point reference calibration)
 * Step 4B: Measurements inside Image Viewer (two-point length & shaft diameter)
 * Pure Vanilla JavaScript - No external libraries
 */

(function () {
  'use strict';

  // --- IndexedDB Configuration ---
  const DB_NAME = 'ForensicHairExamDB';
  const DB_VERSION = 2; // Bumped to 2: drop base64 records, store Blobs instead
  const STORE_NAME = 'samples';

  let dbInstance = null;
  let pendingSampleData = null; // Holds validated form data awaiting confirmation
  let activeSample = null; // Currently active sample record undergoing examination
  let currentCameraStream = null; // Active MediaStream from camera
  let cameraFacingMode = 'environment'; // Preferred camera: 'environment' (back) or 'user' (front)
  let pendingImageData = null; // Holds captured/uploaded image Blob awaiting save as original
  let pendingPreviewUrl = null; // Object URL for the current preview; revoked on clear

  /**
   * Initializes or opens the IndexedDB database.
   * Re-opens if the cached connection was closed by a version-change event.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    // Re-use the cached connection only if it is still open.
    // A closed connection has no object store names accessible; checking the
    // name property is a lightweight way to detect an invalidated handle.
    if (dbInstance) {
      try {
        // Accessing objectStoreNames throws on a closed connection in some browsers;
        // in others the name list is simply empty. Either way, re-open if closed.
        void dbInstance.objectStoreNames;
        return Promise.resolve(dbInstance);
      } catch (_) {
        dbInstance = null;
      }
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        // Drop existing store on upgrade so old base64 records are cleared cleanly
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('sampleId', 'sampleId', { unique: false });
        store.createIndex('caseNumber', 'caseNumber', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      };

      request.onsuccess = function (event) {
        dbInstance = event.target.result;

        // Another tab upgraded the DB while this one held the connection.
        // Close immediately and reload so this tab gets the new schema.
        dbInstance.onversionchange = function () {
          dbInstance.close();
          dbInstance = null;
          window.location.reload();
        };

        resolve(dbInstance);
      };

      request.onerror = function (event) {
        reject(new Error('IndexedDB error: ' + (event.target.error ? event.target.error.message : event.target.error)));
      };

      // Fired when this open request is blocked by another tab that holds the
      // old-version connection and has not yet closed it.
      request.onblocked = function () {
        showStatus('Close other tabs of this app and reload.', 'error');
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
    capture: document.getElementById('view-capture'),
    viewer: document.getElementById('view-viewer')
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

    const fileName = `cam_capture_${Date.now()}.jpg`;

    // toBlob is async; stop camera and pass Blob directly (no base64 conversion)
    analysisCanvas.toBlob(function (blob) {
      if (!blob) {
        showStatus('Failed to capture image from camera.', 'error');
        return;
      }
      stopCamera();
      processAndPreviewImage(blob, fileName);
    }, 'image/jpeg', 0.92);
  }

  /**
   * Analyzes image quality using real canvas pixel math and displays preview.
   * Rule 3: Never produce fake, random, or hardcoded analysis results.
   * @param {Blob} blob  - Image Blob from file input, drag-drop, or canvas.toBlob
   * @param {string} fileName
   */
  function processAndPreviewImage(blob, fileName) {
    // Create an object URL for preview and quality analysis; revoke only on clearPreview
    const previewUrl = URL.createObjectURL(blob);
    pendingPreviewUrl = previewUrl;

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
      imagePreview.src = previewUrl;
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

      // Store pending image Blob in memory (not base64)
      pendingImageData = {
        blob: blob,
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

    img.src = previewUrl;
  }

  /**
   * Clears the image preview and resets file input.
   */
  function clearPreview() {
    previewSection.setAttribute('hidden', '');
    imagePreview.src = '';
    inputFileUpload.value = '';
    // Revoke the preview object URL to free memory
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = null;
    }
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
      blob: pendingImageData.blob, // Stored as Blob, not base64 string
      capturedAt: new Date().toISOString(),
      quality: pendingImageData.quality,
      calibration: null
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
      const calBadge = orig.calibration
        ? '<span class="thumb-cal-badge calibrated">Calibrated</span>'
        : '<span class="thumb-cal-badge">Uncalibrated</span>';
      html += `
        <div class="original-item">
          <span class="original-stamp">ORIGINAL #${index + 1}</span>
          <img class="orig-thumb" data-orig-index="${index}" alt="Original capture ${index + 1}">
          <div class="original-meta">
            <div><strong>${modeLabel}</strong> &bull; ${escapeHtml(dateStr)}</div>
            <div>${escapeHtml(orig.quality ? orig.quality.resolution : 'Raw')}</div>
            <div class="meta-cal-row">${calBadge}</div>
          </div>
        </div>
      `;
    });

    originalsGrid.innerHTML = html;

    // Set thumbnail src via object URLs after innerHTML is set (allows onload revocation)
    originalsGrid.querySelectorAll('img.orig-thumb').forEach(function (imgEl) {
      const idx = parseInt(imgEl.getAttribute('data-orig-index'), 10);
      const orig = activeSample.images.originals[idx];
      if (orig && orig.blob) {
        const url = URL.createObjectURL(orig.blob);
        imgEl.onload = function () { URL.revokeObjectURL(url); };
        imgEl.onerror = function () { URL.revokeObjectURL(url); };
        imgEl.src = url;
      }
    });
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

  // --- Step 3: Image Viewer, Step 4A: Calibration & Step 4B: Measurements ---
  // The viewer displays a stored original image without modifying the image Blob (Rule 10).
  // Calibration records the physical scale (pixelsPerMicrometer) on each original image's record.
  // Measurements record morphological dimensions (hair length & shaft diameter) with calibration snapshots.

  const viewerStage = document.getElementById('viewer-stage');
  const viewerImage = document.getElementById('viewer-image');
  const viewerOverlay = document.getElementById('viewer-overlay');
  const viewerInfo = document.getElementById('viewer-info');
  const viewerZoomLabel = document.getElementById('viewer-zoom-label');
  const btnViewerBack = document.getElementById('btn-viewer-back');
  const btnViewerZoomIn = document.getElementById('btn-viewer-zoom-in');
  const btnViewerZoomOut = document.getElementById('btn-viewer-zoom-out');
  const btnViewerReset = document.getElementById('btn-viewer-reset');
  const btnViewerCalibrate = document.getElementById('btn-viewer-calibrate');
  const btnViewerMeasure = document.getElementById('btn-viewer-measure');

  // Calibration status and action elements
  const calibrationStatusCard = document.getElementById('calibration-status-card');
  const calibrationPill = document.getElementById('calibration-pill');
  const calibrationStatusText = document.getElementById('calibration-status-text');
  const calibrationDetails = document.getElementById('calibration-details');
  const btnRecalibrate = document.getElementById('btn-recalibrate');
  const btnClearCalibration = document.getElementById('btn-clear-calibration');
  const btnCopyCalibration = document.getElementById('btn-copy-calibration');

  // Calibration interactive prompt elements
  const calibrationPromptBanner = document.getElementById('calibration-prompt-banner');
  const calibrationPromptStep = document.getElementById('calibration-prompt-step');
  const btnResetPoints = document.getElementById('btn-reset-points');
  const btnCancelCalibration = document.getElementById('btn-cancel-calibration');

  // Calibration form elements
  const calibrationForm = document.getElementById('calibration-form');
  const calibrationWarning = document.getElementById('calibration-warning');
  const calKnownLengthInput = document.getElementById('cal-known-length');
  const calUnitSelect = document.getElementById('cal-unit');
  const calReferenceLabelInput = document.getElementById('cal-reference-label');
  const calMeasuredDistance = document.getElementById('cal-measured-distance');
  const errorCalKnownLength = document.getElementById('error-cal-known-length');
  const btnCancelCalForm = document.getElementById('btn-cancel-cal-form');
  const btnRetapPoints = document.getElementById('btn-retap-points');

  // Copy calibration panel elements
  const copyCalibrationPanel = document.getElementById('copy-calibration-panel');
  const copyCalibrationSource = document.getElementById('copy-calibration-source');
  const btnCancelCopy = document.getElementById('btn-cancel-copy');
  const btnConfirmCopy = document.getElementById('btn-confirm-copy');

  // Step 4B: Measurement interactive prompt elements
  const measurePromptBanner = document.getElementById('measure-prompt-banner');
  const measurePromptStep = document.getElementById('measure-prompt-step');
  const btnResetMeasPoints = document.getElementById('btn-reset-meas-points');
  const btnCancelMeasure = document.getElementById('btn-cancel-measure');

  // Step 4B: Measurement form elements
  const measurementForm = document.getElementById('measurement-form');
  const formMeasureLabelPill = document.getElementById('form-measure-label-pill');
  const measureTypeSelect = document.getElementById('measure-type');
  const measureUnitGroup = document.getElementById('measure-unit-group');
  const measureDisplayUnitSelect = document.getElementById('measure-display-unit');
  const measureValMain = document.getElementById('measure-val-main');
  const measureValSub = document.getElementById('measure-val-sub');
  const measureNoteInput = document.getElementById('measure-note');
  const btnCancelMeasForm = document.getElementById('btn-cancel-meas-form');
  const btnRetapMeasPoints = document.getElementById('btn-retap-meas-points');

  // Step 4B: Measurements list card elements
  const measurementsCard = document.getElementById('measurements-card');
  const measurementsCountBadge = document.getElementById('measurements-count-badge');
  const measurementsListContainer = document.getElementById('measurements-list-container');

  const VIEWER_MAX_SCALE = 8;     // up to 8 screen pixels per image pixel
  const VIEWER_BUTTON_STEP = 1.5; // zoom factor for the Zoom In / Zoom Out buttons
  const VIEWER_WHEEL_STEP = 1.15; // zoom factor per mouse wheel notch

  let currentViewerOrigIndex = -1; // index of currently open original in activeSample.images.originals
  let pinchOccurredInViewer = false;

  // Rule: Only one tool mode can be active at a time ('none' | 'calibrate' | 'measure')
  let activeViewerTool = 'none';

  const calibrationState = {
    isCalibrating: false, // true when user is placing calibration points
    points: []            // points in original natural image pixel coordinates: [{ x, y }]
  };

  const measurementState = {
    isMeasuring: false, // true when user is placing measurement points
    points: [],         // points in original natural image pixel coordinates: [{ x, y }]
    currentDist: 0      // measured pixel distance between points
  };

  // State object mapping screen points to image pixels
  const viewerState = {
    url: null,      // object URL of the image being shown
    natW: 0,        // natural image width in pixels
    natH: 0,        // natural image height in pixels
    baseScale: 1,   // scale at which the whole image fits inside the stage
    scale: 1,       // current scale (screen pixels per image pixel)
    tx: 0,          // image left edge, in stage pixels
    ty: 0           // image top edge, in stage pixels
  };

  const viewerPointers = new Map(); // active pointers: id -> { startX, startY, x, y, maxMove, isDrag }

  /** Keeps the image inside the stage: centered if smaller, edge-limited if larger. */
  function viewerClamp() {
    const sw = viewerStage.clientWidth;
    const sh = viewerStage.clientHeight;
    const iw = viewerState.natW * viewerState.scale;
    const ih = viewerState.natH * viewerState.scale;
    viewerState.tx = iw <= sw ? (sw - iw) / 2 : Math.min(0, Math.max(sw - iw, viewerState.tx));
    viewerState.ty = ih <= sh ? (sh - ih) / 2 : Math.min(0, Math.max(sh - ih, viewerState.ty));
  }

  /** Applies the current scale and position to the displayed image and updates overlay. */
  function viewerApply() {
    viewerClamp();
    viewerImage.style.transform =
      'translate(' + viewerState.tx + 'px, ' + viewerState.ty + 'px) scale(' + viewerState.scale + ')';
    viewerZoomLabel.textContent = (viewerState.scale / viewerState.baseScale).toFixed(1) + 'x';
    renderViewerOverlay();
  }

  /** Fits the whole image inside the stage (also used by Reset). */
  function viewerFit() {
    const sw = viewerStage.clientWidth;
    const sh = viewerStage.clientHeight;
    if (!viewerState.natW || !viewerState.natH || !sw || !sh) return;
    viewerState.baseScale = Math.min(sw / viewerState.natW, sh / viewerState.natH);
    viewerState.scale = viewerState.baseScale;
    viewerApply();
  }

  /** Zooms by a factor around a point given in stage pixels. */
  function viewerZoomAt(factor, cx, cy) {
    const minScale = viewerState.baseScale;
    const maxScale = Math.max(VIEWER_MAX_SCALE, viewerState.baseScale);
    const newScale = Math.min(maxScale, Math.max(minScale, viewerState.scale * factor));
    const ratio = newScale / viewerState.scale;
    viewerState.tx = cx - (cx - viewerState.tx) * ratio;
    viewerState.ty = cy - (cy - viewerState.ty) * ratio;
    viewerState.scale = newScale;
    viewerApply();
  }

  /** Midpoint and distance between the two active pointers (for pinch). */
  function viewerPinchInfo() {
    const pts = Array.from(viewerPointers.values());
    const a = pts[0];
    const b = pts[1];
    return {
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y)
    };
  }

  /** Sensible rounding for hair measurement values according to unit. */
  function formatMeasurementValue(value, unit) {
    if (value == null || isNaN(value)) return '0';
    if (unit === 'um') {
      if (value >= 1000) return value.toFixed(1);
      if (value >= 10) return value.toFixed(2);
      if (value >= 1) return value.toFixed(2);
      return value.toFixed(3);
    }
    if (unit === 'mm') {
      if (value >= 100) return value.toFixed(1);
      if (value >= 1) return value.toFixed(2);
      return value.toFixed(3);
    }
    if (unit === 'cm') {
      if (value >= 10) return value.toFixed(2);
      return value.toFixed(3);
    }
    if (unit === 'in') {
      if (value >= 10) return value.toFixed(2);
      return value.toFixed(3);
    }
    return value.toFixed(1);
  }

  /**
   * Renders overlay lines and markers onto the SVG overlay.
   * Visual markers and line thickness stay at constant screen size during zoom/pan.
   * Renders:
   * 1. Saved measurements for the open image (emerald for calibrated, amber for estimate)
   * 2. In-progress measurement points and line
   * 3. Calibration reference points and line
   */
  function renderViewerOverlay() {
    if (!viewerOverlay) return;

    const sw = viewerStage.clientWidth;
    const sh = viewerStage.clientHeight;
    if (!sw || !sh) return;
    viewerOverlay.setAttribute('viewBox', '0 0 ' + sw + ' ' + sh);

    let svgHtml = '';

    // 1. Saved measurements for the open original image
    if (activeSample && Array.isArray(activeSample.measurements) && currentViewerOrigIndex >= 0) {
      const orig = activeSample.images && activeSample.images.originals ? activeSample.images.originals[currentViewerOrigIndex] : null;
      if (orig) {
        const imageMeasurements = activeSample.measurements.filter((m) => m.imageId === orig.id);
        imageMeasurements.forEach((m) => {
          if (!Array.isArray(m.points) || m.points.length !== 2) return;
          const s1x = viewerState.tx + m.points[0].x * viewerState.scale;
          const s1y = viewerState.ty + m.points[0].y * viewerState.scale;
          const s2x = viewerState.tx + m.points[1].x * viewerState.scale;
          const s2y = viewerState.ty + m.points[1].y * viewerState.scale;

          const isCalibrated = m.valueUm !== null;
          const strokeColor = isCalibrated ? '#10b981' : '#f59e0b';
          const dashAttr = isCalibrated ? '' : 'stroke-dasharray="4,2"';

          // Dark halo shadow for universal contrast
          svgHtml += '<line x1="' + s1x + '" y1="' + s1y + '" x2="' + s2x + '" y2="' + s2y + '" stroke="#0f172a" stroke-width="4" stroke-linecap="round" opacity="0.75" />';
          // Main measurement line
          svgHtml += '<line x1="' + s1x + '" y1="' + s1y + '" x2="' + s2x + '" y2="' + s2y + '" stroke="' + strokeColor + '" stroke-width="2" stroke-linecap="round" ' + dashAttr + ' />';

          // Terminal endpoints
          svgHtml += '<circle cx="' + s1x + '" cy="' + s1y + '" r="3.5" fill="' + strokeColor + '" stroke="#ffffff" stroke-width="1"/>';
          svgHtml += '<circle cx="' + s2x + '" cy="' + s2y + '" r="3.5" fill="' + strokeColor + '" stroke="#ffffff" stroke-width="1"/>';

          // Midpoint badge
          const mx = (s1x + s2x) / 2;
          const my = (s1y + s2y) / 2;
          const shortType = m.type === 'Shaft diameter' ? 'Dia' : 'Len';
          let labelText = '';

          if (isCalibrated) {
            let val = m.valueUm;
            if (m.displayUnit === 'mm') val = m.valueUm / 1000;
            else if (m.displayUnit === 'cm') val = m.valueUm / 10000;
            else if (m.displayUnit === 'in') val = m.valueUm / 25400;
            const sym = m.displayUnit === 'um' ? 'µm' : m.displayUnit;
            labelText = shortType + ': ' + formatMeasurementValue(val, m.displayUnit) + ' ' + sym;
          } else {
            labelText = shortType + ': ' + m.pixelDistance.toFixed(1) + ' px';
          }

          const badgeWidth = labelText.length * 6.5 + 10;
          svgHtml += '<rect x="' + (mx - badgeWidth / 2) + '" y="' + (my - 16) + '" width="' + badgeWidth + '" height="14" rx="3" fill="#0f172a" opacity="0.85" stroke="#ffffff" stroke-width="0.5"/>';
          svgHtml += '<text x="' + mx + '" y="' + (my - 6) + '" fill="#ffffff" font-size="9" font-family="sans-serif" font-weight="bold" text-anchor="middle">' + escapeHtml(labelText) + '</text>';
        });
      }
    }

    // 2. In-progress measurement points
    if (measurementState.points && measurementState.points.length > 0) {
      const screenMeasPts = measurementState.points.map((pt) => ({
        sx: viewerState.tx + pt.x * viewerState.scale,
        sy: viewerState.ty + pt.y * viewerState.scale
      }));

      if (screenMeasPts.length === 2) {
        const p1 = screenMeasPts[0];
        const p2 = screenMeasPts[1];
        svgHtml += '<line x1="' + p1.sx + '" y1="' + p1.sy + '" x2="' + p2.sx + '" y2="' + p2.sy + '" stroke="#0f172a" stroke-width="4" stroke-linecap="round" />';
        svgHtml += '<line x1="' + p1.sx + '" y1="' + p1.sy + '" x2="' + p2.sx + '" y2="' + p2.sy + '" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,2" />';
      }

      screenMeasPts.forEach((pt, index) => {
        const tag = 'M' + (index + 1);
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="9" fill="#0f172a" opacity="0.6" />';
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="7" fill="#059669" stroke="#ffffff" stroke-width="1.5" />';
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="2" fill="#a7f3d0" />';
        svgHtml += '<line x1="' + (pt.sx - 13) + '" y1="' + pt.sy + '" x2="' + (pt.sx - 9) + '" y2="' + pt.sy + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + (pt.sx + 9) + '" y1="' + pt.sy + '" x2="' + (pt.sx + 13) + '" y2="' + pt.sy + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + pt.sx + '" y1="' + (pt.sy - 13) + '" x2="' + pt.sx + '" y2="' + (pt.sy - 9) + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + pt.sx + '" y1="' + (pt.sy + 9) + '" x2="' + pt.sx + '" y2="' + (pt.sy + 13) + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        const badgeX = pt.sx + 12;
        const badgeY = pt.sy - 10;
        svgHtml += '<rect x="' + badgeX + '" y="' + badgeY + '" width="22" height="15" rx="3" fill="#059669" stroke="#ffffff" stroke-width="1"/>';
        svgHtml += '<text x="' + (badgeX + 11) + '" y="' + (badgeY + 11) + '" fill="#ffffff" font-size="10" font-family="sans-serif" font-weight="bold" text-anchor="middle">' + tag + '</text>';
      });
    }

    // 3. Calibration points and reference line
    const calPoints = calibrationState.points;
    if (calPoints && calPoints.length > 0) {
      const screenPts = calPoints.map((pt) => ({
        sx: viewerState.tx + pt.x * viewerState.scale,
        sy: viewerState.ty + pt.y * viewerState.scale
      }));

      if (screenPts.length === 2) {
        const p1 = screenPts[0];
        const p2 = screenPts[1];
        svgHtml += '<line x1="' + p1.sx + '" y1="' + p1.sy + '" x2="' + p2.sx + '" y2="' + p2.sy + '" stroke="#0f172a" stroke-width="4" stroke-linecap="round" />';
        svgHtml += '<line x1="' + p1.sx + '" y1="' + p1.sy + '" x2="' + p2.sx + '" y2="' + p2.sy + '" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-dasharray="5,3" />';
      }

      screenPts.forEach((pt, index) => {
        const num = index + 1;
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="9" fill="#0f172a" opacity="0.6" />';
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="7" fill="#1e3a8a" stroke="#ffffff" stroke-width="1.5" />';
        svgHtml += '<circle cx="' + pt.sx + '" cy="' + pt.sy + '" r="2" fill="#38bdf8" />';
        svgHtml += '<line x1="' + (pt.sx - 13) + '" y1="' + pt.sy + '" x2="' + (pt.sx - 9) + '" y2="' + pt.sy + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + (pt.sx + 9) + '" y1="' + pt.sy + '" x2="' + (pt.sx + 13) + '" y2="' + pt.sy + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + pt.sx + '" y1="' + (pt.sy - 13) + '" x2="' + pt.sx + '" y2="' + (pt.sy - 9) + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        svgHtml += '<line x1="' + pt.sx + '" y1="' + (pt.sy + 9) + '" x2="' + pt.sx + '" y2="' + (pt.sy + 13) + '" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />';
        const badgeX = pt.sx + 12;
        const badgeY = pt.sy - 10;
        svgHtml += '<rect x="' + badgeX + '" y="' + badgeY + '" width="16" height="15" rx="3" fill="#1e3a8a" stroke="#ffffff" stroke-width="1"/>';
        svgHtml += '<text x="' + (badgeX + 8) + '" y="' + (badgeY + 11) + '" fill="#ffffff" font-size="10" font-family="sans-serif" font-weight="bold" text-anchor="middle">' + num + '</text>';
      });
    }

    viewerOverlay.innerHTML = svgHtml;
  }

  /** Formats micrometers per pixel with clean precision. */
  function formatUmPerPixel(ppm) {
    if (!ppm || ppm <= 0) return '0';
    const umPerPx = 1 / ppm;
    if (umPerPx >= 100) return umPerPx.toFixed(1);
    if (umPerPx >= 1) return umPerPx.toFixed(2);
    if (umPerPx >= 0.01) return umPerPx.toFixed(3);
    return umPerPx.toPrecision(3);
  }

  function hideCalibrationPrompt() {
    if (calibrationPromptBanner) calibrationPromptBanner.hidden = true;
  }

  function hideCalibrationForm() {
    if (calibrationForm) calibrationForm.hidden = true;
  }

  function hideCopyPanel() {
    if (copyCalibrationPanel) copyCalibrationPanel.hidden = true;
  }

  function hideMeasurePrompt() {
    if (measurePromptBanner) measurePromptBanner.hidden = true;
  }

  function hideMeasurementForm() {
    if (measurementForm) measurementForm.hidden = true;
  }

  /** Updates the calibration status bar, labels, and action button visibility in the viewer. */
  function updateViewerCalibrationUI() {
    if (currentViewerOrigIndex < 0 || !activeSample || !activeSample.images || !activeSample.images.originals) {
      return;
    }
    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (!orig) return;

    // Check if any OTHER original in this sample has a saved calibration
    const otherCalibrated = activeSample.images.originals.some((item, idx) => idx !== currentViewerOrigIndex && item.calibration);

    if (orig.calibration) {
      const cal = orig.calibration;
      const umStr = formatUmPerPixel(cal.pixelsPerMicrometer);
      calibrationPill.textContent = 'Calibrated';
      calibrationPill.classList.add('calibrated');
      calibrationStatusText.textContent = 'Calibrated: 1 px = ' + umStr + ' um';

      let detailsHtml = 'Scale: ' + cal.knownLength + ' ' + cal.unit + ' = ' + cal.pixelDistance.toFixed(1) + ' px';
      if (cal.referenceLabel) {
        detailsHtml += ' &bull; ' + escapeHtml(cal.referenceLabel);
      }
      if (cal.source === 'copied' && cal.copiedFrom) {
        detailsHtml += ' &bull; Copied from ' + escapeHtml(cal.copiedFrom);
      }
      calibrationDetails.innerHTML = detailsHtml;
      calibrationDetails.hidden = false;

      btnRecalibrate.hidden = false;
      btnClearCalibration.hidden = false;
      btnCopyCalibration.hidden = !otherCalibrated;
      btnViewerCalibrate.textContent = 'Recalibrate';
    } else {
      calibrationPill.textContent = 'Not calibrated';
      calibrationPill.classList.remove('calibrated');
      calibrationStatusText.textContent = 'Calibration: Not calibrated';
      calibrationDetails.innerHTML = '';
      calibrationDetails.hidden = true;

      btnRecalibrate.hidden = true;
      btnClearCalibration.hidden = true;
      btnCopyCalibration.hidden = !otherCalibrated;
      btnViewerCalibrate.textContent = 'Calibrate';
    }
  }

  /** Initiates two-point calibration mode. */
  function startCalibrationMode() {
    if (currentViewerOrigIndex < 0) return;
    // Rule 1: Only one tool mode can be active at a time; entering calibrate cancels measure
    cancelMeasureMode(false);

    activeViewerTool = 'calibrate';
    calibrationState.isCalibrating = true;
    calibrationState.points = [];
    viewerStage.classList.add('calibrating-mode');

    hideCalibrationForm();
    hideCopyPanel();
    renderViewerOverlay();

    calibrationPromptStep.textContent = 'Tap first reference point on image (0/2 points placed).';
    btnResetPoints.hidden = true;
    calibrationPromptBanner.hidden = false;
    showStatus('Calibration active: Tap first point along a known reference scale.', 'info');
  }

  /** Cancels two-point calibration mode, clears pending points, and hides banners/forms. */
  function cancelCalibrationMode(showMsg = true) {
    activeViewerTool = 'none';
    calibrationState.isCalibrating = false;
    calibrationState.points = [];
    viewerStage.classList.remove('calibrating-mode');
    hideCalibrationPrompt();
    hideCalibrationForm();
    hideCopyPanel();
    renderViewerOverlay();
    if (showMsg) {
      showStatus('Calibration cancelled.', 'info');
    }
  }

  /** Handles tap on the viewer stage in calibrate mode, converting to image pixels. */
  function handleViewerTap(clientX, clientY) {
    if (activeViewerTool !== 'calibrate') return;
    if (!viewerState.natW || !viewerState.natH) return;
    if (calibrationState.points.length >= 2) return;

    const rect = viewerStage.getBoundingClientRect();
    const stageX = clientX - rect.left;
    const stageY = clientY - rect.top;

    // Convert stage coordinates to natural image pixel coordinates
    const imgX = (stageX - viewerState.tx) / viewerState.scale;
    const imgY = (stageY - viewerState.ty) / viewerState.scale;

    // Check bounds: tap must land within the image
    if (imgX < 0 || imgX > viewerState.natW || imgY < 0 || imgY > viewerState.natH) {
      showStatus('Tap landed outside the image area. Please tap inside the image.', 'error');
      return;
    }

    if (calibrationState.points.length === 0) {
      // First point
      calibrationState.points.push({ x: imgX, y: imgY });
      renderViewerOverlay();
      calibrationPromptStep.textContent = 'Point 1 placed at (' + Math.round(imgX) + ', ' + Math.round(imgY) + ' px). Tap second reference point (1/2 placed).';
      btnResetPoints.hidden = false;
      showStatus('Point 1 marked. Now tap the second reference point.', 'success');
    } else if (calibrationState.points.length === 1) {
      // Second point
      const p1 = calibrationState.points[0];
      const p2 = { x: imgX, y: imgY };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      // Rule 3: Reject points less than 3 px apart
      if (dist < 3) {
        showStatus('Points are too close (' + dist.toFixed(1) + ' px apart). Must be at least 3 px apart. Please tap the second point again.', 'error');
        return;
      }

      calibrationState.points.push(p2);
      renderViewerOverlay();

      // Finish point placement mode
      calibrationState.isCalibrating = false;
      viewerStage.classList.remove('calibrating-mode');
      hideCalibrationPrompt();

      // Show calibration details form
      openCalibrationForm(dist);
    }
  }

  /** Shows the calibration data input form after 2 points are placed. */
  function openCalibrationForm(pixelDist) {
    calKnownLengthInput.value = '';
    errorCalKnownLength.textContent = '';
    calKnownLengthInput.classList.remove('input-error');

    // Default unit: microscopic -> um, regular -> mm
    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (orig && orig.mode === 'microscopic') {
      calUnitSelect.value = 'um';
      calReferenceLabelInput.placeholder = 'e.g., Stage micrometer division (10 um)';
    } else {
      calUnitSelect.value = 'mm';
      calReferenceLabelInput.placeholder = 'e.g., Millimeter ruler division (1 mm)';
    }

    calMeasuredDistance.textContent = 'Measured pixel distance: ' + pixelDist.toFixed(2) + ' px';

    // Rule 3: Warn, but allow, if the reference line is under 50 px long (low precision)
    if (pixelDist < 50) {
      calibrationWarning.textContent = 'Warning: Reference line is under 50 pixels long (' + pixelDist.toFixed(1) + ' px). Calibration precision may be low.';
      calibrationWarning.hidden = false;
    } else {
      calibrationWarning.hidden = true;
    }

    calibrationForm.hidden = false;
    calKnownLengthInput.focus();
  }

  /** Opens the copy calibration panel allowing student to copy scale from another original. */
  function openCopyCalibrationPanel() {
    if (activeViewerTool === 'calibrate') cancelCalibrationMode(false);
    if (activeViewerTool === 'measure') cancelMeasureMode(false);
    copyCalibrationSource.innerHTML = '';
    const originals = activeSample.images.originals;
    const available = [];

    originals.forEach((orig, idx) => {
      if (idx !== currentViewerOrigIndex && orig.calibration) {
        available.push({ orig, idx });
      }
    });

    if (available.length === 0) {
      showStatus('No other calibrated images found in this sample.', 'error');
      return;
    }

    available.forEach(({ orig, idx }) => {
      const option = document.createElement('option');
      option.value = String(idx);
      const modeText = orig.mode === 'microscopic' ? 'Micro' : 'Regular';
      const umStr = formatUmPerPixel(orig.calibration.pixelsPerMicrometer);
      option.textContent = 'Original #' + (idx + 1) + ' (' + modeText + ', ' + (orig.fileName || 'image') + ') - 1 px = ' + umStr + ' um [' + (orig.calibration.referenceLabel || 'Scale') + ']';
      copyCalibrationSource.appendChild(option);
    });

    copyCalibrationPanel.hidden = false;
  }

  // --- Step 4B: Measurement Functions ---

  /** Initiates two-point measurement mode. */
  function startMeasureMode() {
    if (currentViewerOrigIndex < 0) return;
    // Rule 1: Only one tool mode can be active at a time; entering measure cancels calibrate
    cancelCalibrationMode(false);

    activeViewerTool = 'measure';
    measurementState.isMeasuring = true;
    measurementState.points = [];
    viewerStage.classList.add('measuring-mode');

    hideMeasurementForm();
    hideMeasurePrompt();
    renderViewerOverlay();

    measurePromptStep.textContent = 'Tap first point to measure (0/2 points placed).';
    btnResetMeasPoints.hidden = true;
    measurePromptBanner.hidden = false;
    showStatus('Measurement active: Tap two points to measure hair dimensions.', 'info');
  }

  /** Cancels two-point measurement mode, clears pending points, and hides banners/forms. */
  function cancelMeasureMode(showMsg = true) {
    activeViewerTool = 'none';
    measurementState.isMeasuring = false;
    measurementState.points = [];
    viewerStage.classList.remove('measuring-mode');
    hideMeasurePrompt();
    hideMeasurementForm();
    renderViewerOverlay();
    if (showMsg) {
      showStatus('Measurement cancelled.', 'info');
    }
  }

  /** Handles tap on the viewer stage in measure mode, converting to image pixels. */
  function handleMeasureTap(clientX, clientY) {
    if (activeViewerTool !== 'measure') return;
    if (!viewerState.natW || !viewerState.natH) return;
    if (measurementState.points.length >= 2) return;

    const rect = viewerStage.getBoundingClientRect();
    const stageX = clientX - rect.left;
    const stageY = clientY - rect.top;

    const imgX = (stageX - viewerState.tx) / viewerState.scale;
    const imgY = (stageY - viewerState.ty) / viewerState.scale;

    // Validate bounds
    if (imgX < 0 || imgX > viewerState.natW || imgY < 0 || imgY > viewerState.natH) {
      showStatus('Tap landed outside the image area. Please tap inside the image.', 'error');
      return;
    }

    if (measurementState.points.length === 0) {
      // First point
      measurementState.points.push({ x: imgX, y: imgY });
      renderViewerOverlay();
      measurePromptStep.textContent = 'Point 1 placed at (' + Math.round(imgX) + ', ' + Math.round(imgY) + ' px). Tap second point (1/2 placed).';
      btnResetMeasPoints.hidden = false;
      showStatus('Point 1 marked. Now tap the second measurement point.', 'success');
    } else if (measurementState.points.length === 1) {
      // Second point
      const p1 = measurementState.points[0];
      const p2 = { x: imgX, y: imgY };
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

      // Rule 2: Reject points under 3 px apart
      if (dist < 3) {
        showStatus('Points are too close (' + dist.toFixed(1) + ' px apart). Must be at least 3 px apart. Please tap the second point again.', 'error');
        return;
      }

      measurementState.points.push(p2);
      renderViewerOverlay();

      // Exit point placement mode
      measurementState.isMeasuring = false;
      viewerStage.classList.remove('measuring-mode');
      hideMeasurePrompt();

      // Open measurement details form
      openMeasurementForm(dist);
    }
  }

  /** Shows the measurement data input form after 2 points are placed. */
  function openMeasurementForm(dist) {
    measurementState.currentDist = dist;
    measureNoteInput.value = '';

    const orig = activeSample.images.originals[currentViewerOrigIndex];
    const isCalibrated = !!(orig && orig.calibration && orig.calibration.pixelsPerMicrometer > 0);

    if (isCalibrated) {
      // Rule 4: Calibrated measurement
      formMeasureLabelPill.textContent = 'Calibrated measurement';
      formMeasureLabelPill.className = 'measure-label-pill calibrated';
      measureUnitGroup.hidden = false;

      // Smart default unit: if micro, 'um'; if regular, 'mm'
      if (orig.mode === 'microscopic') {
        measureDisplayUnitSelect.value = 'um';
      } else {
        measureDisplayUnitSelect.value = 'mm';
      }
      updateMeasurementFormValues();
    } else {
      // Rule 3: If image has NO calibration, show in pixels only labeled "Estimate (uncalibrated, pixels only)"
      // Never show um/mm/cm/in for it.
      formMeasureLabelPill.textContent = 'Estimate (uncalibrated, pixels only)';
      formMeasureLabelPill.className = 'measure-label-pill estimate';
      measureUnitGroup.hidden = true;
      measureValMain.textContent = dist.toFixed(2) + ' px';
      measureValSub.textContent = 'Uncalibrated image: measurement recorded in pixels only.';
    }

    measurementForm.hidden = false;
    measureTypeSelect.focus();
  }

  /** Updates displayed value and unit in the measurement form instantly. */
  function updateMeasurementFormValues() {
    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (!orig || !orig.calibration || !orig.calibration.pixelsPerMicrometer) return;

    const ppm = orig.calibration.pixelsPerMicrometer;
    const valueUm = measurementState.currentDist / ppm;
    const unit = measureDisplayUnitSelect.value;

    let convertedVal = valueUm;
    if (unit === 'mm') convertedVal = valueUm / 1000;
    else if (unit === 'cm') convertedVal = valueUm / 10000;
    else if (unit === 'in') convertedVal = valueUm / 25400;

    const unitSymbol = unit === 'um' ? 'µm' : unit;
    measureValMain.textContent = formatMeasurementValue(convertedVal, unit) + ' ' + unitSymbol;
    measureValSub.textContent = 'Pixel distance: ' + measurementState.currentDist.toFixed(2) + ' px (1 px = ' + formatUmPerPixel(ppm) + ' um)';
  }

  /** Renders the saved measurements list for the open image. */
  function renderMeasurementsList() {
    if (!measurementsListContainer) return;
    if (currentViewerOrigIndex < 0 || !activeSample || !activeSample.images || !activeSample.images.originals) {
      measurementsListContainer.innerHTML = '';
      if (measurementsCountBadge) measurementsCountBadge.textContent = '0 recorded';
      return;
    }

    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (!orig) return;

    const allMeas = Array.isArray(activeSample.measurements) ? activeSample.measurements : [];
    const imageMeasurements = allMeas.filter((m) => m.imageId === orig.id);

    if (measurementsCountBadge) {
      measurementsCountBadge.textContent = imageMeasurements.length + ' recorded';
    }

    if (imageMeasurements.length === 0) {
      measurementsListContainer.innerHTML = '<p class="measurements-empty-msg">No measurements recorded for this image yet. Click "Measure" in the toolbar to measure hair features.</p>';
      return;
    }

    let html = '';
    imageMeasurements.forEach((m) => {
      const modeText = m.imageMode === 'microscopic' ? 'Micro' : 'Regular';
      const modeTagClass = m.imageMode === 'microscopic' ? 'tag-micro' : 'tag-regular';
      const isCal = m.valueUm !== null;
      const labelPillClass = isCal ? 'measure-label-pill calibrated' : 'measure-label-pill estimate';

      let valueDisplay = '';
      if (isCal) {
        let val = m.valueUm;
        if (m.displayUnit === 'mm') val = m.valueUm / 1000;
        else if (m.displayUnit === 'cm') val = m.valueUm / 10000;
        else if (m.displayUnit === 'in') val = m.valueUm / 25400;
        const sym = m.displayUnit === 'um' ? 'µm' : m.displayUnit;
        valueDisplay = '<strong>' + formatMeasurementValue(val, m.displayUnit) + ' ' + sym + '</strong> <span class="meas-pixels-text">(' + m.pixelDistance.toFixed(1) + ' px)</span>';
      } else {
        valueDisplay = '<strong>' + m.pixelDistance.toFixed(1) + ' px</strong>';
      }

      const timeStr = new Date(m.measuredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const noteHtml = m.note ? '<div class="meas-note-text">Note: ' + escapeHtml(m.note) + '</div>' : '';

      html += `
        <div class="measurement-item" data-meas-id="${escapeHtml(m.id)}">
          <div class="meas-item-header">
            <div class="meas-title-group">
              <span class="meas-type-title">${escapeHtml(m.type)}</span>
              <span class="mode-tag ${modeTagClass}">${modeText}</span>
              <span class="${labelPillClass}">${escapeHtml(m.label)}</span>
            </div>
            <button type="button" class="btn btn-danger-outline btn-sm btn-delete-meas" data-meas-id="${escapeHtml(m.id)}" title="Delete this measurement">Delete</button>
          </div>
          <div class="meas-item-body">
            <div class="meas-value-text">${valueDisplay}</div>
            ${noteHtml}
            <div class="meas-date-text">Recorded ${escapeHtml(timeStr)}</div>
          </div>
        </div>
      `;
    });

    measurementsListContainer.innerHTML = html;
  }

  /** Opens the viewer for the original image at the given index of the active sample. */
  function openImageViewer(index) {
    const originals = activeSample && activeSample.images ? activeSample.images.originals : null;
    const orig = originals ? originals[index] : null;
    if (!orig || !orig.blob) {
      showStatus('Original image not found.', 'error');
      return;
    }

    currentViewerOrigIndex = index;
    releaseViewerImage();
    viewerPointers.clear();
    viewerState.natW = 0;
    viewerState.natH = 0;

    // Reset calibration and measurement interactive states (Rule 4)
    activeViewerTool = 'none';
    calibrationState.isCalibrating = false;
    calibrationState.points = [];
    measurementState.isMeasuring = false;
    measurementState.points = [];
    viewerStage.classList.remove('calibrating-mode');
    viewerStage.classList.remove('measuring-mode');
    hideCalibrationPrompt();
    hideCalibrationForm();
    hideCopyPanel();
    hideMeasurePrompt();
    hideMeasurementForm();

    const modeLabel = orig.mode === 'microscopic' ? 'Microscopic' : 'Regular';
    const baseInfo =
      '<span><strong>ORIGINAL #' + (index + 1) + '</strong></span>' +
      '<span>&bull;</span><span>' + modeLabel + ' mode</span>' +
      '<span>&bull;</span><span>' + escapeHtml(orig.fileName || 'image') + '</span>';
    viewerInfo.innerHTML = baseInfo;

    viewerState.url = URL.createObjectURL(orig.blob);

    // Show the view first so the stage has a real size when the image loads.
    switchView('viewer');

    viewerImage.onload = function () {
      viewerState.natW = viewerImage.naturalWidth;
      viewerState.natH = viewerImage.naturalHeight;
      viewerImage.style.width = viewerState.natW + 'px';
      viewerImage.style.height = viewerState.natH + 'px';
      viewerInfo.innerHTML = baseInfo +
        '<span>&bull;</span><span>' + viewerState.natW + 'x' + viewerState.natH + ' px</span>';
      viewerFit();
      updateViewerCalibrationUI();
      renderMeasurementsList();
      renderViewerOverlay();
    };
    viewerImage.onerror = function () {
      showStatus('This image could not be displayed.', 'error');
      closeImageViewer();
    };
    viewerImage.src = viewerState.url;
  }

  /** Frees the object URL and clears the displayed image. */
  function releaseViewerImage() {
    viewerImage.onload = null;
    viewerImage.onerror = null;
    viewerImage.removeAttribute('src');
    if (viewerState.url) {
      URL.revokeObjectURL(viewerState.url);
      viewerState.url = null;
    }
  }

  /** Closes the viewer and returns to the capture view (image list). */
  function closeImageViewer() {
    currentViewerOrigIndex = -1;
    activeViewerTool = 'none';
    calibrationState.isCalibrating = false;
    calibrationState.points = [];
    measurementState.isMeasuring = false;
    measurementState.points = [];
    viewerStage.classList.remove('calibrating-mode');
    viewerStage.classList.remove('measuring-mode');
    hideCalibrationPrompt();
    hideCalibrationForm();
    hideCopyPanel();
    hideMeasurePrompt();
    hideMeasurementForm();
    if (viewerOverlay) viewerOverlay.innerHTML = '';
    releaseViewerImage();
    viewerPointers.clear();
    viewerStage.classList.remove('grabbing');
    switchView('capture');
    renderSavedOriginals();
  }

  // Tap/click a saved original thumbnail -> open viewer
  originalsGrid.addEventListener('click', (e) => {
    const thumb = e.target.closest('img.orig-thumb');
    if (!thumb) return;
    const index = parseInt(thumb.getAttribute('data-orig-index'), 10);
    if (!isNaN(index)) openImageViewer(index);
  });

  // Toolbar buttons (zoom around the center of the stage)
  btnViewerZoomIn.addEventListener('click', () => {
    viewerZoomAt(VIEWER_BUTTON_STEP, viewerStage.clientWidth / 2, viewerStage.clientHeight / 2);
  });
  btnViewerZoomOut.addEventListener('click', () => {
    viewerZoomAt(1 / VIEWER_BUTTON_STEP, viewerStage.clientWidth / 2, viewerStage.clientHeight / 2);
  });
  btnViewerReset.addEventListener('click', viewerFit);
  btnViewerBack.addEventListener('click', closeImageViewer);

  // Calibration toolbar button
  btnViewerCalibrate.addEventListener('click', () => {
    startCalibrationMode();
  });
  btnRecalibrate.addEventListener('click', () => {
    startCalibrationMode();
  });
  btnCancelCalibration.addEventListener('click', cancelCalibrationMode);
  btnCancelCalForm.addEventListener('click', cancelCalibrationMode);

  btnResetPoints.addEventListener('click', () => {
    calibrationState.points = [];
    renderViewerOverlay();
    calibrationPromptStep.textContent = 'Points reset. Tap first reference point on image (0/2 points placed).';
    btnResetPoints.hidden = true;
  });

  btnRetapPoints.addEventListener('click', () => {
    startCalibrationMode();
  });

  calKnownLengthInput.addEventListener('input', () => {
    calKnownLengthInput.classList.remove('input-error');
    errorCalKnownLength.textContent = '';
  });

  // Calibration Form submission (Step 4 & 5)
  calibrationForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (currentViewerOrigIndex < 0 || !activeSample) return;

    const lengthVal = parseFloat(calKnownLengthInput.value);
    if (isNaN(lengthVal) || lengthVal <= 0) {
      errorCalKnownLength.textContent = 'Please enter a valid reference length greater than 0.';
      calKnownLengthInput.classList.add('input-error');
      return;
    }

    const unitVal = calUnitSelect.value;
    if (!['um', 'mm', 'cm', 'in'].includes(unitVal)) {
      return;
    }

    if (calibrationState.points.length < 2) {
      showStatus('Calibration points missing. Please retap points.', 'error');
      return;
    }

    const p1 = calibrationState.points[0];
    const p2 = calibrationState.points[1];
    const pixelDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    if (pixelDist < 3) {
      showStatus('Points are less than 3 px apart. Calibration rejected.', 'error');
      return;
    }

    // Convert known physical length to micrometers
    // 1 mm = 1000 um, 1 cm = 10000 um, 1 in = 25400 um
    let knownLengthInUm = 0;
    if (unitVal === 'um') {
      knownLengthInUm = lengthVal;
    } else if (unitVal === 'mm') {
      knownLengthInUm = lengthVal * 1000;
    } else if (unitVal === 'cm') {
      knownLengthInUm = lengthVal * 10000;
    } else if (unitVal === 'in') {
      knownLengthInUm = lengthVal * 25400;
    }

    const pixelsPerMicrometer = pixelDist / knownLengthInUm;
    const refLabel = calReferenceLabelInput.value.trim() || 'Two-point calibration';

    // Step 5: Save calibration on that original image's record (never modify original image Blob)
    const calibrationRecord = {
      referenceLabel: refLabel,
      knownLength: lengthVal,
      unit: unitVal,
      pixelDistance: parseFloat(pixelDist.toFixed(2)),
      pixelsPerMicrometer: pixelsPerMicrometer,
      calibratedAt: new Date().toISOString(),
      source: 'two-point',
      points: [
        { x: parseFloat(p1.x.toFixed(1)), y: parseFloat(p1.y.toFixed(1)) },
        { x: parseFloat(p2.x.toFixed(1)), y: parseFloat(p2.y.toFixed(1)) }
      ]
    };

    const orig = activeSample.images.originals[currentViewerOrigIndex];
    orig.calibration = calibrationRecord;
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        showStatus('Calibration saved successfully: 1 px = ' + formatUmPerPixel(pixelsPerMicrometer) + ' um.', 'success');
        // Rule 2: Exit calibrate mode, hide banner, close form, and clear pending points
        activeViewerTool = 'none';
        calibrationState.isCalibrating = false;
        calibrationState.points = [];
        viewerStage.classList.remove('calibrating-mode');
        hideCalibrationPrompt();
        hideCalibrationForm();
        updateViewerCalibrationUI();
        renderViewerOverlay();
      })
      .catch((err) => {
        showStatus('Failed to persist calibration: ' + err.message, 'error');
      });
  });

  // Clear Calibration
  btnClearCalibration.addEventListener('click', () => {
    if (currentViewerOrigIndex < 0 || !activeSample) return;
    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (!orig || !orig.calibration) return;

    if (!window.confirm('Clear calibration for this image?')) {
      return;
    }

    // Rule 7: Existing measurements keep their own calibrationSnapshot; do not recompute them silently.
    orig.calibration = null;
    activeViewerTool = 'none';
    calibrationState.isCalibrating = false;
    calibrationState.points = [];
    viewerStage.classList.remove('calibrating-mode');
    hideCalibrationPrompt();
    hideCalibrationForm();
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        showStatus('Calibration cleared for this image.', 'info');
        renderViewerOverlay();
        updateViewerCalibrationUI();
      })
      .catch((err) => {
        showStatus('Failed to update calibration in IndexedDB: ' + err.message, 'error');
      });
  });

  // Copy Calibration
  btnCopyCalibration.addEventListener('click', openCopyCalibrationPanel);
  btnCancelCopy.addEventListener('click', hideCopyPanel);

  btnConfirmCopy.addEventListener('click', () => {
    if (currentViewerOrigIndex < 0 || !activeSample) return;
    const sourceIdx = parseInt(copyCalibrationSource.value, 10);
    const sourceOrig = activeSample.images.originals[sourceIdx];
    if (!sourceOrig || !sourceOrig.calibration) {
      showStatus('Selected source image has no valid calibration.', 'error');
      return;
    }

    const currentOrig = activeSample.images.originals[currentViewerOrigIndex];
    const sourceCal = sourceOrig.calibration;

    // Requirement 5 & 7: record copiedFrom on the copy
    const copiedCalibration = {
      referenceLabel: sourceCal.referenceLabel,
      knownLength: sourceCal.knownLength,
      unit: sourceCal.unit,
      pixelDistance: sourceCal.pixelDistance,
      pixelsPerMicrometer: sourceCal.pixelsPerMicrometer,
      calibratedAt: new Date().toISOString(),
      source: 'copied',
      copiedFrom: sourceOrig.fileName || ('Original #' + (sourceIdx + 1))
    };

    currentOrig.calibration = copiedCalibration;
    activeViewerTool = 'none';
    calibrationState.isCalibrating = false;
    calibrationState.points = []; // no points marked on this original
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        showStatus('Calibration copied from Original #' + (sourceIdx + 1) + '.', 'success');
        hideCopyPanel();
        updateViewerCalibrationUI();
        renderViewerOverlay();
      })
      .catch((err) => {
        showStatus('Failed to persist copied calibration: ' + err.message, 'error');
      });
  });

  // --- Step 4B: Measurement Event Listeners ---

  btnViewerMeasure.addEventListener('click', startMeasureMode);
  btnCancelMeasure.addEventListener('click', cancelMeasureMode);
  btnCancelMeasForm.addEventListener('click', cancelMeasureMode);

  btnResetMeasPoints.addEventListener('click', () => {
    measurementState.points = [];
    renderViewerOverlay();
    measurePromptStep.textContent = 'Points reset. Tap first point to measure (0/2 points placed).';
    btnResetMeasPoints.hidden = true;
  });

  btnRetapMeasPoints.addEventListener('click', startMeasureMode);

  measureDisplayUnitSelect.addEventListener('change', () => {
    updateMeasurementFormValues();
  });

  measureTypeSelect.addEventListener('change', () => {
    const orig = activeSample.images.originals[currentViewerOrigIndex];
    if (orig && orig.calibration && orig.calibration.pixelsPerMicrometer > 0) {
      if (measureTypeSelect.value === 'Shaft diameter' && orig.mode === 'microscopic') {
        measureDisplayUnitSelect.value = 'um';
      }
      updateMeasurementFormValues();
    }
  });

  // Save Measurement Submit Handler (Requirements 3, 4, 5, 9)
  measurementForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (currentViewerOrigIndex < 0 || !activeSample) return;

    if (measurementState.points.length < 2) {
      showStatus('Measurement points missing. Please retap points.', 'error');
      return;
    }

    const p1 = measurementState.points[0];
    const p2 = measurementState.points[1];
    const pixelDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    if (pixelDist < 3) {
      showStatus('Points are under 3 px apart. Measurement rejected.', 'error');
      return;
    }

    const orig = activeSample.images.originals[currentViewerOrigIndex];
    const isCalibrated = !!(orig && orig.calibration && orig.calibration.pixelsPerMicrometer > 0);

    let valueUm = null;
    let displayUnit = 'px';
    let label = 'Estimate (uncalibrated, pixels only)';
    let calibrationSnapshot = null;

    if (isCalibrated) {
      const ppm = orig.calibration.pixelsPerMicrometer;
      valueUm = pixelDist / ppm;
      displayUnit = measureDisplayUnitSelect.value;
      label = 'Calibrated measurement';
      calibrationSnapshot = {
        pixelsPerMicrometer: ppm,
        source: orig.calibration.source || 'two-point'
      };
    }

    const measurementRecord = {
      id: 'meas_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000),
      imageId: orig.id,
      imageMode: orig.mode,
      type: measureTypeSelect.value,
      pixelDistance: parseFloat(pixelDist.toFixed(2)),
      valueUm: valueUm !== null ? parseFloat(valueUm.toFixed(4)) : null,
      displayUnit: displayUnit,
      label: label,
      note: measureNoteInput.value.trim(),
      points: [
        { x: parseFloat(p1.x.toFixed(1)), y: parseFloat(p1.y.toFixed(1)) },
        { x: parseFloat(p2.x.toFixed(1)), y: parseFloat(p2.y.toFixed(1)) }
      ],
      calibrationSnapshot: calibrationSnapshot,
      measuredAt: new Date().toISOString()
    };

    if (!Array.isArray(activeSample.measurements)) {
      activeSample.measurements = [];
    }
    activeSample.measurements.push(measurementRecord);
    activeSample.updatedAt = new Date().toISOString();

    saveSampleToDB(activeSample)
      .then(() => {
        showStatus('Measurement saved: ' + measurementRecord.type + '.', 'success');
        // Rule 3: Exit measure mode, hide banner, close form, and clear pending points
        activeViewerTool = 'none';
        measurementState.isMeasuring = false;
        measurementState.points = [];
        viewerStage.classList.remove('measuring-mode');
        hideMeasurePrompt();
        hideMeasurementForm();
        renderMeasurementsList();
        renderViewerOverlay();
      })
      .catch((err) => {
        showStatus('Failed to persist measurement: ' + err.message, 'error');
      });
  });

  // Delete measurement delegated click listener (Requirement 6)
  measurementsListContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-delete-meas');
    if (!btn) return;
    const measId = btn.getAttribute('data-meas-id');
    if (!measId || !activeSample || !Array.isArray(activeSample.measurements)) return;

    if (!window.confirm('Delete this measurement record?')) {
      return;
    }

    const idx = activeSample.measurements.findIndex((m) => m.id === measId);
    if (idx !== -1) {
      activeSample.measurements.splice(idx, 1);
      activeSample.updatedAt = new Date().toISOString();
      saveSampleToDB(activeSample)
        .then(() => {
          showStatus('Measurement deleted.', 'info');
          renderMeasurementsList();
          renderViewerOverlay();
        })
        .catch((err) => {
          showStatus('Failed to delete measurement: ' + err.message, 'error');
        });
    }
  });

  // Mouse wheel zoom (around the cursor)
  viewerStage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = viewerStage.getBoundingClientRect();
    const factor = e.deltaY < 0 ? VIEWER_WHEEL_STEP : 1 / VIEWER_WHEEL_STEP;
    viewerZoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Drag to pan (single pointer) and pinch to zoom (two pointers)
  // In calibrate or measure mode: movement under 6 px is treated as a tap (Rule 1)
  viewerStage.addEventListener('pointerdown', (e) => {
    viewerStage.setPointerCapture(e.pointerId);
    viewerPointers.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      maxMove: 0,
      isDrag: false
    });
    if (viewerPointers.size > 1) {
      pinchOccurredInViewer = true;
    }
    viewerStage.classList.add('grabbing');
  });

  viewerStage.addEventListener('pointermove', (e) => {
    if (!viewerPointers.has(e.pointerId)) return;

    if (viewerPointers.size === 1) {
      const p = viewerPointers.get(e.pointerId);
      const moveFromStart = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (moveFromStart > p.maxMove) {
        p.maxMove = moveFromStart;
      }

      const isToolActive = activeViewerTool === 'calibrate' || activeViewerTool === 'measure';

      // If calibrating or measuring, require >= 6px movement before dragging to pan (treat under 6px as tap)
      if (isToolActive && !p.isDrag) {
        if (moveFromStart >= 6) {
          p.isDrag = true;
        }
      } else if (!isToolActive) {
        p.isDrag = true;
      }

      if (p.isDrag) {
        viewerState.tx += e.clientX - p.x;
        viewerState.ty += e.clientY - p.y;
        viewerApply();
      }

      p.x = e.clientX;
      p.y = e.clientY;
    } else if (viewerPointers.size === 2) {
      pinchOccurredInViewer = true;
      const before = viewerPinchInfo();
      const p = viewerPointers.get(e.pointerId);
      p.x = e.clientX;
      p.y = e.clientY;
      const moveFromStart = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (moveFromStart > p.maxMove) p.maxMove = moveFromStart;
      const after = viewerPinchInfo();
      if (before.dist > 0) {
        const rect = viewerStage.getBoundingClientRect();
        viewerState.tx += after.mx - before.mx; // pan with the midpoint
        viewerState.ty += after.my - before.my;
        viewerZoomAt(after.dist / before.dist, after.mx - rect.left, after.my - rect.top);
      }
    }
  });

  ['pointerup', 'pointercancel'].forEach((eventName) => {
    viewerStage.addEventListener(eventName, (e) => {
      const p = viewerPointers.get(e.pointerId);
      // Rule 5: Send tap only to the active mode; do nothing if no mode is active
      const wasTap = eventName === 'pointerup' &&
                     activeViewerTool !== 'none' &&
                     p &&
                     !p.isDrag &&
                     p.maxMove < 6 &&
                     !pinchOccurredInViewer &&
                     viewerPointers.size === 1;

      viewerPointers.delete(e.pointerId);
      if (viewerPointers.size === 0) {
        viewerStage.classList.remove('grabbing');
        pinchOccurredInViewer = false;
      }

      if (wasTap) {
        if (activeViewerTool === 'calibrate') {
          handleViewerTap(p.startX, p.startY);
        } else if (activeViewerTool === 'measure') {
          handleMeasureTap(p.startX, p.startY);
        }
      }
    });
  });

  // Keep the image fitted correctly if the window or phone orientation changes
  window.addEventListener('resize', () => {
    if (views.viewer.classList.contains('active') && viewerState.natW) viewerFit();
  });

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

    // File is already a Blob; pass directly (no FileReader/base64 needed)
    processAndPreviewImage(file, file.name);
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

    // File is already a Blob; pass directly (no FileReader/base64 needed)
    processAndPreviewImage(file, file.name);
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
