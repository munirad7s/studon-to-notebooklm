# Architektur v2

```
StudOn-Tab                          Exporter-Tab (export/export.html)                 Google
┌──────────────────┐  open-exporter ┌──────────────────────────────────────┐          ┌──────────────┐
│ content/content.js│ ─── via SW ──▶│ export.js (UI + Orchestrierung)      │          │              │
│  Button, Dialog   │               │  ├ lib/crawler.js  ── DOMParser      │          │              │
│                   │  s2n-fetch    │  ├ lib/exporter.js                   │          │              │
│ content/bridge.js │◀── /-read ────│  │   ├ lib/studon-bridge.js          │          │              │
│  fetch (Cookies,  │ ── Antwort ──▶│  │   ├ lib/nlm-client.js ── batchexecute + upload ─▶ NotebookLM │
│  Bot-Schutz-Pass) │               │  │   └ lib/drive-client.js ── Drive v3 ──────────▶ Drive       │
└────────┬─────────┘               │  └ lib/storage.js (chrome.storage.local)         │              │
         │ fetch                    └──────────────────────────────────────┘          └──────────────┘
         ▼
      StudOn                        background/service_worker.js öffnet/fokussiert den Exporter-Tab
```

## Warum ein Extension-Tab statt Service-Worker/Offscreen

- Extension-Seiten haben volle `chrome.*`-Rechte (`storage`, `identity`, `downloads`), DOMParser, Blob-URLs.
- `fetch` aus Extension-Seiten sendet die Google-Cookies für NotebookLM und Drive (`host_permissions`).
- Lange Jobs (hunderte Dateien) laufen sichtbar mit Fortschritt, überleben Popup-Schließen und SW-Timeouts.

## Warum StudOn über einen StudOn-Tab gelesen wird (seit 2.4.0)

Seit November 2026 steht der Bot-Schutz Anubis vor StudOn. Wer die Rechenaufgabe bestanden hat, bekommt das
Cookie `fau-studon-anubis-auth` – gesetzt mit `Partitioned`, also nur gültig, wenn die oberste Seite zu
`fau.de` gehört. Ein `fetch` aus dem Exporter-Tab (`chrome-extension://…`) liegt in einer anderen
Cookie-Partition und bekommt bei HTTP 200 die Prüfseite statt des Inhalts. Die Session (`PHPSESSID`) käme an,
der Durchlass nicht.

Deshalb führt ein StudOn-Tab die Abrufe aus:

- `content/bridge.js` läuft in jedem StudOn-Tab und beantwortet `s2n-fetch` (Kopf der Antwort), `s2n-text`
  (Inhalt als Text), `s2n-read` (Binärdaten in Base64-Stücken von 1 MB) und `s2n-cancel`. Es ruft nur
  StudOn-Adressen ab und nur für die eigene Erweiterung.
- `lib/studon-bridge.js` gibt dem Crawler und dem Exporter ein `fetch` mit denselben Eigenschaften wie
  bisher (`ok`, `status`, `url`, `headers.get`, `text()`, `blob()`, `body.cancel()`). FAU.tv und Google
  gehen weiter direkt.
- Tab-Wahl: der Tab, aus dem gestartet wurde → ein anderer geladener StudOn-Tab → ein eigener
  Hintergrund-Tab, der nach Scan bzw. Export wieder geschlossen wird. Geht der Tab mitten in einer Antwort
  verloren (Navigation, geschlossen), wird der Abruf über den nächsten Tab wiederholt.
- Die Erweiterung löst die Prüfung nicht selbst und kopiert kein Cookie: sie nutzt den Tab, in dem der
  Browser die Prüfung im normalen Betrieb bestanden hat. Zeigt ein Tab noch die Prüfseite, wird er
  übergangen; liefert StudOn sie trotzdem, bricht der Scan mit `BotCheckError` ab.

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
