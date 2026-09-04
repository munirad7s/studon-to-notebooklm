# Architektur v2

```
StudOn-Tab                          Exporter-Tab (export/export.html)                 Google
┌──────────────────┐   message     ┌──────────────────────────────────────┐          ┌──────────────┐
│ content/content.js│ ───────────▶ │ export.js (UI + Orchestrierung)      │  fetch   │ StudOn       │
│  ⚡ Badge, ref_id │  open-exporter│  ├ lib/crawler.js  ── DOMParser ─────┼─────────▶│ (Session-    │
└──────────────────┘   via SW      │  ├ lib/exporter.js                   │          │  Cookies)    │
                                    │  │   ├ lib/nlm-client.js ── batchexecute + upload ─▶ NotebookLM │
background/service_worker.js       │  │   └ lib/drive-client.js ── Drive v3 ──────────▶ Drive       │
  (öffnet/fokussiert den Tab)       │  └ lib/storage.js (chrome.storage.local)         │              │
                                    └──────────────────────────────────────┘          └──────────────┘
```

## Warum ein Extension-Tab statt Service-Worker/Offscreen

- Extension-Seiten haben volle `chrome.*`-Rechte (`storage`, `identity`, `downloads`), DOMParser, Blob-URLs.
- `fetch` aus Extension-Seiten sendet Cookies für alle Hosts in `host_permissions` – genau wie die YouTube-Extension.
- Lange Jobs (hunderte Dateien) laufen sichtbar mit Fortschritt, überleben Popup-Schließen und SW-Timeouts.

## Datenfluss

1. **Scan** (`StudOnCrawler.scan`) → Baum aus `container | file | text | link | skipped`-Knoten; jede Fehlerquelle wird am Knoten notiert, nur eine abgelaufene Session bricht ab.
2. **Plan** (`planExport`) → Jobs (file/text/link/overview) minus bereits exportierte Objekte (`state.items[key]`, Signatur aus Größe + Änderungsdatum).
3. **Run** (`Exporter.run`) → Notebook sicherstellen → Jobs sequentiell (Links gebündelt zu 10) → Zustand nach jedem Job persistieren → optional auf Verarbeitung warten → optional ZIP.
4. **Zustand** pro Kurs: `course:<ref_id>` = `{ notebooks[], primaryNotebookId, items{ key → sourceId, notebookId, signature } }`.

## Schlüssel (idempotenter Sync)

| Knoten | Key |
|---|---|
| Datei aus Repository | `file:<ref_id>` |
| Datei aus LM/Übung/Seite | `dl:<downloadKey>` (`file_id` ohne `obj_id`, damit dieselbe Datei auf mehreren LM-Seiten einmal zählt) |
| Text | `text:<typ>:<ref_id>:<dateiname>` |
| Link | `link:<url>` |
| Kursstruktur | `overview` (wird bei jedem Lauf ersetzt) |

## Tests

`node --test` mit `linkedom` als DOMParser. Fixtures in `test/fixtures/studon.js` bilden das echte ILIAS-9-Markup
(`il-std-item`, `il-item-title`, `il-item-property-*`, `ilContainerBlockHeader`, `sel_obj_id[]`, `cmd=downloadFile`) nach.
Der NotebookLM-Client wird gegen die exakten Request-Formate (Query, `f.req`, `at`, Upload-Header) getestet.
