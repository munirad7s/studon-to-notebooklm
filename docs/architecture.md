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
2. **Abgleich** (`reconcileNotebook`) → echte Quellenliste der Ziel-Kette laden (`rLM1Ne`) und mit `state.items` abgleichen:
   lokal vermerkte Quellen, die im Notebook fehlen → Zuordnung gelöscht (werden neu geplant); unbekannte Quellen im
   Notebook, die zu einem Kursobjekt passen → übernommen (Datei/Text per Titel, Link per URL, Datei ohne Endung per
   Namensstamm). Gleichlautende Titel im selben Notebook werden als Dubletten gemeldet (Löschen nur per Klick).
3. **Plan** (`planExport`) → Jobs (file/text/link/overview) minus Objekte, die laut abgeglichenem Zustand in der
   Ziel-Kette liegen (Signatur aus Größe + Änderungsdatum entscheidet über Ersetzen). Zustand anderer Notebooks zählt nicht.
4. **Run** (`Exporter.run`) → Kette wählen (Upload ins letzte Glied) → Abgleich erneut, Plan neu rechnen → Jobs sequentiell
   (Links gebündelt zu 10) → Zustand nach jedem Job persistieren → optional auf Verarbeitung warten → optional ZIP.
5. **Zustand** pro Kurs: `course:<ref_id>` = `{ notebooks[{id,title,group}], primaryNotebookId, items{ key → sourceIds[], notebookId, signature, history{nbId → ids} } }`.
   `group` fasst ein Notebook mit seinen Folge-Notebooks „(2)“, „(3)“ … zu einer Kette zusammen; `history` merkt sich die
   Quellen desselben Objekts in anderen Notebooks (Wechsel A → B → A ohne Dubletten, auch bei ZIP-Inhalten).
   Der Zustand ist ein Cache – das Notebook ist die Wahrheit.

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
