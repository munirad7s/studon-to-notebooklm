# StudOn to NotebookLM (Chrome Extension)

A high-performance, Linear-styled browser extension for **FAU StudOn** that exports entire course materials (slides, handouts, exercises, learning modules, and generated markdown summaries) into **Google NotebookLM** or a structured ZIP archive with 1 click.

---

## ✨ Features

- **100% Client-Side**: No local Python, terminal, or backend servers needed. Runs entirely inside Chrome with your existing StudOn session.
- **Deep Crawler**:
  - Recursively resolves all folders and subfolders.
  - Automatically parses ILIAS **Learning Modules (`lm`)**, extracting attached slides, handouts, and chapter text.
  - Auto-generates clean Markdown notes (`Notes.md`, `Course_Overview.md`, `FAQ.md`, `Glossary.md`).
  - Discovers discussion session PDFs, exercises, and guest lecture materials.
- **Linear Design System**: Clean dark-mode UI with live progress indicators and detailed logs.
- **Two Export Modes**:
  1. **Structured ZIP Archive**: Packages all folders and files directly in memory using `JSZip` and downloads as a ready-to-upload archive.
  2. **NotebookLM Ready**: Open NotebookLM directly to import your files or connect to Google Drive.

---

## 🚀 How to Install in Chrome

1. Open **Google Chrome**.
2. Navigate to `chrome://extensions/` in your address bar.
3. Toggle on **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** in the top-left corner.
5. Select the extension directory:
   ```
   /Users/munir/studon-to-notebooklm
   ```
6. The **StudOn to NotebookLM** icon will appear in your Chrome toolbar.

---

## 📖 How to Use

1. Open any course page on [FAU StudOn](https://www.studon.fau.de).
2. Look for the floating **"⚡ Export to NotebookLM"** badge in the bottom-right corner, or click the extension icon in the toolbar.
3. Configure which materials to include (Lectures, Exercises, Notes).
4. Click **"Export Structured ZIP"**.
5. Upload or drag & drop the files into your [Google NotebookLM](https://notebooklm.google.com) notebook!
