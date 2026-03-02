/* ========================
   LUMINAE — app.js
======================== */

// ========================
// STATE
// ========================
let books = JSON.parse(localStorage.getItem('luminae-books') || '[]');
let currentBookId = null;
let darkMode = localStorage.getItem('luminae-dark') === 'true';
let currentFileUrl = null;
let currentFileType = null;
let epubBook = null;
let epubRendition = null;
let currentFontSize = 100;

// ========================
// INDEXED DB — FILE STORAGE
// ========================
const DB_NAME    = 'luminae-db';
const DB_VERSION = 1;
const STORE_NAME = 'files';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = (e) => { console.error('IndexedDB error:', e); reject(e); };
  });
}

function saveFileToDB(bookId, file) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDB();
      const tx       = database.transaction(STORE_NAME, 'readwrite');
      const store    = tx.objectStore(STORE_NAME);
      store.put(file, bookId);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e);
    } catch(e) { reject(e); }
  });
}

function getFileFromDB(bookId) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDB();
      const tx       = database.transaction(STORE_NAME, 'readonly');
      const store    = tx.objectStore(STORE_NAME);
      const req      = store.get(bookId);
      req.onsuccess  = () => resolve(req.result || null);
      req.onerror    = (e) => reject(e);
    } catch(e) { reject(e); }
  });
}

function deleteFileFromDB(bookId) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openDB();
      const tx       = database.transaction(STORE_NAME, 'readwrite');
      const store    = tx.objectStore(STORE_NAME);
      store.delete(bookId);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e);
    } catch(e) { reject(e); }
  });
}

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', () => {
  if (darkMode) document.body.classList.add('dark');
  openDB(); // init IndexedDB on startup
  renderLibrary();
  renderReading();
  setupNav();
  setupThemeToggle();
  setupAddBook();
  setupSearch();
  setupModal();
  setupReader();
  setupUpload();
});

// ========================
// SAVE TO LOCALSTORAGE
// ========================
function saveBooks() {
  localStorage.setItem('luminae-books', JSON.stringify(books));
}

function saveProgress(bookId, cfi, percent, fontSize, page) {
  const progress = JSON.parse(localStorage.getItem('luminae-progress') || '{}');
  progress[bookId] = { cfi, percent, fontSize: fontSize || 100, page: page || 1 };
  localStorage.setItem('luminae-progress', JSON.stringify(progress));
}

function getProgress(bookId) {
  const progress = JSON.parse(localStorage.getItem('luminae-progress') || '{}');
  return progress[bookId] || null;
}

// ========================
// GENERATE ID
// ========================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ========================
// NAVIGATION
// ========================
function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateToPage(btn.dataset.page));
  });

  const pages     = ['library', 'search', 'reading'];
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping   = false;
  const main      = document.querySelector('.app-main');

  main.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    isSwiping   = false;
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    const dx = Math.abs(e.changedTouches[0].screenX - touchStartX);
    const dy = Math.abs(e.changedTouches[0].screenY - touchStartY);
    if (dx > dy && dx > 10) isSwiping = true;
  }, { passive: true });

  main.addEventListener('touchend', (e) => {
    if (!isSwiping) return;
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) < 60) return;
    const activePage   = document.querySelector('.nav-btn.active');
    if (!activePage) return;
    const currentIndex = pages.indexOf(activePage.dataset.page);
    if (diff > 0 && currentIndex < pages.length - 1) {
      navigateToPage(pages[currentIndex + 1]);
    } else if (diff < 0 && currentIndex > 0) {
      navigateToPage(pages[currentIndex - 1]);
    }
  }, { passive: true });
}

function navigateToPage(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  const pg  = document.getElementById(`page-${page}`);
  if (btn) btn.classList.add('active');
  if (pg)  pg.classList.add('active');
}

// ========================
// DARK MODE
// ========================
function setupThemeToggle() {
  const btn = document.getElementById('themeToggle');
  updateThemeIcon(btn);

  btn.addEventListener('click', () => {
    darkMode = !darkMode;
    document.body.classList.toggle('dark', darkMode);
    localStorage.setItem('luminae-dark', darkMode);
    updateThemeIcon(btn);
    applyEpubTheme();
  });

  const readerBtn = document.getElementById('readerThemeToggle');
  if (readerBtn) {
    readerBtn.addEventListener('click', () => {
      darkMode = !darkMode;
      document.body.classList.toggle('dark', darkMode);
      localStorage.setItem('luminae-dark', darkMode);
      updateThemeIcon(btn);
      applyEpubTheme();
    });
  }
}

function updateThemeIcon(btn) {
  btn.innerHTML = darkMode
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';
}

// ========================
// RENDER LIBRARY
// ========================
function renderLibrary() {
  const grid  = document.getElementById('bookGrid');
  const empty = document.getElementById('emptyState');
  grid.innerHTML = '';
  if (books.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  books.forEach(book => grid.appendChild(createBookCard(book)));
}

// ========================
// RENDER CURRENTLY READING
// ========================
function renderReading() {
  const grid    = document.getElementById('readingGrid');
  const empty   = document.getElementById('readingEmpty');
  const reading = books.filter(b => b.reading);
  grid.innerHTML = '';
  if (reading.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  reading.forEach(book => grid.appendChild(createBookCard(book)));
}

// ========================
// CREATE BOOK CARD
// ========================
function createBookCard(book) {
  const card = document.createElement('div');
  card.className  = 'book-card';
  card.dataset.id = book.id;

  const coverHtml = book.cover
    ? `<img class="book-cover" src="${book.cover}" alt="${book.title}"
        onerror="this.outerHTML='<div class=\\'book-cover-placeholder\\'>📚</div>'">`
    : `<div class="book-cover-placeholder">${book.type === 'epub' ? '📖' : '📚'}</div>`;

  const badgeHtml = book.reading
    ? `<span class="book-badge">📖 Reading</span>` : '';

  const typeBadge = book.type === 'epub'
    ? `<span class="book-badge" style="background:var(--accent2);margin-left:4px;">ePub</span>`
    : book.type === 'pdf'
    ? `<span class="book-badge" style="background:var(--pink-hot);margin-left:4px;">PDF</span>`
    : '';

  const saved   = getProgress(book.id);
  const percent = saved ? saved.percent : 0;
  const progressHtml = (book.type === 'epub' || book.type === 'pdf') && percent > 0
    ? `<div style="margin-top:7px;">
        <div style="display:flex;justify-content:space-between;
          align-items:center;margin-bottom:3px;">
          <span style="font-size:0.62rem;font-weight:700;
            color:var(--text-muted);text-transform:uppercase;
            letter-spacing:0.5px;">Progress</span>
          <span style="font-size:0.62rem;font-weight:700;
            color:var(--accent3);">${Math.round(percent)}%</span>
        </div>
        <div style="width:100%;height:5px;background:var(--bg-alt);
          border-radius:3px;border:1.5px solid var(--border);overflow:hidden;">
          <div style="width:${Math.round(percent)}%;height:100%;
            background:var(--accent3);border-radius:2px;
            transition:width 0.3s ease;"></div>
        </div>
      </div>` : '';

  card.innerHTML = `
    ${coverHtml}
    <div class="book-info">
      <h3>${book.title}</h3>
      <p>${book.author || 'Unknown Author'}</p>
      <div>${badgeHtml}${typeBadge}</div>
      ${progressHtml}
    </div>
  `;

  card.addEventListener('click', () => openBookDetail(book.id));
  return card;
}

// ========================
// COVER EXTRACTION
// ========================
async function extractCoverFromEpub(fileUrl) {
  try {
    const res      = await fetch(fileUrl);
    const buffer   = await res.arrayBuffer();
    const temp     = ePub(buffer, { openAs: 'binary' });
    await temp.ready;
    const coverUrl = await temp.coverUrl();
    temp.destroy();
    if (!coverUrl) return '';
    const coverRes = await fetch(coverUrl);
    const blob     = await coverRes.blob();
    return await blobToBase64(blob);
  } catch(e) {
    console.warn('Could not extract epub cover:', e);
    return '';
  }
}

async function extractCoverFromPdf(fileUrl) {
  try {
    await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    const pdf         = await loadingTask.promise;
    const page        = await pdf.getPage(1);
    const viewport    = page.getViewport({ scale: 0.8 });
    const canvas      = document.createElement('canvas');
    canvas.width      = viewport.width;
    canvas.height     = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch(e) {
    console.warn('Could not extract pdf cover:', e);
    return '';
  }
}

function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(); return; }
    const script  = document.createElement('script');
    script.src    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ========================
// ADD BOOK MODAL
// ========================
function setupAddBook() {
  const openBtn  = document.getElementById('openAddBook');
  const modal    = document.getElementById('addBookModal');
  const closeBtn = document.getElementById('closeAddBook');

  openBtn.addEventListener('click', () => modal.classList.add('open'));

  closeBtn.addEventListener('click', () => {
    modal.classList.remove('open');
    clearAddForm();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
      clearAddForm();
    }
  });
}

// ========================
// CLEAR FORM
// ========================
function clearAddForm() {
  ['uploadTitle', 'uploadAuthor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  currentFileUrl      = null;
  currentFileType     = null;
  window._pendingFile = null;

  const area = document.getElementById('uploadArea');
  if (area) {
    area.innerHTML = `
      <i class="fas fa-cloud-upload-alt"></i>
      <p>Tap to upload a PDF or ePub</p>
      <span class="upload-hint">Supports .pdf and .epub files</span>
      <input type="file" id="fileUpload" accept=".pdf,.epub" hidden/>
    `;
    setupUpload();
  }
}

// ========================
// FILE UPLOAD (PDF + EPUB)
// ========================
function setupUpload() {
  const area       = document.getElementById('uploadArea');
  const savePdfBtn = document.getElementById('savePdfBook');

  if (area) {
    const newArea = area.cloneNode(true);
    area.parentNode.replaceChild(newArea, area);

    newArea.addEventListener('click', () => {
      const input = document.getElementById('fileUpload');
      if (input) input.click();
    });

    const input = document.getElementById('fileUpload');
    if (input) {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'pdf' && ext !== 'epub') {
          showToast('⚠️ Only PDF and ePub files are supported!');
          return;
        }

        currentFileUrl      = URL.createObjectURL(file);
        currentFileType     = ext;
        window._pendingFile = file; // store actual File object

        const cleanName = file.name
          .replace(/\.(pdf|epub)$/i, '')
          .replace(/[_-]/g, ' ');
        document.getElementById('uploadTitle').value = cleanName;

        const icon  = ext === 'epub' ? 'fa-book-open'  : 'fa-file-pdf';
        const color = ext === 'epub' ? 'var(--accent2)' : 'var(--pink-hot)';
        const label = ext === 'epub' ? 'ePub' : 'PDF';

        newArea.innerHTML = `
          <i class="fas ${icon}" style="color:${color}"></i>
          <p>${file.name}</p>
          <span class="upload-hint" style="color:${color};font-weight:700;">
            ${label} ready to save
          </span>
          <input type="file" id="fileUpload" accept=".pdf,.epub" hidden/>
        `;
        setupUpload();
        showToast(`✅ ${label} file loaded!`);
      });
    }
  }

  if (savePdfBtn) {
    const newBtn = savePdfBtn.cloneNode(true);
    savePdfBtn.parentNode.replaceChild(newBtn, savePdfBtn);

    newBtn.addEventListener('click', async () => {
      const title = document.getElementById('uploadTitle').value.trim();
      if (!title) { shake(document.getElementById('uploadTitle')); return; }
      if (!currentFileUrl || !window._pendingFile) {
        showToast('⚠️ Please upload a file first!');
        return;
      }

      const bookId = genId();
      const book   = {
        id:      bookId,
        title,
        author:  document.getElementById('uploadAuthor').value.trim(),
        cover:   '',
        notes:   '',
        reading: false,
        type:    currentFileType,
        fileUrl: null, // stored in IndexedDB, not here
        pdfUrl:  null,
        addedAt: Date.now()
      };

      showToast('💾 Saving book...');

      try {
        // Save actual file to IndexedDB permanently
        await saveFileToDB(bookId, window._pendingFile);

        // Extract cover using blob URL
        if (currentFileType === 'epub') {
          book.cover = await extractCoverFromEpub(currentFileUrl);
        } else if (currentFileType === 'pdf') {
          book.cover = await extractCoverFromPdf(currentFileUrl);
        }

        books.unshift(book);
        saveBooks();
        renderLibrary();
        renderReading();
        document.getElementById('addBookModal').classList.remove('open');
        clearAddForm();
        window._pendingFile = null;
        showToast(book.cover ? '📚 Book saved permanently!' : '📚 Book saved!');

      } catch(err) {
        console.error('Save failed:', err);
        showToast('⚠️ Could not save book. Try again.');
      }
    });
  }
}

// ========================
// BOOK DETAIL MODAL
// ========================
function setupModal() {
  document.getElementById('closeDetail').addEventListener('click', () => {
    document.getElementById('bookDetailModal').classList.remove('open');
    currentBookId = null;
  });

  document.getElementById('bookDetailModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('bookDetailModal')) {
      document.getElementById('bookDetailModal').classList.remove('open');
      currentBookId = null;
    }
  });

  document.getElementById('readBookBtn').addEventListener('click', async () => {
    const book = books.find(b => b.id === currentBookId);
    if (!book) return;
    document.getElementById('bookDetailModal').classList.remove('open');

    try {
      // Load file from IndexedDB and create fresh blob URL
      const file = await getFileFromDB(book.id);

      if (file) {
        const freshUrl = URL.createObjectURL(file);
        book.fileUrl   = freshUrl;
        book.pdfUrl    = book.type === 'pdf' ? freshUrl : null;
      }

      if (book.type === 'epub' && book.fileUrl) {
        openEpubReader(book);
      } else if (book.pdfUrl || book.fileUrl) {
        openPdfReader(book);
      } else if (book.openLibraryUrl) {
        window.open(book.openLibraryUrl, '_blank');
      } else {
        showToast('📖 No readable file found. Please re-upload the book.');
      }

    } catch(err) {
      console.error('Could not load file:', err);
      showToast('⚠️ Could not load book file.');
    }
  });

  document.getElementById('toggleReadingBtn').addEventListener('click', () => {
    const book = books.find(b => b.id === currentBookId);
    if (!book) return;
    book.reading = !book.reading;
    saveBooks();
    renderLibrary();
    renderReading();
    document.getElementById('toggleReadingBtn').innerHTML = book.reading
      ? '<i class="fas fa-bookmark"></i> Remove from Reading'
      : '<i class="fas fa-bookmark"></i> Currently Reading';
    showToast(book.reading
      ? '📖 Added to Currently Reading!'
      : '✅ Removed from Reading');
  });

  document.getElementById('deleteBookBtn').addEventListener('click', async () => {
    if (!currentBookId) return;

    // Delete file from IndexedDB
    try { await deleteFileFromDB(currentBookId); } catch(e) {}

    books = books.filter(b => b.id !== currentBookId);
    saveBooks();
    renderLibrary();
    renderReading();
    document.getElementById('bookDetailModal').classList.remove('open');
    currentBookId = null;
    showToast('🗑️ Book deleted.');
  });
}

function openBookDetail(id) {
  const book = books.find(b => b.id === id);
  if (!book) return;
  currentBookId = id;

  document.getElementById('detailTitle').textContent  = book.title;
  document.getElementById('detailAuthor').textContent =
    book.author || 'Unknown Author';

  const cover = document.getElementById('detailCover');
  if (book.cover) {
    cover.src           = book.cover;
    cover.style.display = 'block';
    cover.onerror       = () => { cover.style.display = 'none'; };
  } else {
    cover.style.display = 'none';
  }

  const readBtn     = document.getElementById('readBookBtn');
  const hasReadable = book.type === 'epub' || book.type === 'pdf'
    || book.openLibraryUrl;
  readBtn.style.display = hasReadable ? 'block' : 'none';

  const readLabel = book.type === 'epub'
    ? '📖 Read ePub'
    : book.type === 'pdf'
    ? '📄 Read PDF'
    : '🌐 Open Online';
  readBtn.innerHTML = `<i class="fas fa-book-reader"></i> ${readLabel}`;

  const saved   = getProgress(book.id);
  const percent = saved ? Math.round(saved.percent) : 0;
  const page    = saved ? saved.page : 0;
  const notesEl = document.getElementById('detailNotes');

  if ((book.type === 'epub' || book.type === 'pdf') && percent > 0) {
    notesEl.innerHTML = `
      ${book.notes || 'No notes added.'}
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
            letter-spacing:0.5px;color:var(--text-muted);">Reading Progress</span>
          <span style="font-size:0.75rem;font-weight:700;
            color:var(--accent3);">${percent}% · Page ${page}</span>
        </div>
        <div style="width:100%;height:8px;background:var(--bg-alt);
          border-radius:4px;border:2px solid var(--border);overflow:hidden;">
          <div style="width:${percent}%;height:100%;
            background:var(--accent3);border-radius:3px;"></div>
        </div>
      </div>
    `;
  } else {
    notesEl.textContent = book.notes || 'No notes added.';
  }

  document.getElementById('toggleReadingBtn').innerHTML = book.reading
    ? '<i class="fas fa-bookmark"></i> Remove from Reading'
    : '<i class="fas fa-bookmark"></i> Currently Reading';

  document.getElementById('bookDetailModal').classList.add('open');
}

// ========================
// PDF READER
// ========================
function setupReader() {
  document.getElementById('closeReader').addEventListener('click', closeReader);
}

function openPdfReader(book) {
  const url = book.fileUrl || book.pdfUrl;
  document.getElementById('readerTitle').textContent  = book.title;
  document.getElementById('pdfFrame').src             = url;
  document.getElementById('pdfFrame').style.display   = 'block';

  const epubContainer = document.getElementById('epubContainer');
  if (epubContainer) epubContainer.style.display = 'none';
  const epubControls = document.getElementById('epubControls');
  if (epubControls) epubControls.style.display = 'none';

  document.getElementById('pdfReader').classList.add('open');
}

function closeReader() {
  document.getElementById('pdfReader').classList.remove('open');
  document.getElementById('pdfFrame').src = '';

  if (window._epubResizeObserver) {
    window._epubResizeObserver.disconnect();
    window._epubResizeObserver = null;
  }

  if (epubBook) {
    try { epubBook.destroy(); } catch(e) {}
    epubBook      = null;
    epubRendition = null;
  }

  const epubContainer = document.getElementById('epubContainer');
  if (epubContainer) epubContainer.innerHTML = '';
}

// ========================
// EPUB READER
// ========================
function openEpubReader(book) {
  document.getElementById('readerTitle').textContent = book.title;

  const pdfFrame = document.getElementById('pdfFrame');
  pdfFrame.src   = '';
  pdfFrame.style.display = 'none';

  let epubContainer = document.getElementById('epubContainer');
  if (!epubContainer) {
    epubContainer    = document.createElement('div');
    epubContainer.id = 'epubContainer';
    document.getElementById('pdfReader').insertBefore(
      epubContainer,
      document.getElementById('pdfReader').lastElementChild
    );
  }
  epubContainer.style.cssText = `
    flex:1;width:100%;overflow:hidden;background:#f4ede4;
    display:flex;flex-direction:column;position:relative;min-height:0;
  `;
  epubContainer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
      height:100%;color:#7a5c3e;flex-direction:column;gap:12px;flex:1;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>
      <span style="font-family:'Space Grotesk',sans-serif;font-weight:600;">
        Loading book...
      </span>
    </div>
  `;

  let epubControls = document.getElementById('epubControls');
  if (!epubControls) {
    epubControls    = document.createElement('div');
    epubControls.id = 'epubControls';
    document.getElementById('pdfReader').appendChild(epubControls);
  }
  epubControls.style.cssText = `
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 16px;background:#ede4d8;
    border-top:3px solid #c4a882;gap:12px;flex-shrink:0;
  `;
  epubControls.innerHTML = `
    <button id="epubPrev" style="
      background:#d4b896;border:3px solid #a07850;border-radius:10px;
      padding:10px 16px;font-family:'Space Grotesk',sans-serif;
      font-weight:700;font-size:0.85rem;text-transform:uppercase;
      cursor:pointer;box-shadow:3px 3px 0 #a07850;color:#2c1a0e;
      transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;
    ">← Prev</button>

    <div style="display:flex;flex-direction:column;align-items:center;
      gap:4px;flex:1;">
      <span id="epubProgress" style="
        font-family:'Space Grotesk',sans-serif;font-size:0.75rem;
        font-weight:600;color:#7a5c3e;
        text-transform:uppercase;letter-spacing:1px;
      ">Loading...</span>
      <div style="width:100%;max-width:140px;height:5px;background:#c4a882;
        border-radius:3px;border:1.5px solid #a07850;overflow:hidden;">
        <div id="epubProgressBar" style="width:0%;height:100%;background:#9723C9;
          border-radius:2px;transition:width 0.4s ease;"></div>
      </div>
      <span id="epubPercent" style="
        font-family:'Space Grotesk',sans-serif;font-size:0.68rem;
        font-weight:700;color:#9723C9;letter-spacing:0.5px;">0%</span>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
        <button id="zoomOut" style="
          background:#d4b896;border:2px solid #a07850;border-radius:6px;
          width:28px;height:28px;font-size:1rem;font-weight:700;
          cursor:pointer;box-shadow:2px 2px 0 #a07850;color:#2c1a0e;
          display:flex;align-items:center;justify-content:center;
          transition:transform 0.1s,box-shadow 0.1s;">−</button>
        <span id="zoomLabel" style="
          font-family:'Space Grotesk',sans-serif;font-size:0.68rem;
          font-weight:700;color:#7a5c3e;min-width:36px;
          text-align:center;">100%</span>
        <button id="zoomIn" style="
          background:#d4b896;border:2px solid #a07850;border-radius:6px;
          width:28px;height:28px;font-size:1rem;font-weight:700;
          cursor:pointer;box-shadow:2px 2px 0 #a07850;color:#2c1a0e;
          display:flex;align-items:center;justify-content:center;
          transition:transform 0.1s,box-shadow 0.1s;">+</button>
        <button id="zoomReset" style="
          background:#c4a882;border:2px solid #a07850;border-radius:6px;
          padding:0 8px;height:28px;font-size:0.6rem;font-weight:700;
          cursor:pointer;box-shadow:2px 2px 0 #a07850;color:#2c1a0e;
          font-family:'Space Grotesk',sans-serif;text-transform:uppercase;
          transition:transform 0.1s,box-shadow 0.1s;">Reset</button>
      </div>
    </div>

    <button id="epubNext" style="
      background:#d4b896;border:3px solid #a07850;border-radius:10px;
      padding:10px 16px;font-family:'Space Grotesk',sans-serif;
      font-weight:700;font-size:0.85rem;text-transform:uppercase;
      cursor:pointer;box-shadow:3px 3px 0 #a07850;color:#2c1a0e;
      transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;
    ">Next →</button>
  `;

  document.getElementById('pdfReader').classList.add('open');

  if (epubBook) {
    try { epubBook.destroy(); } catch(e) {}
    epubBook      = null;
    epubRendition = null;
  }

  fetch(book.fileUrl)
    .then(res => res.arrayBuffer())
    .then(buffer => {
      epubContainer.innerHTML =
        '<div id="epubViewer" style="width:100%;height:100%;flex:1;"></div>';

      epubBook = ePub(buffer, { openAs: 'binary' });

      const getSize = () => {
        const viewer   = document.getElementById('epubViewer');
        const controls = document.getElementById('epubControls');
        const header   = document.querySelector('#pdfReader .reader-header');
        const totalH   = window.innerHeight
          - (header   ? header.offsetHeight   : 58)
          - (controls ? controls.offsetHeight : 60);
        return {
          w: viewer ? viewer.clientWidth || window.innerWidth : window.innerWidth,
          h: totalH > 0 ? totalH : window.innerHeight - 120
        };
      };

      const { w, h } = getSize();

      epubRendition = epubBook.renderTo('epubViewer', {
        width: w, height: h, spread: 'none', flow: 'paginated'
      });

      // ── Zoom helpers ───────────────────────────────────────
      function injectZoomIntoIframe() {
        try {
          document.querySelectorAll('#epubViewer iframe').forEach(iframe => {
            const doc = iframe.contentDocument
              || iframe.contentWindow?.document;
            if (!doc) return;
            const old = doc.getElementById('luminae-zoom');
            if (old) old.remove();
            const style = doc.createElement('style');
            style.id = 'luminae-zoom';
            style.textContent = `
              html, body { font-size: ${currentFontSize}% !important; }
              p, span, div, li, td, th, blockquote {
                font-size: inherit !important; }
            `;
            doc.head.appendChild(style);
          });
        } catch(e) { console.warn('Zoom inject failed:', e); }
      }

      function applyZoom(size) {
        currentFontSize = Math.min(200, Math.max(70, Math.round(size)));
        const zoomLabel = document.getElementById('zoomLabel');
        if (zoomLabel) zoomLabel.textContent = `${currentFontSize}%`;
        if (epubRendition) {
          try { epubRendition.themes.fontSize(`${currentFontSize}%`); } catch(e) {}
        }
        injectZoomIntoIframe();

        // Persist zoom into saved progress
        const prog = JSON.parse(
          localStorage.getItem('luminae-progress') || '{}'
        );
        if (prog[book.id]) {
          prog[book.id].fontSize = currentFontSize;
          localStorage.setItem('luminae-progress', JSON.stringify(prog));
        }
      }

      // ── Restore position & zoom after locations ready ──────
      epubBook.ready.then(() => {
        applyEpubTheme();
        const savedProgress = getProgress(book.id);
        currentFontSize = savedProgress
          ? (savedProgress.fontSize || 100) : 100;
        const zoomLabel = document.getElementById('zoomLabel');
        if (zoomLabel) zoomLabel.textContent = `${currentFontSize}%`;
        return epubBook.locations.generate(1024);

      }).then(() => {
        const savedProgress = getProgress(book.id);

        if (savedProgress && savedProgress.cfi) {
          epubRendition.display(savedProgress.cfi)
            .then(() => {
              applyZoom(currentFontSize);
              updateProgressBar(savedProgress.percent);
              // Off-by-one correction
              const loc = epubRendition.currentLocation();
              if (loc && loc.start) {
                const currentPage = loc.start.displayed.page;
                const savedPage   = savedProgress.page || 0;
                if (savedPage > 0 && currentPage !== savedPage) {
                  epubRendition.display(savedProgress.cfi);
                }
              }
            })
            .catch(() => {
              epubRendition.display();
              applyZoom(currentFontSize);
            });
        } else {
          epubRendition.display();
          applyZoom(currentFontSize);
        }
      });

      // ── Track page turns ───────────────────────────────────
      epubRendition.on('relocated', (location) => {
        if (!location.start) return;
        const page  = location.start.displayed.page  || 1;
        const total = location.start.displayed.total || '?';
        const progressEl = document.getElementById('epubProgress');
        if (progressEl) progressEl.textContent = `Page ${page} of ${total}`;

        if (epubBook.locations && epubBook.locations.length()) {
          const percent = epubBook.locations.percentageFromCfi(
            location.start.cfi
          ) * 100;
          const prog = JSON.parse(
            localStorage.getItem('luminae-progress') || '{}'
          );
          prog[book.id] = {
            cfi:      location.start.cfi,
            percent,
            fontSize: currentFontSize,
            page
          };
          localStorage.setItem('luminae-progress', JSON.stringify(prog));
          updateProgressBar(percent);
          renderLibrary();
          renderReading();
        }
      });

      // ── Nav buttons ────────────────────────────────────────
      document.getElementById('epubPrev').onclick =
        () => { if (epubRendition) epubRendition.prev(); };
      document.getElementById('epubNext').onclick =
        () => { if (epubRendition) epubRendition.next(); };

      // ── Zoom buttons ───────────────────────────────────────
      document.getElementById('zoomOut').onclick   =
        () => applyZoom(currentFontSize - 10);
      document.getElementById('zoomIn').onclick    =
        () => applyZoom(currentFontSize + 10);
      document.getElementById('zoomReset').onclick =
        () => applyZoom(100);

      // ── Pinch to zoom ──────────────────────────────────────
      let pinchStartDist = 0;
      let pinchStartSize = 100;
      let isPinching     = false;

      function getPinchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      const onPinchStart = (e) => {
        if (e.touches.length !== 2) return;
        isPinching     = true;
        pinchStartDist = getPinchDist(e);
        pinchStartSize = currentFontSize;
      };
      const onPinchMove = (e) => {
        if (!isPinching || e.touches.length !== 2) return;
        e.preventDefault();
        applyZoom(Math.round(
          pinchStartSize * (getPinchDist(e) / pinchStartDist)
        ));
      };
      const onPinchEnd = (e) => {
        if (e.touches.length < 2) isPinching = false;
      };

      // ── Swipe ──────────────────────────────────────────────
      let touchStartX = 0;
      let touchStartY = 0;

      const onTouchStart = (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
      };
      const onTouchEnd = (e) => {
        if (isPinching) return;
        const diffX = touchStartX - e.changedTouches[0].screenX;
        const diffY = touchStartY - e.changedTouches[0].screenY;
        if (Math.abs(diffX) < 60) return;
        if (Math.abs(diffX) < Math.abs(diffY)) return;
        if (!epubRendition) return;
        if (diffX > 0) epubRendition.next();
        else           epubRendition.prev();
      };

      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchend',   onTouchEnd,   { passive: true });
      window.addEventListener('touchstart', onPinchStart, { passive: true });
      window.addEventListener('touchmove',  onPinchMove,  { passive: false });
      window.addEventListener('touchend',   onPinchEnd,   { passive: true });

      // ── Re-inject into iframe on each page render ──────────
      epubRendition.on('rendered', () => {
        try {
          const iframeDoc =
            document.querySelector('#epubViewer iframe')?.contentDocument;
          if (!iframeDoc) return;
          iframeDoc.addEventListener('touchstart', onTouchStart, { passive: true });
          iframeDoc.addEventListener('touchend',   onTouchEnd,   { passive: true });
          iframeDoc.addEventListener('touchstart', onPinchStart, { passive: true });
          iframeDoc.addEventListener('touchmove',  onPinchMove,  { passive: false });
          iframeDoc.addEventListener('touchend',   onPinchEnd,   { passive: true });
          injectZoomIntoIframe();
        } catch(e) { console.warn('Could not attach to iframe:', e); }
      });

      // ── Cleanup on close ───────────────────────────────────
      document.getElementById('closeReader')
        .addEventListener('click', () => {
          window.removeEventListener('touchstart', onTouchStart);
          window.removeEventListener('touchend',   onTouchEnd);
          window.removeEventListener('touchstart', onPinchStart);
          window.removeEventListener('touchmove',  onPinchMove);
          window.removeEventListener('touchend',   onPinchEnd);
        });

      // ── Keyboard nav ───────────────────────────────────────
      document.addEventListener('keyup', (e) => {
        if (!document.getElementById('pdfReader')
          .classList.contains('open')) return;
        if (e.key === 'ArrowRight') epubRendition.next();
        if (e.key === 'ArrowLeft')  epubRendition.prev();
      });

      // ── Resize observer ────────────────────────────────────
      if (window._epubResizeObserver) {
        window._epubResizeObserver.disconnect();
      }
      window._epubResizeObserver = new ResizeObserver(() => {
        if (!epubRendition) return;
        const { w: newW, h: newH } = getSize();
        epubRendition.resize(newW, newH);
      });
      window._epubResizeObserver.observe(
        document.getElementById('pdfReader')
      );
    })
    .catch(err => {
      console.error('ePub load error:', err);
      showToast('⚠️ Could not open this ePub. File may be corrupted.');
      const progress = document.getElementById('epubProgress');
      if (progress) progress.textContent = 'Failed to load';
    });
}

function updateProgressBar(percent) {
  const bar     = document.getElementById('epubProgressBar');
  const label   = document.getElementById('epubPercent');
  const rounded = Math.round(percent);
  if (bar)   bar.style.width   = `${rounded}%`;
  if (label) label.textContent = `${rounded}%`;
}

// ========================
// EPUB THEME
// ========================
function applyEpubTheme() {
  if (!epubRendition) return;
  try {
    epubRendition.themes.register('light', {
      'body': {
        'background':  '#fdf6ec !important',
        'color':       '#2c1a0e !important',
        'font-family': "'Palatino Linotype', Palatino, Georgia, serif !important",
        'font-size':   '1.05rem !important',
        'line-height': '1.85 !important',
        'padding':     '32px 40px !important',
        'max-width':   '680px !important',
        'margin':      '0 auto !important'
      },
      'p': {
        'margin-bottom': '1.2em !important',
        'text-indent':   '1.5em !important',
        'text-align':    'justify !important'
      },
      'h1, h2, h3': {
        'font-family':   "'Playfair Display', Georgia, serif !important",
        'color':         '#4a2c0e !important',
        'text-indent':   '0 !important',
        'margin-bottom': '0.8em !important'
      },
      'a': { 'color': '#9723C9 !important' }
    });

    epubRendition.themes.register('dark', {
      'body': {
        'background':  '#1c1008 !important',
        'color':       '#e8d5b8 !important',
        'font-family': "'Palatino Linotype', Palatino, Georgia, serif !important",
        'font-size':   '1.05rem !important',
        'line-height': '1.85 !important',
        'padding':     '32px 40px !important',
        'max-width':   '680px !important',
        'margin':      '0 auto !important'
      },
      'p': {
        'margin-bottom': '1.2em !important',
        'text-indent':   '1.5em !important',
        'text-align':    'justify !important'
      },
      'h1, h2, h3': {
        'font-family':   "'Playfair Display', Georgia, serif !important",
        'color':         '#d4a87a !important',
        'text-indent':   '0 !important',
        'margin-bottom': '0.8em !important'
      },
      'a': { 'color': '#C4A1FF !important' }
    });

    epubRendition.themes.select(darkMode ? 'dark' : 'light');

    const iframe = document.querySelector('#epubViewer iframe');
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      const body = iframe.contentDocument.body;
      body.style.setProperty(
        'background', darkMode ? '#1c1008' : '#fdf6ec', 'important'
      );
      body.style.setProperty(
        'color', darkMode ? '#e8d5b8' : '#2c1a0e', 'important'
      );
      body.style.setProperty(
        'transition', 'background 0.3s, color 0.3s', 'important'
      );
    }

    const container = document.getElementById('epubContainer');
    if (container) {
      container.style.background = darkMode ? '#1c1008' : '#f4ede4';
      container.style.transition = 'background 0.3s';
    }

    const controls = document.getElementById('epubControls');
    if (controls) {
      controls.style.background  = darkMode ? '#140e08' : '#ede4d8';
      controls.style.borderColor = darkMode ? '#4a3728' : '#c4a882';
    }

    document.querySelectorAll('#epubControls button').forEach(btn => {
      btn.style.background  = darkMode ? '#3d2a1a' : '#d4b896';
      btn.style.borderColor = darkMode ? '#6b4a2e' : '#a07850';
      btn.style.color       = darkMode ? '#f0e0c8' : '#2c1a0e';
      btn.style.boxShadow   = darkMode
        ? '2px 2px 0 #6b4a2e' : '2px 2px 0 #a07850';
    });

    const progressEl = document.getElementById('epubProgress');
    if (progressEl) progressEl.style.color = darkMode ? '#b08060' : '#7a5c3e';

    const zoomLabel = document.getElementById('zoomLabel');
    if (zoomLabel) zoomLabel.style.color = darkMode ? '#b08060' : '#7a5c3e';

    const header = document.querySelector('#pdfReader .reader-header');
    if (header) {
      header.style.background  = darkMode ? '#1c1008' : '#e8ddd0';
      header.style.borderColor = darkMode ? '#4a3728' : '#c4a882';
    }

    setTimeout(() => {
      if (!epubRendition) return;
      const viewer   = document.getElementById('epubViewer');
      const controls = document.getElementById('epubControls');
      const header   = document.querySelector('#pdfReader .reader-header');
      const totalH   = window.innerHeight
        - (header   ? header.offsetHeight   : 58)
        - (controls ? controls.offsetHeight : 60);
      const w = viewer
        ? viewer.clientWidth || window.innerWidth : window.innerWidth;
      const h = totalH > 0 ? totalH : window.innerHeight - 120;
      epubRendition.resize(w, h);
    }, 50);

  } catch(e) { console.warn('Theme apply failed:', e); }
}

// ========================
// BOOK SEARCH (OPEN LIBRARY)
// ========================
function setupSearch() {
  const input = document.getElementById('searchInput');
  const btn   = document.getElementById('searchBtn');
  btn.addEventListener('click', () => searchBooks());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBooks();
  });
}

async function searchBooks() {
  const query       = document.getElementById('searchInput').value.trim();
  if (!query) return;

  const resultsGrid = document.getElementById('searchResults');
  const empty       = document.getElementById('searchEmpty');

  resultsGrid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:40px;
      color:var(--text-muted);">
      <i class="fas fa-spinner fa-spin"
        style="font-size:2rem;margin-bottom:12px;display:block;"></i>
      Searching...
    </div>
  `;
  empty.style.display = 'none';

  try {
    const res  = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20`
    );
    const data = await res.json();
    resultsGrid.innerHTML = '';

    if (!data.docs || data.docs.length === 0) {
      empty.style.display = 'flex';
      return;
    }

    data.docs.slice(0, 20).forEach(doc => {
      const coverId  = doc.cover_i;
      const coverUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '';
      const title  = doc.title || 'Unknown Title';
      const author = doc.author_name ? doc.author_name[0] : 'Unknown Author';
      const year   = doc.first_publish_year || '';
      const key    = doc.key || '';

      const card      = document.createElement('div');
      card.className  = 'book-card';
      const coverHtml = coverUrl
        ? `<img class="book-cover" src="${coverUrl}" alt="${title}"
            onerror="this.outerHTML='<div class=\\'book-cover-placeholder\\'>📚</div>'">`
        : `<div class="book-cover-placeholder">📚</div>`;

      card.innerHTML = `
        ${coverHtml}
        <div class="book-info">
          <h3>${title}</h3>
          <p>${author}</p>
          ${year ? `<span class="book-badge">${year}</span>` : ''}
          <button class="btn-add-search" style="
            margin-top:8px;width:100%;background:var(--accent3);color:white;
            border:3px solid var(--border);border-radius:8px;padding:6px;
            font-size:0.72rem;font-weight:700;
            font-family:'Space Grotesk',sans-serif;text-transform:uppercase;
            cursor:pointer;box-shadow:var(--shadow-sm);
            transition:transform 0.1s,box-shadow 0.1s;
          ">+ Add to Library</button>
        </div>
      `;

      card.querySelector('.btn-add-search').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        addFromSearch(title, author, coverUrl, key);
        btn.textContent      = '✓ Added!';
        btn.style.background = '#9723C9';
        btn.disabled         = true;
      });

      resultsGrid.appendChild(card);
    });

  } catch(err) {
    resultsGrid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;
        color:var(--text-muted);">
        <i class="fas fa-wifi"
          style="font-size:2rem;display:block;margin-bottom:12px;"></i>
        Could not connect. Check your internet.
      </div>
    `;
  }
}

function addFromSearch(title, author, cover, key) {
  if (books.some(b => b.title === title && b.author === author)) {
    showToast('📚 Already in your library!');
    return;
  }
  books.unshift({
    id:             genId(),
    title, author, cover,
    notes:          '',
    reading:        false,
    type:           'openlibrary',
    openLibraryUrl: key ? `https://openlibrary.org${key}` : '',
    addedAt:        Date.now()
  });
  saveBooks();
  renderLibrary();
  renderReading();
  showToast(`📚 "${title}" added to library!`);
}

// ========================
// TOAST NOTIFICATION
// ========================
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast       = document.createElement('div');
  toast.className   = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position:fixed;bottom:90px;left:50%;
    transform:translateX(-50%) translateY(20px);
    background:var(--text);color:var(--bg);
    padding:12px 22px;border-radius:12px;
    border:2px solid var(--border);
    font-family:'Space Grotesk',sans-serif;
    font-size:0.85rem;font-weight:700;
    box-shadow:var(--shadow);z-index:999;
    opacity:0;transition:opacity 0.2s,transform 0.2s;
    white-space:nowrap;
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity   = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// ========================
// SHAKE ANIMATION
// ========================
function shake(el) {
  el.style.border = '3px solid #ff4d4d';
  setTimeout(() => { el.style.border = ''; }, 1500);
}