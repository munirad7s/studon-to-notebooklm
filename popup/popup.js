document.addEventListener('DOMContentLoaded', async () => {
  const courseNameEl = document.getElementById('course-name');
  const courseUrlEl = document.getElementById('course-url');
  const btnExportZip = document.getElementById('btn-export-zip');
  const btnOpenNlm = document.getElementById('btn-open-nlm');
  const progressArea = document.getElementById('progress-area');
  const progressBar = document.getElementById('progress-bar');
  const progressMsg = document.getElementById('progress-msg');
  const progressNum = document.getElementById('progress-num');
  const consoleBox = document.getElementById('console-box');

  function log(msg) {
    const line = document.createElement('div');
    line.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    consoleBox.appendChild(line);
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url.includes('studon.fau.de')) {
    courseNameEl.innerText = 'Not on StudOn';
    courseUrlEl.innerText = 'Navigate to a StudOn course page';
    btnExportZip.disabled = true;
    return;
  }

  courseNameEl.innerText = tab.title.replace(': StudOn', '').trim() || 'StudOn Course';
  courseUrlEl.innerText = tab.url;

  btnOpenNlm.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://notebooklm.google.com' });
  });

  btnExportZip.addEventListener('click', async () => {
    btnExportZip.disabled = true;
    progressArea.style.display = 'flex';
    consoleBox.innerHTML = '';

    const CrawlerClass = window.StudOnCrawler || globalThis.StudOnCrawler;
    if (!CrawlerClass) {
      log('❌ Crawler engine not loaded.');
      btnExportZip.disabled = false;
      return;
    }

    const crawler = new CrawlerClass({
      includeLectures: document.getElementById('opt-lectures').checked,
      includeExercises: document.getElementById('opt-exercises').checked,
      includeGuestTalks: document.getElementById('opt-sessions').checked,
      includeNotes: document.getElementById('opt-notes').checked,
      onProgress: ({ message, current, total, phase }) => {
        progressMsg.innerText = message;
        if (total > 0) {
          const pct = Math.min(100, Math.round((current / total) * 100));
          progressNum.innerText = `${pct}%`;
          progressBar.style.width = `${pct}%`;
        }
        log(message);
      }
    });

    try {
      log(`Connecting to: ${tab.url}`);
      const manifest = await crawler.crawlCourse(tab.url);

      const zip = new JSZip();
      const totalItems = manifest.files.length + manifest.texts.length;
      let count = 0;

      // Add Markdown Notes
      if (document.getElementById('opt-notes').checked) {
        log(`Adding ${manifest.texts.length} Markdown summaries...`);
        for (const t of manifest.texts) {
          zip.file(t.path, t.content);
          count++;
          const pct = Math.round((count / totalItems) * 100);
          progressBar.style.width = `${pct}%`;
          progressNum.innerText = `${pct}%`;
        }
      }

      // Download Files
      log(`Downloading ${manifest.files.length} documents...`);
      for (const f of manifest.files) {
        progressMsg.innerText = `Downloading: ${f.path.split('/').pop()}`;
        try {
          const res = await fetch(f.url, { credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            zip.file(f.path, blob);
            log(`✓ ${f.path.split('/').pop()} (${Math.round(blob.size / 1024)} KB)`);
          } else {
            log(`✗ Error ${f.path}: HTTP ${res.status}`);
          }
        } catch (fe) {
          log(`✗ Failed ${f.path}: ${fe.message}`);
        }
        count++;
        const pct = Math.round((count / totalItems) * 100);
        progressBar.style.width = `${pct}%`;
        progressNum.innerText = `${pct}%`;
      }

      // Generate Zip
      progressMsg.innerText = 'Creating ZIP archive...';
      log('Compressing files into structured ZIP package...');

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
        progressNum.innerText = `${Math.round(meta.percent)}%`;
      });

      const safeTitle = manifest.courseTitle.replace(/[/\\?%*:|"<>]/g, '_');
      const filename = `${safeTitle}_NotebookLM.zip`;
      const zipUrl = URL.createObjectURL(zipBlob);

      if (chrome.downloads) {
        chrome.downloads.download({
          url: zipUrl,
          filename: filename,
          saveAs: true
        });
      } else {
        const a = document.createElement('a');
        a.href = zipUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      progressMsg.innerText = 'Export Complete!';
      log(`🎉 Archive ready: ${filename} (${(zipBlob.size / (1024 * 1024)).toFixed(2)} MB)`);
      log('👉 Extract & upload to NotebookLM notebook!');
    } catch (e) {
      log(`❌ Error: ${e.message}`);
      progressMsg.innerText = 'Export Failed';
    } finally {
      btnExportZip.disabled = false;
    }
  });
});
