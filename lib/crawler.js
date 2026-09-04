/**
 * StudOn Course Crawler
 * Deeply scrapes course materials, learning modules, handouts, and notes.
 */

class StudOnCrawler {
  constructor(options = {}) {
    this.options = Object.assign({
      includeLectures: true,
      includeExercises: true,
      includeGuestTalks: true,
      includeNotes: true,
      onProgress: () => {}
    }, options);
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

    // Get Course Title
    const titleEl = doc.querySelector('h1.ilHeader, .il-header-locator button, .ilHeader');
    const courseTitle = this.cleanFolderName(titleEl ? titleEl.innerText.trim() : 'Course Material');

    const manifest = {
      courseTitle,
      files: [], // { path, url }
      texts: []  // { path, content }
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

      // Direct file
      if (href.includes('sendfile') || (href.includes('ilObjFileGUI') && href.includes('ref_id='))) {
        manifest.files.push({
          path: this.cleanFilename(title),
          url: href
        });
      }
      // Learning module
      else if (href.includes('/lm/') || href.includes('illmpresentationgui')) {
        modulesToCrawl.push({ title, href });
      }
      // Subfolder
      else if (href.includes('/fold/') || href.includes('ilobjfoldergui')) {
        foldersToCrawl.push({ title, href });
      }
      // FAQ / Content Page
      else if (href.includes('/copa/')) {
        await this.crawlContentPage(href, title, manifest);
      }
      // Glossary
      else if (href.includes('/glo/')) {
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
          manifest.files.push({
            path: `${folderPath}/${this.cleanFilename(title)}`,
            url: href
          });
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
                manifest.files.push({
                  path: `${modFolder}/${cleanName}`,
                  url: a.href
                });
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
                manifest.files.push({
                  path: `${modFolder}/${cleanName}`,
                  url: a.href
                });
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

// Attach to window & globalThis for extension content scripts and popup
if (typeof window !== 'undefined') {
  window.StudOnCrawler = StudOnCrawler;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StudOnCrawler = StudOnCrawler;
}
