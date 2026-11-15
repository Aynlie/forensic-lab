/**
 * Educational Forensic Hair Examination Web App (PWA)
 * Step 1: Subject & Sample Management with IndexedDB
 * Pure Vanilla JavaScript - No external libraries
 */

(function () {
  'use strict';

  // --- IndexedDB Configuration ---
  const DB_NAME = 'ForensicHairExamDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'samples';

  let dbInstance = null;
  let pendingSampleData = null; // Holds validated data awaiting confirmation

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
        reject(new Error('IndexedDB error: ' + event.target.error));
      };
    });
  }

  /**
   * Saves a sample record to IndexedDB.
   * @param {Object} sampleRecord
   * @returns {Promise<number>} ID of saved record
   */
  function saveSampleToDB(sampleRecord) {
    return openDB().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.add(sampleRecord);

        request.onsuccess = function () {
          resolve(request.result);
        };

        request.onerror = function (event) {
          reject(new Error('Failed to save sample: ' + event.target.error));
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
          // Sort newest first
          results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          resolve(results);
        };

        request.onerror = function (event) {
          reject(new Error('Failed to retrieve samples: ' + event.target.error));
        };
      });
    });
  }

  // --- DOM Elements ---
  const views = {
    dashboard: document.getElementById('view-dashboard'),
    form: document.getElementById('view-form'),
    confirmation: document.getElementById('view-confirmation'),
    savedSamples: document.getElementById('view-saved-samples')
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

  // --- View Switching ---
  /**
   * Switches the active view.
   * @param {string} viewKey 'dashboard' | 'form' | 'confirmation' | 'savedSamples'
   */
  function switchView(viewKey) {
    Object.keys(views).forEach((key) => {
      const el = views[key];
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

    // 1. Subject / Owner Name (Required)
    if (!formInputs.subjectName.value.trim()) {
      setError('subjectName', 'Subject / Owner Name is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.subjectName;
    }

    // 2. Case Number (Required)
    if (!formInputs.caseNumber.value.trim()) {
      setError('caseNumber', 'Case Number is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.caseNumber;
    }

    // 3. Collection Date (Required)
    if (!formInputs.collectionDate.value) {
      setError('collectionDate', 'Collection Date is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionDate;
    }

    // 4. Collection Time (Required)
    if (!formInputs.collectionTime.value) {
      setError('collectionTime', 'Collection Time is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionTime;
    }

    // 5. Collection Location (Required)
    if (!formInputs.collectionLocation.value.trim()) {
      setError('collectionLocation', 'Collection Location is required.');
      isValid = false;
      if (!firstInvalidField) firstInvalidField = formInputs.collectionLocation;
    }

    // 6. Collected By (Required)
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
   * Renders the confirmation summary screen with the entered values.
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
          html += `
            <article class="sample-item">
              <div class="sample-item-header">
                <span class="sample-item-id">${escapeHtml(sample.sampleId)}</span>
                <span class="sample-item-case">Case: ${escapeHtml(sample.caseNumber)}</span>
              </div>
              <div class="sample-field"><strong>Subject / Owner:</strong> ${escapeHtml(sample.subjectName)} <small>(User-provided)</small></div>
              <div class="sample-field"><strong>Collection:</strong> ${escapeHtml(sample.collectionDate)} at ${escapeHtml(sample.collectionTime)}</div>
              <div class="sample-field"><strong>Location:</strong> ${escapeHtml(sample.collectionLocation)}</div>
              <div class="sample-field"><strong>Collected By:</strong> ${escapeHtml(sample.collectedBy)}</div>
              ${sample.age || sample.sex ? `<div class="sample-field"><strong>Subject Demographics:</strong> ${sample.age ? escapeHtml(sample.age) + ' yrs' : ''} ${sample.sex ? '(' + escapeHtml(sample.sex) + ')' : ''}</div>` : ''}
              ${sample.sampleDescription ? `<div class="sample-field"><strong>Description:</strong> ${escapeHtml(sample.sampleDescription)}</div>` : ''}
              ${sample.additionalNotes ? `<div class="sample-notes">${escapeHtml(sample.additionalNotes)}</div>` : ''}
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

  // Confirmation -> Confirm (save to IndexedDB and return to dashboard)
  btnConfirmSave.addEventListener('click', () => {
    if (!pendingSampleData) {
      switchView('dashboard');
      return;
    }

    saveSampleToDB(pendingSampleData)
      .then(() => {
        const savedId = pendingSampleData.sampleId;
        pendingSampleData = null;
        examForm.reset();
        showStatus(`Sample [${savedId}] successfully saved to IndexedDB.`, 'success');
        switchView('dashboard');
      })
      .catch((err) => {
        showStatus('Error saving sample: ' + err.message, 'error');
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
