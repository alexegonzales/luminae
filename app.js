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
    applyPdfTheme();
  });

  const readerBtn = document.getElementById('readerThemeToggle');
  if (readerBtn) {
    readerBtn.addEventListener('click', () => {
      darkMode = !darkMode;
      document.body.classList.toggle('dark', darkMode);
      localStorage.setItem('luminae-dark', darkMode);
      updateThemeIcon(btn);
      applyEpubTheme();
      applyPdfTheme();
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
        window._pendingFile = file;

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
        fileUrl: null,
        pdfUrl:  null,
        addedAt: Date.now()
      };

      showToast('💾 Saving book...');

      try {
        await saveFileToDB(bookId, window._pendingFile);

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

async function openPdfReader(book) {
  const url = book.fileUrl || book.pdfUrl;
  if (!url) { showToast('⚠️ No file found. Please re-upload the book.'); return; }

  document.getElementById('readerTitle').textContent = book.title;

  // ── Hide iframe, show epub-style container ─────────────────
  const pdfFrame = document.getElementById('pdfFrame');
  pdfFrame.src = ''; pdfFrame.style.display = 'none';

  // Reuse the exact same epubContainer and epubControls the epub reader uses
  // This means the PDF reader IS the epub reader visually — same DOM, same CSS
  let epubContainer = document.getElementById('epubContainer');
  if (!epubContainer) {
    epubContainer    = document.createElement('div');
    epubContainer.id = 'epubContainer';
    document.getElementById('pdfReader').insertBefore(
      epubContainer,
      document.getElementById('pdfReader').lastElementChild
    );
  }
  epubContainer.style.display = '';
  epubContainer.style.cssText = `
    flex:1;width:100%;overflow:hidden;
    background:${darkMode ? '#1c1008' : '#f4ede4'};
    display:flex;flex-direction:column;position:relative;min-height:0;
  `;
  epubContainer.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
      height:100%;color:${darkMode ? '#b08060' : '#7a5c3e'};
      flex-direction:column;gap:12px;flex:1;">
      <i class="fas fa-spinner fa-spin" style="font-size:2rem;color:#9723C9;"></i>
      <span style="font-family:'Space Grotesk',sans-serif;font-weight:600;">
        Loading book...
      </span>
    </div>`;

  // ── Controls bar — identical to epub controls ──────────────
  let epubControls = document.getElementById('epubControls');
  if (!epubControls) {
    epubControls    = document.createElement('div');
    epubControls.id = 'epubControls';
    document.getElementById('pdfReader').appendChild(epubControls);
  }
  epubControls.style.display = '';
  epubControls.style.cssText = `
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 16px;background:${darkMode ? '#140e08' : '#ede4d8'};
    border-top:3px solid ${darkMode ? '#4a3728' : '#c4a882'};gap:12px;flex-shrink:0;
  `;
  epubControls.innerHTML = `
    <button id="pdfPrev" style="
      background:${darkMode?'#3d2a1a':'#d4b896'};
      border:3px solid ${darkMode?'#6b4a2e':'#a07850'};border-radius:10px;
      padding:10px 16px;font-family:'Space Grotesk',sans-serif;
      font-weight:700;font-size:0.85rem;text-transform:uppercase;
      cursor:pointer;box-shadow:${darkMode?'3px 3px 0 #6b4a2e':'3px 3px 0 #a07850'};
      color:${darkMode?'#f0e0c8':'#2c1a0e'};
      transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;">← Prev</button>

    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
      <span id="pdfPageLabel" style="
        font-family:'Space Grotesk',sans-serif;font-size:0.75rem;font-weight:600;
        color:${darkMode?'#b08060':'#7a5c3e'};text-transform:uppercase;letter-spacing:1px;">
        Page 1 of ?</span>

      <div style="width:100%;max-width:220px;position:relative;">
        <input id="pdfSeekBar" type="range" min="1" max="100" value="1" step="1" style="
          width:100%;height:18px;cursor:pointer;accent-color:#9723C9;
          -webkit-appearance:none;appearance:none;background:transparent;padding:0;margin:0;"/>
        <style>
          #pdfSeekBar::-webkit-slider-runnable-track{height:6px;border-radius:3px;
            background:linear-gradient(to right,#9723C9 var(--pdf-pct,0%),
              ${darkMode?'#4a3728':'#c4a882'} var(--pdf-pct,0%));
            border:1.5px solid ${darkMode?'#6b4a2e':'#a07850'};}
          #pdfSeekBar::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
            width:16px;height:16px;border-radius:50%;background:#9723C9;cursor:grab;
            border:2px solid ${darkMode?'#1c1008':'#fff'};
            box-shadow:0 0 0 2px #9723C9;margin-top:-6px;}
          #pdfSeekBar:active::-webkit-slider-thumb{cursor:grabbing;}
          #pdfSeekBar::-moz-range-track{height:6px;border-radius:3px;
            background:${darkMode?'#4a3728':'#c4a882'};
            border:1.5px solid ${darkMode?'#6b4a2e':'#a07850'};}
          #pdfSeekBar::-moz-range-progress{background:#9723C9;height:6px;border-radius:3px;}
          #pdfSeekBar::-moz-range-thumb{width:16px;height:16px;border-radius:50%;
            background:#9723C9;cursor:grab;
            border:2px solid ${darkMode?'#1c1008':'#fff'};box-shadow:0 0 0 2px #9723C9;}
        </style>
      </div>

      <span id="pdfPercent" style="
        font-family:'Space Grotesk',sans-serif;font-size:0.68rem;
        font-weight:700;color:${darkMode?'#d4a87a':'#9723C9'};letter-spacing:0.5px;">0%</span>

      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
        <button id="pdfZoomOut" style="
          background:${darkMode?'#3d2a1a':'#d4b896'};
          border:2px solid ${darkMode?'#6b4a2e':'#a07850'};border-radius:6px;
          width:28px;height:28px;font-size:1rem;font-weight:700;cursor:pointer;
          box-shadow:${darkMode?'2px 2px 0 #6b4a2e':'2px 2px 0 #a07850'};
          color:${darkMode?'#f0e0c8':'#2c1a0e'};
          display:flex;align-items:center;justify-content:center;
          transition:transform 0.1s,box-shadow 0.1s;">−</button>
        <span id="pdfZoomLabel" style="
          font-family:'Space Grotesk',sans-serif;font-size:0.68rem;
          font-weight:700;color:${darkMode?'#b08060':'#7a5c3e'};
          min-width:36px;text-align:center;">100%</span>
        <button id="pdfZoomIn" style="
          background:${darkMode?'#3d2a1a':'#d4b896'};
          border:2px solid ${darkMode?'#6b4a2e':'#a07850'};border-radius:6px;
          width:28px;height:28px;font-size:1rem;font-weight:700;cursor:pointer;
          box-shadow:${darkMode?'2px 2px 0 #6b4a2e':'2px 2px 0 #a07850'};
          color:${darkMode?'#f0e0c8':'#2c1a0e'};
          display:flex;align-items:center;justify-content:center;
          transition:transform 0.1s,box-shadow 0.1s;">+</button>
        <button id="pdfZoomReset" style="
          background:${darkMode?'#2a1a0a':'#c4a882'};
          border:2px solid ${darkMode?'#6b4a2e':'#a07850'};border-radius:6px;
          padding:0 8px;height:28px;font-size:0.6rem;font-weight:700;cursor:pointer;
          box-shadow:${darkMode?'2px 2px 0 #6b4a2e':'2px 2px 0 #a07850'};
          color:${darkMode?'#f0e0c8':'#2c1a0e'};
          font-family:'Space Grotesk',sans-serif;text-transform:uppercase;
          display:flex;align-items:center;justify-content:center;line-height:1;
          transition:transform 0.1s,box-shadow 0.1s;">Reset</button>
      </div>
    </div>

    <button id="pdfNext" style="
      background:${darkMode?'#3d2a1a':'#d4b896'};
      border:3px solid ${darkMode?'#6b4a2e':'#a07850'};border-radius:10px;
      padding:10px 16px;font-family:'Space Grotesk',sans-serif;
      font-weight:700;font-size:0.85rem;text-transform:uppercase;
      cursor:pointer;box-shadow:${darkMode?'3px 3px 0 #6b4a2e':'3px 3px 0 #a07850'};
      color:${darkMode?'#f0e0c8':'#2c1a0e'};
      transition:transform 0.1s,box-shadow 0.1s;flex-shrink:0;">Next →</button>
  `;

  document.getElementById('pdfReader').classList.add('open');

  try {
    await loadPdfJs();
    const pdfDoc     = await pdfjsLib.getDocument(url).promise;
    const totalPages = pdfDoc.numPages;
    const seekBar    = document.getElementById('pdfSeekBar');
    seekBar.max      = totalPages;

    const saved      = getProgress(book.id);
    let currentPage  = (saved && saved.page) ? Math.min(saved.page, totalPages) : 1;
    let pdfFontSize  = (saved && saved.fontSize) ? saved.fontSize : 100;

    // ── Text extraction + HTML rendering ──────────────────────
    // Extract the PDF text layer and render it as flowing HTML — same
    // typography, same CSS classes, same dark/light theming as the epub reader.
    // This makes the PDF reading experience identical to the epub experience.

    // Cache extracted pages so we don't re-extract on zoom/theme changes
    const pageCache = {};

    async function extractPageHtml(pageNum) {
      if (pageCache[pageNum]) return pageCache[pageNum];

      const page       = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport   = page.getViewport({ scale: 1 });

      // Group text items into lines by their Y position (±3pt tolerance)
      const lines = [];
      let   lastY = null;
      let   currentLine = [];

      // Sort items top-to-bottom, left-to-right
      const items = [...textContent.items].sort((a, b) => {
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 3) return yDiff;
        return a.transform[4] - b.transform[4];
      });

      for (const item of items) {
        const text = item.str;
        if (!text.trim()) { currentLine.push(' '); continue; }
        const y = Math.round(item.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          if (currentLine.length) lines.push(currentLine.join(''));
          currentLine = [];
        }
        lastY = y;
        currentLine.push(text);
      }
      if (currentLine.length) lines.push(currentLine.join(''));

      // Heuristically group lines into paragraphs.
      // A short line followed by content suggests a heading or paragraph break.
      // Adjacent lines with similar length merge into a paragraph.
      const pageW   = viewport.width;
      const htmlLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const charWidth   = line.length;
        const isShortLine = charWidth < 60;
        const nextLine    = lines[i + 1] ? lines[i + 1].trim() : '';
        const prevLine    = lines[i - 1] ? lines[i - 1].trim() : '';

        // Detect heading: short, possibly ALL CAPS or title-case, standalone
        const isAllCaps   = line === line.toUpperCase() && /[A-Z]/.test(line);
        const isTitleCase = line.split(' ').filter(w => w).every(
          w => !w[0] || w[0] === w[0].toUpperCase()
        );
        const isHeading   = isShortLine && charWidth < 80 && charWidth > 1 &&
                            (isAllCaps || isTitleCase) &&
                            (!nextLine || nextLine.length < 80);

        if (isHeading && charWidth < 50) {
          htmlLines.push(`<h2>${escHtml(line)}</h2>`);
        } else if (isShortLine && !nextLine) {
          htmlLines.push(`<p>${escHtml(line)}</p>`);
        } else {
          // Check if previous output ended a paragraph — if so start fresh
          const lastTag = htmlLines.length
            ? htmlLines[htmlLines.length - 1]
            : '';
          if (!lastTag.startsWith('<p') || lastTag.endsWith('</p>')) {
            htmlLines.push(`<p>${escHtml(line)}`);
          } else {
            // Continue same paragraph — append with space
            htmlLines[htmlLines.length - 1] += ' ' + escHtml(line);
          }
          // Close paragraph if next line is blank, short standalone, or heading
          const nextIsBreak = !nextLine ||
            nextLine.length < 40 ||
            (nextLine === nextLine.toUpperCase() && /[A-Z]/.test(nextLine));
          if (nextIsBreak) {
            if (!htmlLines[htmlLines.length - 1].endsWith('</p>')) {
              htmlLines[htmlLines.length - 1] += '</p>';
            }
          }
        }
      }

      // Close any unclosed paragraph
      if (htmlLines.length && !htmlLines[htmlLines.length - 1].endsWith('>')) {
        htmlLines[htmlLines.length - 1] += '</p>';
      }

      const html = htmlLines.join('\n') ||
        `<p style="color:${darkMode?'#b08060':'#7a5c3e'};font-style:italic;text-align:center;">
          (This page has no extractable text — it may be an image or scanned page.)
        </p>`;

      pageCache[pageNum] = html;
      return html;
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Viewer div (same id as epub — uses same CSS rules) ───
    function buildViewer() {
      epubContainer.innerHTML = '';
      const header   = document.querySelector('#pdfReader .reader-header');
      const ctrl     = document.getElementById('epubControls');
      const headerH  = header ? header.offsetHeight : 58;
      const ctrlH    = ctrl   ? ctrl.offsetHeight   : 60;
      const fullW    = window.innerWidth;
      const fullH    = window.innerHeight - headerH - ctrlH;
      const viewW    = Math.min(fullW, 680);
      const viewH    = Math.max(fullH, 300);
      const leftOff  = Math.floor((fullW - viewW) / 2);

      const viewer        = document.createElement('div');
      viewer.id           = 'epubViewer';
      viewer.style.cssText =
        `width:${viewW}px;height:${viewH}px;` +
        `position:absolute;top:0;left:${leftOff}px;overflow-y:auto;overflow-x:hidden;` +
        `padding:32px 40px;box-sizing:border-box;`;
      epubContainer.appendChild(viewer);
      return viewer;
    }

    // ── Apply typography — mirrors applyEpubTheme exactly ────
    function applyPdfTypography(viewer) {
      if (!viewer) return;
      const dm = darkMode;
      viewer.style.background = dm ? '#1c1008' : '#fdf6ec';
      viewer.style.color      = dm ? '#e8d5b8' : '#2c1a0e';
      viewer.style.fontFamily = "'Palatino Linotype', Palatino, Georgia, serif";
      viewer.style.fontSize   = `${pdfFontSize}%`;
      viewer.style.lineHeight = '1.85';

      // Inject a style tag for headings and paragraphs
      let styleEl = viewer.querySelector('#pdf-typo');
      if (!styleEl) {
        styleEl    = document.createElement('style');
        styleEl.id = 'pdf-typo';
        viewer.prepend(styleEl);
      }
      styleEl.textContent = `
        #epubViewer p {
          margin-bottom: 1.2em;
          text-indent: 1.5em;
          text-align: justify;
          color: ${dm ? '#e8d5b8' : '#2c1a0e'};
          font-size: 1em;
          line-height: 1.85;
        }
        #epubViewer h1, #epubViewer h2, #epubViewer h3 {
          font-family: 'Playfair Display', Georgia, serif;
          color: ${dm ? '#d4a87a' : '#4a2c0e'};
          text-indent: 0;
          margin: 1.2em 0 0.6em;
          line-height: 1.3;
        }
        #epubViewer h2 { font-size: 1.3em; }
        #epubViewer h3 { font-size: 1.1em; }
        #epubViewer a  { color: ${dm ? '#C4A1FF' : '#9723C9'}; }
      `;
    }

    // ── Render a page ─────────────────────────────────────────
    let viewer = buildViewer();

    async function renderPage(pageNum) {
      currentPage = Math.max(1, Math.min(pageNum, totalPages));

      // Show spinner in the viewer
      if (viewer) {
        viewer.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;
            flex-direction:column;gap:12px;min-height:200px;
            color:${darkMode?'#b08060':'#7a5c3e'};
            font-family:'Space Grotesk',sans-serif;font-size:0.85rem;
            font-weight:600;text-transform:uppercase;letter-spacing:1px;">
            <i class="fas fa-spinner fa-spin" style="font-size:1.5rem;color:#9723C9;"></i>
            Page ${currentPage} of ${totalPages}
          </div>`;
      }

      const html = await extractPageHtml(currentPage);
      applyPdfTypography(viewer);
      viewer.innerHTML = html;
      applyPdfTypography(viewer);  // re-apply after innerHTML clears style tag
      viewer.scrollTop = 0;

      // Update controls
      const pct = Math.round((currentPage / totalPages) * 100);
      document.getElementById('pdfPageLabel').textContent = `Page ${currentPage} of ${totalPages}`;
      document.getElementById('pdfPercent').textContent   = `${pct}%`;
      document.getElementById('pdfZoomLabel').textContent = `${pdfFontSize}%`;
      seekBar.value = currentPage;
      seekBar.style.setProperty('--pdf-pct',
        `${((currentPage - 1) / Math.max(totalPages - 1, 1)) * 100}%`);

      saveProgress(book.id, null, pct, pdfFontSize, currentPage);
      renderLibrary();
      renderReading();
    }

    // ── Zoom — same as epub: adjusts font size on the live text ─
    function applyZoom(size) {
      pdfFontSize = Math.min(200, Math.max(70, Math.round(size)));
      document.getElementById('pdfZoomLabel').textContent = `${pdfFontSize}%`;
      if (viewer) viewer.style.fontSize = `${pdfFontSize}%`;
      // Re-apply to update style tag colours too
      applyPdfTypography(viewer);
      // Save zoom
      const prog = JSON.parse(localStorage.getItem('luminae-progress') || '{}');
      if (prog[book.id]) {
        prog[book.id].fontSize = pdfFontSize;
        localStorage.setItem('luminae-progress', JSON.stringify(prog));
      }
    }

    // ── Wire controls ─────────────────────────────────────────
    document.getElementById('pdfPrev').onclick      = () => renderPage(currentPage - 1);
    document.getElementById('pdfNext').onclick      = () => renderPage(currentPage + 1);
    document.getElementById('pdfZoomOut').onclick   = () => applyZoom(pdfFontSize - 10);
    document.getElementById('pdfZoomIn').onclick    = () => applyZoom(pdfFontSize + 10);
    document.getElementById('pdfZoomReset').onclick = () => applyZoom(100);

    seekBar.addEventListener('input', () => {
      const pg  = parseInt(seekBar.value);
      const pct = ((pg - 1) / Math.max(totalPages - 1, 1)) * 100;
      seekBar.style.setProperty('--pdf-pct', `${pct}%`);
      document.getElementById('pdfPageLabel').textContent = `Page ${pg} of ${totalPages}`;
    });
    seekBar.addEventListener('change', () => renderPage(parseInt(seekBar.value)));

    // Keyboard nav
    const onKey = (e) => {
      if (!document.getElementById('pdfReader').classList.contains('open')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') renderPage(currentPage + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   renderPage(currentPage - 1);
    };
    document.addEventListener('keyup', onKey);

    // Pinch-to-zoom
    let pinchDist0 = 0, pinchSize0 = 100, isPinching = false;
    epubContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      isPinching = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist0 = Math.sqrt(dx*dx + dy*dy);
      pinchSize0 = pdfFontSize;
    }, { passive: true });
    epubContainer.addEventListener('touchmove', (e) => {
      if (!isPinching || e.touches.length !== 2) return;
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      applyZoom(Math.round(pinchSize0 * (dist / pinchDist0)));
    }, { passive: true });
    epubContainer.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) isPinching = false;
    }, { passive: true });

    // Swipe navigation
    let swipeX = 0, swipeY = 0;
    epubContainer.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        swipeX = e.changedTouches[0].screenX;
        swipeY = e.changedTouches[0].screenY;
      }
    }, { passive: true });
    epubContainer.addEventListener('touchend', (e) => {
      if (isPinching) return;
      const dx = swipeX - e.changedTouches[0].screenX;
      const dy = swipeY - e.changedTouches[0].screenY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
      dx > 0 ? renderPage(currentPage + 1) : renderPage(currentPage - 1);
    }, { passive: true });

    // Resize — rebuild viewer at new dimensions
    const onResize = () => {
      clearTimeout(onResize._t);
      onResize._t = setTimeout(() => {
        viewer = buildViewer();
        renderPage(currentPage);
      }, 200);
    };
    window.addEventListener('resize', onResize);

    // Store cleanup
    book._pdfCleanup = () => {
      document.removeEventListener('keyup', onKey);
      window.removeEventListener('resize', onResize);
    };

    // Pre-fetch next 2 pages in background for snappy navigation
    const prefetch = async () => {
      for (let p = currentPage + 1; p <= Math.min(currentPage + 2, totalPages); p++) {
        extractPageHtml(p).catch(() => {});
      }
    };

    await renderPage(currentPage);
    prefetch();

  } catch(err) {
    console.error('PDF load error:', err);
    const container = document.getElementById('epubContainer');
    if (container) container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;
        flex-direction:column;gap:12px;padding:40px;height:100%;
        color:${darkMode?'#e8a090':'#c0392b'};
        font-family:'Space Grotesk',sans-serif;font-size:0.9rem;">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem;"></i>
        Could not open this PDF.
        <span style="font-size:0.75rem;color:${darkMode?'#b08060':'#7a5c3e'};text-align:center;">
          ${err.message || 'File may be corrupted or unsupported.'}
        </span>
      </div>`;
  }
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

  const pdfCanvas = document.getElementById('pdfCanvasContainer');
  if (pdfCanvas) { pdfCanvas.innerHTML = ''; pdfCanvas.style.display = 'none'; }
  const pdfCtrls = document.getElementById('pdfPageControls');
  if (pdfCtrls) pdfCtrls.style.display = 'none';
  // Run PDF cleanup callbacks (keyboard/resize listeners)
  const activeBook = books.find(b => b.id === currentBookId);
  if (activeBook && activeBook._pdfCleanup) {
    activeBook._pdfCleanup();
    delete activeBook._pdfCleanup;
  }
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
      <div style="width:100%;max-width:220px;position:relative;">
        <input id="epubSeekBar" type="range" min="0" max="100" value="0" step="0.1" style="
          width:100%;height:18px;cursor:pointer;accent-color:#9723C9;
          -webkit-appearance:none;appearance:none;background:transparent;
          padding:0;margin:0;
        "/>
        <style>
          #epubSeekBar::-webkit-slider-runnable-track {
            height:6px;border-radius:3px;
            background:linear-gradient(to right,#9723C9 var(--seek-pct,0%),#c4a882 var(--seek-pct,0%));
            border:1.5px solid #a07850;
          }
          #epubSeekBar::-moz-range-track {
            height:6px;border-radius:3px;background:#c4a882;border:1.5px solid #a07850;
          }
          #epubSeekBar::-moz-range-progress { background:#9723C9;height:6px;border-radius:3px; }
          #epubSeekBar::-webkit-slider-thumb {
            -webkit-appearance:none;appearance:none;
            width:16px;height:16px;border-radius:50%;
            background:#9723C9;border:2px solid #fff;
            box-shadow:0 0 0 2px #9723C9;margin-top:-6px;cursor:grab;
          }
          #epubSeekBar:active::-webkit-slider-thumb { cursor:grabbing; }
          #epubSeekBar::-moz-range-thumb {
            width:16px;height:16px;border-radius:50%;
            background:#9723C9;border:2px solid #fff;
            box-shadow:0 0 0 2px #9723C9;cursor:grab;
          }
        </style>
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
          transition:transform 0.1s,box-shadow 0.1s;display:flex;align-items:center;justify-content:center;line-height:1;">Reset</button>
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

      epubBook = ePub(buffer, { openAs: 'binary' });

      // Wait for DOM to fully paint before measuring
      requestAnimationFrame(() => {
        setTimeout(() => {

          const header   = document.querySelector('#pdfReader .reader-header');
          const controls = document.getElementById('epubControls');
          const headerH  = header   ? header.offsetHeight   : 58;
          const ctrlH    = controls ? controls.offsetHeight : 60;

          // Measure directly from window — never read from viewer div
          const fullW    = window.innerWidth;
          const fullH    = window.innerHeight - headerH - ctrlH;

          // 680px confirmed safe width that stops column splitting on iPad
          const epubW      = Math.min(fullW, 680);
          const epubH      = Math.max(fullH, 300);
          const leftOffset = Math.floor((fullW - epubW) / 2);

          // Create viewer at EXACT pixel size BEFORE renderTo is called
          epubContainer.innerHTML = '';
          const viewerDiv         = document.createElement('div');
          viewerDiv.id            = 'epubViewer';
          viewerDiv.style.cssText =
            `width:${epubW}px;height:${epubH}px;` +
            `position:absolute;top:0;left:${leftOffset}px;overflow:hidden;`;
          epubContainer.appendChild(viewerDiv);

          const getSize = () => {
            const hEl    = document.querySelector('#pdfReader .reader-header');
            const cEl    = document.getElementById('epubControls');
            const hH     = hEl ? hEl.offsetHeight : 58;
            const cH     = cEl ? cEl.offsetHeight : 60;
            const fw     = window.innerWidth;
            const fh     = window.innerHeight - hH - cH;
            const w      = Math.min(fw, 680);
            const h      = Math.max(fh, 300);
            const left   = Math.floor((fw - w) / 2);
            return { w, h, left };
          };

          epubRendition = epubBook.renderTo('epubViewer', {
            width:  epubW,
            height: epubH,
            spread: 'none',
            flow:   'paginated',
            allowScriptedContent: false
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

      // ── Seek bar (draggable progress) ──────────────────────
      const seekBar = document.getElementById('epubSeekBar');
      let isSeeking = false;
      seekBar.addEventListener('mousedown',  () => { isSeeking = true; });
      seekBar.addEventListener('touchstart', () => { isSeeking = true; }, { passive: true });
      seekBar.addEventListener('input', () => {
        const pct = parseFloat(seekBar.value);
        seekBar.style.setProperty('--seek-pct', `${pct}%`);
        const label = document.getElementById('epubPercent');
        if (label) label.textContent = `${Math.round(pct)}%`;
      });
      const doSeek = () => {
        if (!isSeeking) return;
        isSeeking = false;
        if (!epubBook || !epubBook.locations || !epubBook.locations.length()) return;
        const pct = parseFloat(seekBar.value) / 100;
        const cfi = epubBook.locations.cfiFromPercentage(pct);
        if (cfi) epubRendition.display(cfi);
      };
      seekBar.addEventListener('mouseup',  doSeek);
      seekBar.addEventListener('touchend', doSeek, { passive: true });
      seekBar.addEventListener('change',   doSeek);

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
      let resizeTimer = null;
      window._epubResizeObserver = new ResizeObserver(() => {
        if (!epubRendition) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const { w: nW, h: nH, left: nLeft } = getSize();
          const el = document.getElementById('epubViewer');
          if (el) {
            el.style.width  = `${nW}px`;
            el.style.height = `${nH}px`;
            el.style.left   = `${nLeft}px`;
          }
          epubRendition.resize(nW, nH);
        }, 150);
      });
      window._epubResizeObserver.observe(
        document.getElementById('pdfReader')
      );

        }, 150); // end setTimeout
      });       // end requestAnimationFrame
    })
    .catch(err => {
      console.error('ePub load error:', err);
      showToast('⚠️ Could not open this ePub. File may be corrupted.');
      const progress = document.getElementById('epubProgress');
      if (progress) progress.textContent = 'Failed to load';
    });
}

function updateProgressBar(percent) {
  const seek    = document.getElementById('epubSeekBar');
  const label   = document.getElementById('epubPercent');
  const rounded = Math.round(percent * 10) / 10;
  if (seek) {
    seek.value = rounded;
    seek.style.setProperty('--seek-pct', `${rounded}%`);
  }
  if (label) label.textContent = `${Math.round(rounded)}%`;
}

// ========================
// PDF THEME
// ========================
function applyPdfTheme() {
  // PDF now renders as flowing text in epubViewer — just call applyEpubTheme
  // which handles epubContainer, epubControls, header, and viewer typography.
  // Additionally update the PDF-specific controls (pdfPageLabel etc.)
  applyEpubTheme();

  // Update pdf-specific label colours that applyEpubTheme doesn't know about
  const dm = darkMode;
  const pageLabel = document.getElementById('pdfPageLabel');
  const pctLabel  = document.getElementById('pdfPercent');
  const zoomLabel = document.getElementById('pdfZoomLabel');
  if (pageLabel) pageLabel.style.color = dm ? '#b08060' : '#7a5c3e';
  if (pctLabel)  pctLabel.style.color  = dm ? '#d4a87a' : '#9723C9';
  if (zoomLabel) zoomLabel.style.color = dm ? '#b08060' : '#7a5c3e';

  // Re-apply typography to the viewer so text colour updates instantly
  const viewer = document.getElementById('epubViewer');
  if (viewer && viewer.querySelector('#pdf-typo')) {
    // This is a PDF text viewer — update its inline style + injected CSS
    viewer.style.background = dm ? '#1c1008' : '#fdf6ec';
    viewer.style.color      = dm ? '#e8d5b8' : '#2c1a0e';
    const styleEl = viewer.querySelector('#pdf-typo');
    if (styleEl) styleEl.textContent = `
      #epubViewer p {
        margin-bottom: 1.2em; text-indent: 1.5em; text-align: justify;
        color: ${dm ? '#e8d5b8' : '#2c1a0e'}; font-size: 1em; line-height: 1.85;
      }
      #epubViewer h1, #epubViewer h2, #epubViewer h3 {
        font-family: 'Playfair Display', Georgia, serif;
        color: ${dm ? '#d4a87a' : '#4a2c0e'}; text-indent: 0;
        margin: 1.2em 0 0.6em; line-height: 1.3;
      }
      #epubViewer h2 { font-size: 1.3em; }
      #epubViewer h3 { font-size: 1.1em; }
      #epubViewer a  { color: ${dm ? '#C4A1FF' : '#9723C9'}; }
    `;
  }
  return; // skip old canvas-based code below
  // (dead code kept for reference — will never be reached)

  function C(dark, light) { return darkMode ? dark : light; }

  const container = document.getElementById('pdfCanvasContainer');
  const controls  = document.getElementById('pdfPageControls');
  const header    = document.querySelector('#pdfReader .reader-header');

  if (container) {
    container.style.background = C('#1c1008','#f4ede4');
  }
  if (controls) {
    controls.style.background  = C('#140e08','#ede4d8');
    controls.style.borderColor = C('#4a3728','#c4a882');
    controls.querySelectorAll('button').forEach(btn => {
      const isReset = btn.id === 'pdfZoomReset';
      btn.style.background  = isReset ? C('#2a1a0a','#c4a882') : C('#3d2a1a','#d4b896');
      btn.style.borderColor = C('#6b4a2e','#a07850');
      btn.style.color       = C('#f0e0c8','#2c1a0e');
      btn.style.boxShadow   = C('2px 2px 0 #6b4a2e','2px 2px 0 #a07850');
    });
    const pageLabel = document.getElementById('pdfPageLabel');
    const zoomLabel = document.getElementById('pdfZoomLabel');
    const pctLabel  = document.getElementById('pdfPercent');
    if (pageLabel) pageLabel.style.color = C('#b08060','#7a5c3e');
    if (zoomLabel) zoomLabel.style.color = C('#b08060','#7a5c3e');
    if (pctLabel)  pctLabel.style.color  = C('#d4a87a','#9723C9');
  }
  if (header) {
    header.style.background  = C('#1c1008','');
    header.style.borderColor = C('#4a3728','');
    header.querySelectorAll('button').forEach(b => {
      b.style.background  = C('#3d2a1a','');
      b.style.borderColor = C('#6b4a2e','');
      b.style.color       = C('#f0e0c8','');
    });
    const titleSpan = header.querySelector('span');
    if (titleSpan) titleSpan.style.color = C('#e8d5b8','');
  }
  // Re-tint canvas on theme toggle without re-rendering
  const canvas = document.querySelector('#pdfCanvasContainer canvas');
  if (canvas) {
    canvas.style.filter    = C('invert(1) hue-rotate(180deg) sepia(0.3) brightness(0.85) contrast(0.9)','none');
    canvas.style.background = C('#e8d5b8','#ffffff');
    canvas.style.boxShadow  = C('0 8px 40px rgba(0,0,0,0.6)','0 4px 20px rgba(0,0,0,0.12)');
  }
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
      const viewer  = document.getElementById('epubViewer');
      const reader  = document.getElementById('pdfReader');
      const w = viewer ? viewer.clientWidth  || reader.clientWidth  || window.innerWidth  : window.innerWidth;
      const h = viewer ? viewer.clientHeight || reader.clientHeight || window.innerHeight : window.innerHeight;
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