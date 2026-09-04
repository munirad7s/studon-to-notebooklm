/**
 * StudOn In-Page Floating Exporter for NotebookLM
 */

(function () {
  const isCoursePage = document.querySelector('.il-header-locator') || 
                       document.querySelector('h1.ilHeader') ||
                       window.location.href.includes('crs_') ||
                       window.location.href.includes('ref_id=');

  if (!isCoursePage) return;

  const titleEl = document.querySelector('h1.ilHeader, .il-header-locator button, .ilHeader');
  const rawTitle = titleEl ? titleEl.innerText.trim() : 'StudOn Course';
  const cleanTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').trim();

  // 1. Floating Banner Button
  let existingBanner = document.getElementById('studon-nlm-banner');
  if (existingBanner) existingBanner.remove();

  const banner = document.createElement('div');
  banner.id = 'studon-nlm-banner';
  banner.innerHTML = `
    <div class="nlm-icon">⚡</div>
    <span class="nlm-label">Export to NotebookLM</span>
    <span class="nlm-badge">Ready</span>
  `;
  document.body.appendChild(banner);

  // 2. Modal
  let existingModal = document.getElementById('studon-nlm-modal-backdrop');
  if (existingModal) existingModal.remove();

  const modalBackdrop = document.createElement('div');
  modalBackdrop.id = 'studon-nlm-modal-backdrop';
  modalBackdrop.innerHTML = `
    <div id="studon-nlm-modal">
      <div class="nlm-modal-header">
        <div class="nlm-modal-title">
          <span style="color:#5e6ad2">⚡</span> StudOn ➔ NotebookLM Exporter
        </div>
        <button class="nlm-modal-close" id="nlm-close">&times;</button>
      </div>
      <div class="nlm-modal-body">
        <div class="nlm-course-pill">
          <div class="nlm-course-name" id="nlm-modal-cname">${rawTitle}</div>
          <div class="nlm-course-desc" style="margin-bottom: 8px;">🎯 <b>Goal:</b> 1-Click bridge between FAU StudOn and Google NotebookLM. Automatically traverses nested course hierarchies, extracts lecture slides, handouts, exercises, and AI markdown summaries into a clean package ready for instant NotebookLM studying.</div>
        </div>

        <div class="nlm-status-text">
          <span id="nlm-status-msg">Ready to export</span>
          <span id="nlm-status-count">0 / 0</span>
        </div>

        <div class="nlm-progress-bar-wrap">
          <div class="nlm-progress-bar" id="nlm-prog"></div>
        </div>

        <div id="nlm-log-box" style="font-family: monospace; font-size: 11px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 10px; height: 110px; overflow-y: auto; color: #8a8f98;">
          <div>Ready. Click "Export & Open NotebookLM" to begin.</div>
        </div>
      </div>
      <div class="nlm-modal-footer">
        <button class="nlm-btn nlm-btn-primary" id="nlm-btn-zip">
          <span>📦</span> Export & Open NotebookLM
        </button>
        <button class="nlm-btn nlm-btn-secondary" id="nlm-btn-nlm">
          <span>🪐</span> Open NotebookLM
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modalBackdrop);

  banner.addEventListener('click', () => {
    modalBackdrop.classList.add('active');
  });

  document.getElementById('nlm-close').addEventListener('click', () => {
    modalBackdrop.classList.remove('active');
  });

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      modalBackdrop.classList.remove('active');
    }
  });

  document.getElementById('nlm-btn-nlm').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) { chrome.runtime.sendMessage({ action: 'openNotebookLM' }); } else { window.open('https://notebooklm.google.com', '_blank'); }
  });

  // Self-contained Embedded Crawler (Zero Dependencies)
  class EmbeddedCrawler {
    constructor(options = {}) {
      this.options = Object.assign({ onProgress: () => {} }, options);
      this.seenUrls = new Set();
    }

    log(message, current = 0, total = 0, phase = 'crawling') {
      this.options.onProgress({ message, current, total, phase });
    }

    cleanFilename(text, defaultExt = '.pdf') {
      let name = text.replace(/\s*\([\d\.]+\s*[KMGT]?B\)/gi, '').trim();
      name = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
      if (!name) name = 'file';
      if (!name.includes('.')) name += defaultExt;
      return name;
    }

    cleanFolderName(text) {
      return text.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Folder';
    }

    async fetchDoc(url) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      const html = await res.text();
      return new DOMParser().parseFromString(html, 'text/html');
    }

    async crawlCourse(courseUrl) {
      this.log('Connecting to StudOn course page...', 0, 1, 'crawling');
      const doc = await this.fetchDoc(courseUrl);

      const titleEl = doc.querySelector('h1.ilHeader, .il-header-locator button, .ilHeader');
      const courseTitle = this.cleanFolderName(titleEl ? titleEl.innerText.trim() : 'Course Material');

      const manifest = {
        courseTitle,
        files: [],
        texts: []
      };

      // 1. Course Overview
      const mainContent = doc.querySelector('#mainspacekeeper, .ilContentFixed, #mainscrolldiv');
      if (mainContent) {
        manifest.texts.push({
          path: 'Course_Overview.md',
          content: `# ${courseTitle} - Course Overview\n\n${mainContent.innerText.trim()}`
        });
      }

      // 2. Discover Items
      const containerItems = Array.from(doc.querySelectorAll('.il_ContainerListItem, .ilContainerListItem, [class*="ilContainerItem"]'));
      this.log(`Discovered ${containerItems.length} course sections`, 0, containerItems.length, 'crawling');

      const foldersToCrawl = [];
      const modulesToCrawl = [];

      for (const item of containerItems) {
        const titleLink = item.querySelector('.il_ContainerItemTitle, .ilContainerItemTitle, h4 a, h3 a, a');
        if (!titleLink || !titleLink.href) continue;

        const title = titleLink.innerText.trim();
        const href = titleLink.href;

        if (this.seenUrls.has(href)) continue;
        this.seenUrls.add(href);

        if (href.includes('sendfile') || (href.includes('ilObjFileGUI') && href.includes('ref_id='))) {
          manifest.files.push({ path: this.cleanFilename(title), url: href });
        } else if (href.includes('/lm/') || href.includes('illmpresentationgui')) {
          modulesToCrawl.push({ title, href });
        } else if (href.includes('/fold/') || href.includes('ilobjfoldergui')) {
          foldersToCrawl.push({ title, href });
        } else if (href.includes('/copa/')) {
          await this.crawlContentPage(href, title, manifest);
        } else if (href.includes('/glo/')) {
          await this.crawlGlossary(href, title, manifest);
        }
      }

      // 3. Subfolders
      for (let i = 0; i < foldersToCrawl.length; i++) {
        const folder = foldersToCrawl[i];
        this.log(`Scanning folder: ${folder.title}`, i + 1, foldersToCrawl.length, 'crawling');
        await this.crawlFolder(folder.href, folder.title, manifest);
      }

      // 4. Learning Modules
      for (let i = 0; i < modulesToCrawl.length; i++) {
        const mod = modulesToCrawl[i];
        this.log(`Crawling Learning Module: ${mod.title}`, i + 1, modulesToCrawl.length, 'crawling');
        await this.crawlLearningModule(mod.href, mod.title, manifest, i + 1);
      }

      this.log(`Crawl complete: ${manifest.files.length} files, ${manifest.texts.length} notes`, manifest.files.length, manifest.files.length, 'ready');
      return manifest;
    }

    async crawlFolder(folderUrl, folderPath, manifest) {
      try {
        const doc = await this.fetchDoc(folderUrl);
        const items = Array.from(doc.querySelectorAll('.il_ContainerListItem, .ilContainerListItem, [class*="ilContainerItem"]'));

        for (const item of items) {
          const titleLink = item.querySelector('.il_ContainerItemTitle, .ilContainerItemTitle, h4 a, h3 a, a');
          if (!titleLink || !titleLink.href) continue;

          const title = titleLink.innerText.trim();
          const href = titleLink.href;

          if (this.seenUrls.has(href)) continue;
          this.seenUrls.add(href);

          if (href.includes('sendfile') || (href.includes('ilObjFileGUI') && href.includes('ref_id='))) {
            manifest.files.push({ path: `${folderPath}/${this.cleanFilename(title)}`, url: href });
          } else if (href.includes('/fold/') || href.includes('ilobjfoldergui')) {
            await this.crawlFolder(href, `${folderPath}/${this.cleanFolderName(title)}`, manifest);
          }
        }
      } catch (e) {
        console.warn(`Error crawling folder ${folderPath}:`, e);
      }
    }

    async crawlLearningModule(moduleUrl, moduleTitle, manifest, index) {
      try {
        const doc = await this.fetchDoc(moduleUrl);
        const modFolder = `Lectures/${String(index).padStart(2, '0')} - ${this.cleanFolderName(moduleTitle)}`;

        const tocLinks = Array.from(doc.querySelectorAll('a'))
          .filter(a => a.href.includes('illmpresentationgui') && a.href.includes('obj_id=') && !a.href.includes('obj_id=0') && !a.href.includes('obj_id=1'))
          .map(a => ({ text: a.innerText.trim(), href: a.href }));

        const uniqueToc = [];
        const seen = new Set();
        for (const t of tocLinks) {
          if (!seen.has(t.href)) {
            seen.add(t.href);
            uniqueToc.push(t);
          }
        }

        const notesSections = [`# ${moduleTitle}\n`];
        const seenFileUrls = new Set();

        for (const page of uniqueToc) {
          try {
            const pDoc = await this.fetchDoc(page.href);
            const container = pDoc.querySelector('.ilc_page_cont_PageContainer') || pDoc.querySelector('#mainspacekeeper');
            const pageText = container ? container.innerText.trim() : '';

            notesSections.push(`## ${page.text}\n\n${pageText}\n`);

            pDoc.querySelectorAll('a').forEach(a => {
              if (a.href.includes('downloadFile') || a.href.includes('sendfile')) {
                if (!seenFileUrls.has(a.href)) {
                  seenFileUrls.add(a.href);
                  let cleanName = this.cleanFilename(a.innerText);
                  manifest.files.push({ path: `${modFolder}/${cleanName}`, url: a.href });
                }
              }
            });
          } catch (pe) {
            console.warn(`Error on module page ${page.text}:`, pe);
          }
        }

        const fileListPage = uniqueToc.find(p => p.text.toLowerCase().includes('file list') || p.text.toLowerCase().includes('dateiliste'));
        if (fileListPage) {
          try {
            const flDoc = await this.fetchDoc(fileListPage.href);
            flDoc.querySelectorAll('a').forEach(a => {
              if (a.href.includes('downloadFile') || a.href.includes('sendfile')) {
                if (!seenFileUrls.has(a.href)) {
                  seenFileUrls.add(a.href);
                  let cleanName = this.cleanFilename(a.innerText);
                  manifest.files.push({ path: `${modFolder}/${cleanName}`, url: a.href });
                }
              }
            });
          } catch (fle) {}
        }

        manifest.texts.push({
          path: `${modFolder}/Notes.md`,
          content: notesSections.join('\n---\n\n')
        });
      } catch (e) {
        console.warn(`Error crawling learning module ${moduleTitle}:`, e);
      }
    }

    async crawlContentPage(url, title, manifest) {
      try {
        const doc = await this.fetchDoc(url);
        const content = doc.querySelector('.ilc_page_cont_PageContainer, #mainscrolldiv')?.innerText || '';
        manifest.texts.push({
          path: `${this.cleanFilename(title, '.md')}`,
          content: `# ${title}\n\n${content.trim()}`
        });
      } catch (e) {}
    }

    async crawlGlossary(url, title, manifest) {
      try {
        const doc = await this.fetchDoc(url);
        const rows = Array.from(doc.querySelectorAll('tr, .ilTable, .il_ContainerListItem'))
          .map(el => el.innerText.trim())
          .filter(Boolean);
        manifest.texts.push({
          path: `${this.cleanFilename(title, '.md')}`,
          content: `# ${title}\n\n${rows.join('\n\n---\n\n') || doc.body.innerText.trim()}`
        });
      } catch (e) {}
    }
  }

  // Export & Packaging Handler
  document.getElementById('nlm-btn-zip').addEventListener('click', async () => {
    const btn = document.getElementById('nlm-btn-zip');
    btn.disabled = true;

    const logBox = document.getElementById('nlm-log-box');
    const statusMsg = document.getElementById('nlm-status-msg');
    const statusCount = document.getElementById('nlm-status-count');
    const progBar = document.getElementById('nlm-prog');

    function addLog(msg) {
      const line = document.createElement('div');
      line.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    }

    try {
      addLog('Initializing crawler & ZIP engine...');
      
      const CrawlerClass = window.StudOnCrawler || globalThis.StudOnCrawler || EmbeddedCrawler;
      const ZipClass = window.JSZip || globalThis.JSZip;

      if (!ZipClass) {
        throw new Error('JSZip library not initialized. Please reload the page.');
      }

      const crawler = new CrawlerClass({
        onProgress: ({ message, current, total, phase }) => {
          statusMsg.innerText = message;
          if (total > 0) {
            statusCount.innerText = `${current} / ${total}`;
            progBar.style.width = `${Math.min(100, Math.round((current / total) * 100))}%`;
          }
          addLog(message);
        }
      });

      // 1. Crawl Course
      addLog('Crawling course hierarchy...');
      const manifest = await crawler.crawlCourse(window.location.href);

      // 2. Add text notes to ZIP
      const zip = new ZipClass();
      const totalItems = manifest.files.length + manifest.texts.length;
      let processed = 0;

      statusMsg.innerText = 'Packaging notes...';
      for (const t of manifest.texts) {
        zip.file(t.path, t.content);
        processed++;
        statusCount.innerText = `${processed} / ${totalItems}`;
        progBar.style.width = `${Math.round((processed / totalItems) * 100)}%`;
      }

      // 3. Download binary files
      statusMsg.innerText = 'Downloading documents...';
      addLog(`Downloading ${manifest.files.length} documents with active session...`);

      for (let i = 0; i < manifest.files.length; i++) {
        const f = manifest.files[i];
        statusMsg.innerText = `Downloading: ${f.path.split('/').pop()}`;
        statusCount.innerText = `${processed + 1} / ${totalItems}`;
        progBar.style.width = `${Math.round(((processed + 1) / totalItems) * 100)}%`;

        try {
          const res = await fetch(f.url, { credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            zip.file(f.path, blob);
            addLog(`✓ ${f.path.split('/').pop()} (${Math.round(blob.size / 1024)} KB)`);
          } else {
            addLog(`✗ Failed ${f.path}: HTTP ${res.status}`);
          }
        } catch (fe) {
          addLog(`✗ Error downloading ${f.path}: ${fe.message}`);
        }
        processed++;
      }

      // 4. Generate and download ZIP
      statusMsg.innerText = 'Generating ZIP archive...';
      addLog('Compressing ZIP archive in memory...');
      progBar.style.width = '100%';

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        statusCount.innerText = `${Math.round(meta.percent)}%`;
      });

      const safeTitle = manifest.courseTitle.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `${safeTitle}_NotebookLM.zip`;
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'downloadZip', url: dataUrl, filename: filename });
        } else {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      };
      reader.readAsDataURL(zipBlob);

      statusMsg.innerText = 'Export Complete!';
      addLog(`🎉 Download finished: ${filename} (${(zipBlob.size / (1024 * 1024)).toFixed(2)} MB)`);
      addLog('🪐 Opening NotebookLM in new tab...');

      // 5. Open NotebookLM
      setTimeout(() => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) { chrome.runtime.sendMessage({ action: 'openNotebookLM' }); } else { window.open('https://notebooklm.google.com', '_blank'); }
      }, 1500);

      addLog('👉 Extract the ZIP and drag the files into your NotebookLM notebook!');
    } catch (err) {
      console.error(err);
      statusMsg.innerText = 'Export Failed';
      addLog(`❌ Fatal error: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
})();
