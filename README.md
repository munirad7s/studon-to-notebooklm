# StudOn → NotebookLM (Chrome-Extension)

> **English:** Chrome extension that exports a complete [FAU StudOn](https://www.studon.fau.de) (ILIAS 9)
> course – files, learning modules, exercises, lecture recordings as audio tracks, fau.tv transcripts – straight
> into a [Google NotebookLM](https://notebooklm.google.com) notebook. Runs entirely in the browser with your
> existing sessions; no server, no API keys. Documentation is in German because the audience is FAU students.
> Unofficial project, not affiliated with FAU or Google. **Status: Beta.**


Exportiert einen kompletten **FAU-StudOn-Kurs** mit einem Klick nach **Google NotebookLM** – rekursiv über alle Ordner,
Sitzungen, Übungen, Lernmodule, Inhaltsseiten, Wikis, Glossare und Weblinks. Optional wird alles zusätzlich nach
**Google Drive** gespiegelt (und dort als syncbare NotebookLM-Quellen verknüpft) oder als **ZIP** gespeichert.

Es läuft komplett im Browser mit deiner bestehenden StudOn- und Google-Session. Kein Python, kein Server, keine API-Keys.

## Was passiert beim Export

1. **Scan** – Die Extension liest die Kursseite und folgt jedem Objekt:
   - Ordner / Gruppen / Sitzungen → rekursiv
   - Dateien → Download-Link (`goto.php?target=file_<ref>_download`)
   - Lernmodule → alle Seiten als ein Markdown-Text + angehängte Dateien + eingebettete YouTube-Videos
   - Übungen → Aufgabentext + Aufgabendateien
   - Inhaltsseiten, Wikis, Glossare, Foren (optional), Mediacasts (optional)
   - Weblinks / YouTube → als URL-Quellen
   - Tests, Umfragen, Datensammlungen etc. werden gelistet, aber übersprungen
2. **Auswahl** – Baum mit Checkboxen: alles ist vorausgewählt, „Nur Neues“ wählt nur, was noch nicht im Notebook ist.
3. **Export** – Neues Notebook, vorhandenes Notebook oder das zuletzt für diesen Kurs verwendete:
   - Dateien werden mit deiner StudOn-Session geladen und per Resumable-Upload direkt in NotebookLM hochgeladen
   - Code/Text-Dateien (`.py`, `.java`, `.tex`, …) werden als `.txt` hochgeladen, ZIP-Archive entpackt
   - Texte (Lernmodule, Seiten, Wiki) werden als Textquellen angelegt, Links als URL-Quellen
   - eine Quelle „Kursstruktur“ beschreibt den kompletten Baum
   - ist ein Notebook voll (50 Quellen Free / 300 Pro), geht es automatisch in „Kurs (2)“ weiter
   - **FAU.tv-Videos** werden nicht heruntergeladen (HLS-Stream, für NotebookLM zu groß) – stattdessen holt die
     Extension das fertige **Whisper-Transkript** des Videoportals und legt es als Textquelle mit Zeitmarken an.
     Voraussetzung: im selben Chrome-Profil bei [www.fau.tv](https://www.fau.tv) angemeldet, falls der Clip das verlangt.
   - **Vorlesungsaufzeichnungen auf StudOn** (HTML-Lernmodul mit MP4, „Interaktives Video“, Mediacast) werden nicht
     als Video hochgeladen: NotebookLM nimmt 200 MB pro Datei und wertet ohnehin nur den Ton aus. Die Extension löst
     die Tonspur ohne Neukodierung heraus (`.m4a`, typisch 60–90 MB pro 90 Minuten) und lädt diese hoch – NotebookLM
     transkribiert sie selbst. Abschaltbar unter „Videos nur als Tonspur hochladen“.
4. **Sync** – Die Extension merkt sich pro Kurs, was schon in welchem Notebook liegt. Der nächste Lauf lädt nur Neues nach.

## Installation

**Schnellster Weg:** [studon-to-notebooklm.pages.dev](https://studon-to-notebooklm.pages.dev) – ZIP laden, entpacken,
in Chrome als entpackte Erweiterung laden. Alternativ das ZIP aus den
[GitHub-Releases](https://github.com/munirad7s/studon-to-notebooklm/releases/latest).

1. Repo klonen, ZIP aus dem Release laden oder von der Seite oben.
2. `chrome://extensions` → **Entwicklermodus** an → **Entpackte Erweiterung laden** → diesen Ordner wählen.
3. In diesem Chrome-Profil bei [notebooklm.google.com](https://notebooklm.google.com) **und** bei [StudOn](https://www.studon.fau.de) angemeldet sein.
4. Kurs öffnen → unten rechts **⚡ NotebookLM** → im Dialog Inhalt und Notebook wählen → **Exportieren**.
   Der Export-Tab öffnet sich, scannt und lädt ohne weiteren Klick hoch. „Mehr Einstellungen“ führt in die
   ausführliche Ansicht (Einzelauswahl im Kursbaum, Drive-Spiegel, ZIP).

Standard ist ein **neues Notebook** mit dem Kurstitel. Wurde der Kurs schon einmal exportiert, ist das damals
verwendete Notebook vorausgewählt – so landet nur Neues dort und nichts wird doppelt angelegt.

Die Extension-ID ist über den `key` im Manifest fest: `hceibhcelpeeniihfdlbfopkmnakhemd`.

## Google Drive (optional)

Drive braucht eine OAuth-Client-ID (kein Weg ohne). Einmalig:

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → „OAuth client ID“ → Typ **Web application**.
2. Authorized redirect URI: `https://hceibhcelpeeniihfdlbfopkmnakhemd.chromiumapp.org/`
3. **Google Drive API** aktivieren, im Consent-Screen (Testing) deinen Account als Test-User eintragen.
4. Client-ID in den Extension-Optionen eintragen → „Drive verbinden / testen“.

Dann im Exporter: „Nach Google Drive spiegeln“ (Kopie in `Meine Ablage/NotebookLM Import/<Kurs>/…`) und/oder
„Drive-Dateien als Quellen verknüpfen“ (pptx/docx/xlsx → Slides/Docs/Sheets, in NotebookLM syncbar).

## Grenzen (NotebookLM)

| Limit | Wert |
|---|---|
| Quellen pro Notebook | 50 (Free) · 300 (Pro/Ultra) – Overflow-Notebooks werden automatisch angelegt |
| Dateigröße | 200 MB |
| Wörter pro Quelle | ~500 k – längere Texte werden geteilt |
| Formate direkt | pdf, txt, md, docx, pptx, csv, epub, Bilder, Audio, Video |
| Formate nur via Drive | xlsx, ods, odt, odp |

## Entwicklung

```bash
npm install          # nur linkedom für DOM-Tests
npm test             # node --test (Crawler, NotebookLM-Client, Exporter, Helfer)
npm run package      # dist/studon-to-notebooklm-<version>.zip
```

- `lib/ilias.js` – StudOn-URLs, Objekttypen, Namen
- `lib/text.js` – HTML → Markdown
- `lib/crawler.js` – rekursiver Kurs-Scan (Baum)
- `lib/nlm-client.js` – NotebookLM-RPCs + Resumable-Upload
- `lib/drive-client.js` – Drive v3 (OAuth via `chrome.identity`)
- `lib/exporter.js` – Plan + Ausführung, inkrementeller Zustand, Overflow, ZIP
- `export/` – der Exporter-Tab (Engine + UI), `content/` – Badge auf StudOn, `popup/`, `options/`

Protokoll- und Struktur-Details: [`docs/FINDINGS.md`](docs/FINDINGS.md), Architektur: [`docs/architecture.md`](docs/architecture.md).

## Fehlerbilder

| Meldung | Ursache / Lösung |
|---|---|
| „Nicht bei NotebookLM angemeldet“ | In diesem Chrome-Profil notebooklm.google.com öffnen, anmelden, Exporter neu laden |
| „StudOn-Session abgelaufen“ | In StudOn neu einloggen, Scan wiederholen |
| „RPC … fehlt in der Antwort“ | Google hat eine RPC-ID rotiert – IDs in `lib/nlm-client.js` (`RPC`) anpassen, siehe `docs/FINDINGS.md` |
| Datei „liefert keine Datei“ | Kein Leserecht oder Objekt ist keine Datei – wird übersprungen und im Ergebnis gelistet |

## Datenschutz & Sicherheit

- Alles läuft lokal im Browser. Es gibt keinen Server dieses Projekts, keine Telemetrie, keine Analytics.
- Die Extension spricht nur mit **StudOn** (Kursinhalte lesen), **fau.tv** (Transkripte), **NotebookLM**
  (Quellen anlegen) und – nur wenn du es einrichtest – **Google Drive**. Die dafür nötigen Host-Rechte
  stehen im `manifest.json`; weitere Domains gibt es nicht.
- Es werden keine Zugangsdaten gespeichert oder abgefragt; genutzt werden die Sessions, mit denen du im
  Chrome-Profil ohnehin angemeldet bist. Der Drive-Zugriff ist auf `drive.file` beschränkt (nur Dateien,
  die die Extension selbst anlegt).
- Gespeichert wird in `chrome.storage.local`: Einstellungen und pro Kurs, welche Objekte bereits in welchem
  Notebook liegen. „Zurücksetzen“ in den Optionen löscht das.
- Die NotebookLM-Schnittstelle ist nicht öffentlich dokumentiert; Google kann sie jederzeit ändern. Die aktuell
  genutzten Aufrufe sind in [`docs/FINDINGS.md`](docs/FINDINGS.md) festgehalten.
- Kursinhalte unterliegen dem Urheberrecht der Lehrenden. Der Export ist für dein persönliches Lernen gedacht –
  Notebooks mit Kursmaterial bitte nicht öffentlich teilen.

## Lizenz

[MIT](LICENSE). Gebündelte Fremdsoftware und ihre Lizenzen: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Mitmachen: [CONTRIBUTING.md](CONTRIBUTING.md).
