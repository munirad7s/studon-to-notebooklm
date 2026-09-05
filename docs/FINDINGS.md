# Findings: StudOn → NotebookLM (Stand 2026-09-04)

Gesammelte Befunde aus der Entwicklung (Protokolle, Markup, Grenzen).
Ziel: jede*r kann damit ohne erneute Recherche weiterbauen.

## 1. Warum die v1 nicht funktioniert hat

- `content/content.bundle.js` = JSZip + eingebetteter Crawler + UI. Der Export war **nur ein ZIP-Download**,
  danach wurde lediglich `notebooklm.google.com` in einem Tab geöffnet. Kein Upload, keine Drive-Anbindung.
- `lib/drive.js` war ein ES-Modul (`export class`), wurde aber nirgends importiert. `chrome.identity.getAuthToken`
  hätte ohne `oauth2`-Block im Manifest ohnehin nicht funktioniert.
- Der Crawler erkannte Objekte über geratene URL-Muster (`/fold/`, `/lm/`, `sendfile`, `ilObjFileGUI`).
  StudOn (ILIAS 9) verlinkt Objekte aber als `https://www.studon.fau.de/studon/go/<typ>/<ref_id>`
  (z. B. `go/fold/6071389`, `go/crs/234016`). Die Muster griffen also nie.
- Kein Zustand, kein inkrementeller Sync, keine Quellen-Limits, keine Fehlerbehandlung bei abgelaufener Session.
- `DESIGN.md` im Repo ist nur ein Linear-Styleguide, keine Architektur.

## 2. NotebookLM: internes Protokoll (verifiziert aus zwei Quellen)

Quellen: die installierte Chrome-Extension „YouTube to NotebookLM“ (ID `kobncfkmjelbefaoohoblamnbackjggk`,
`build/background.js`) und das installierte CLI `notebooklm-mcp-cli` v0.9.14
(`notebooklm_tools/core/{base,sources,notebooks}.py`).

### Hosts und Tokens

- `https://notebooklm.google.com/` antwortet aktuell mit **301 → `https://notebook.google.com/`**. Beide Hosts in
  `host_permissions` aufnehmen und die Basis-URL aus der finalen Redirect-URL ableiten.
- Nicht eingeloggt: Redirect nach `accounts.google.com` → Nutzer muss sich im selben Chrome-Profil bei NotebookLM anmelden.
- Aus dem HTML der Startseite (Regex):
  - `"SNlM0e":"…"` → CSRF-Token, geht als `at=` in den POST-Body.
  - `"cfb2h":"…"` → Build-Label, geht als `bl=` in die Query (z. B. `boq_labs-tailwind-frontend_20260824.15_p0`).
  - `"FdrFJe":"…"` → Session-ID, optional als `f.sid=`.
  - `"oPEP7c":"…"` → E-Mail des eingeloggten Accounts (nur für die UI).
- Mehrere Google-Accounts: `?authuser=N` an Startseite, batchexecute und Upload-URL, plus Header `x-goog-authuser: N`.

### RPC-Aufruf (batchexecute)

```
POST {base}/_/LabsTailwindUi/data/batchexecute?rpcids=<ID>&source-path=<PFAD>&bl=<BL>&hl=en&rt=c&f.sid=<SID>&_reqid=<zufällig 100000–999999>
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
X-Same-Domain: 1
Body: f.req=<urlencoded JSON [[["<ID>", "<params als JSON-String>", null, "generic"]]]>&at=<CSRF>&
```

`source-path` ist `/` für globale Aufrufe und `/notebook/<notebookId>` für notebookbezogene.

Antwort: beginnt mit `)]}'`, dann Zeilen aus Byte-Zählern und JSON-Chunks. Gesuchtes Element:
`["wrb.fr", "<ID>", "<result als JSON-String>", null, null, <error|null>, "generic"]`.
Fehler stehen in `item[5] = [code, null, [[detailTypeUrl, [...]]]]`. Codes: 3 INVALID_ARGUMENT,
5 NOT_FOUND, 7 PERMISSION_DENIED, **8 RESOURCE_EXHAUSTED (Notebook voll / Rate-Limit)**, 9 FAILED_PRECONDITION,
**16 UNAUTHENTICATED (Token erneuern)**. Bei 3/9 nach einem „add source“ trotzdem die Quellenliste pollen,
die Quelle ist oft angekommen (das CLI nennt das „reconcile“).

### RPC-IDs und Parameter

| Aktion | rpcid | params |
|---|---|---|
| Notebooks auflisten | `wXbhsf` | `[null, 1, null, [2]]` → `result[0]` = Liste `[title, sources[], id, emoji, null, meta]` |
| Notebook anlegen | `CCqFvf` | `[title, null, null, [2], [1,null,null,null,null,null,null,null,null,null,[1]]]` → `result[2]` = id |
| Notebook lesen | `rLM1Ne` | `[id, null, [2], null, 0]` → `result[0][1]` = sources: `[[id], title, meta, [null, status]]`; `meta[4]` = Typ (3 pdf, 4 Text, 5 Web, 8 generierter Text, 9 YouTube, 10 Audio, 11 Upload), `meta[7][0]` = URL bei Webseiten, **`meta[5]` = `[url, videoId, channel]` bei YouTube** (live 2026-09-05; die `nlm`-CLI liest dort nichts und meldet `url: null`) |
| Notebook umbenennen | `s0tc2d` | `[id, [[null,null,null,[null,title]]]]` |
| Notebook löschen | `WWINqb` | `[[id],[2]]` |
| Quelle: Text | `izAoDd` | `[[[null,[title,text],null,2,null,null,null,null,null,null,1]], nbId, [2], OPTS]` |
| Quelle: URL (v1) | `izAoDd` | Web: `[null,null,[url],null,null,null,null,null,null,null,1]`, YouTube: `[null,null,null,null,null,null,null,[url],null,null,1]`; mehrere Quellen = mehrere Einträge in der ersten Liste |
| Quelle: URL (v2, Rollout) | `ozz5Z` | `[[[[null,url,627],[null,null,null,null,null,null,null,null,null,[null,null,1]],1]]]`, notebook nur im `source-path` |
| Quelle: Drive | `izAoDd` | `[[[[docId, mimeType, 1, title],null,null,null,null,null,null,null,null,null,1]], nbId, [2], OPTS]` |
| Datei registrieren (Upload Schritt 1) | `o4cbdc` | `[[[filename]], nbId, [2], OPTS]` → erster String im Ergebnis = SOURCE_ID |
| Quelle lesen | `hizoJc` | `[[sourceId], [2], [2]]` → `result[0]` = derselbe Eintrag wie in der Quellenliste (`[[id], title, meta, [null, status]]`), `result[3]` = Volltext-Blöcke |
| Quelle umbenennen | `b7Wfje` | `[null, [sourceId], [[[newTitle]]]]`, Pfad `/notebook/<id>` |
| Quellen löschen | `tGMBJ` | `[[[id1],[id2]], [2]]` |
| Drive-Frische prüfen | `yR9Yof` | `[null, [sourceId], [2]]` |
| Drive-Quelle syncen | `FLmJqe` | – |

`OPTS` = `[1,null,null,null,null,null,null,null,null,null,[1]]`. Antwort von „add source“: `result[0][i] = [[sourceId], title, …]`.

Quellen-Status in `src[3][1]`: 1 processing, **2 ready**, 3 error (bei PDF/Text/Upload endgültig), 5 preparing.
Quellentypen in `meta[4]`: 1 Google Docs, 2 Slides/Sheets, 3 PDF, 4 Text, 5 Web, 9 YouTube, 10 Audio, 11 Upload, 13 Bild, 14 Word.

### Datei-Upload (3 Schritte, resumable)

1. RPC `o4cbdc` → `SOURCE_ID`.
2. `POST {base}/upload/_/?authuser=0` mit Headern `x-goog-upload-command: start`,
   `x-goog-upload-protocol: resumable`, `x-goog-upload-header-content-length: <bytes>`, `x-goog-authuser: 0`,
   `Content-Type: application/x-www-form-urlencoded;charset=UTF-8`, Body = JSON
   `{"PROJECT_ID": nbId, "SOURCE_NAME": filename, "SOURCE_ID": sourceId}`. Antwort-Header `x-goog-upload-url`.
3. `POST <upload-url>` mit `x-goog-upload-command: upload, finalize`, `x-goog-upload-offset: 0`, Body = Bytes.
4. Danach `rLM1Ne` pollen bis Status 2.

Zulässige Uploads (offizielle Liste im CLI, 43 Endungen): pdf, txt, md, docx, csv, pptx, epub, Bilder
(png, jpg, gif, webp, …), Audio (mp3, m4a, wav, …), Video (mp4, avi, mpeg, …). **Nicht:** zip, xlsx, odt/odp/ods, html, py/java.
Limits: 200 MB pro Datei, ~500 k Wörter pro Quelle, 50 Quellen/Notebook (Free) bzw. 300 (Pro/Ultra).
Bei Überschreitung kommt Fehlercode 8 → Overflow-Notebook „<Titel> (2)“ anlegen.

## 3. StudOn (ILIAS 9): Struktur und Selektoren

Quellen: ein eigener Python-Scraper (fau-mcp) mit HTML-Snapshots echter StudOn-Seiten und funktionierenden
Download-Skripten für Kurse und Lernmodule.

- Kein REST-Plugin (`restplugin.php` → 404). Alles über gerendertes HTML mit Session-Cookie.
- Objekt-Links: `https://www.studon.fau.de/studon/go/<typ>/<ref_id>` (auch `goto.php?target=<typ>_<ref_id>`).
  Typen: crs, fold, grp, cat, sess, itgr, file, exc, lm, htlm, copa, wiki, frm, mcst, webr, glo, tst, svy, dcl, bibl, blog, …
- Container-Seite: `ilias.php?baseClass=ilrepositorygui&ref_id=<ref>` (auch für Ordner/Gruppen/Sitzungen).
- Listeneintrag (ILIAS-UI „Item“):
  ```html
  <li class="il-std-item-container"><div class="il-item il-std-item">
    <div class="media"><div class="media-left"><img class="icon custom medium" src=".../icon_fold.svg" alt="Ordner"></div>
    <div class="media-body"><h4 class="il-item-title"><a href="https://www.studon.fau.de/studon/go/fold/6071389">Übungsblätter</a></h4>
      <div class="il-item-actions">… <button data-action="ilias.php?baseClass=ilrepositorygui&cmd=download&ref_id=6071389">Download</button> …
      <div class="il-item-description">…</div>
      <div class="row il-item-properties"><span class="il-item-property-name">Zeit</span><span class="il-item-property-value">Gestern, 14:11</span>
  ```
  Objekttyp aus Icon-`src` (`icon_<typ>.svg`) oder `alt` (deutsches Label). Blöcke/Objektgruppen tragen
  Überschriften in `.ilContainerBlockHeader` bzw. `.il-item-group h3` → als Abschnittsname verwenden.
- **Datei-Download:** `goto.php?target=file_<ref>_download` (liefert `Content-Disposition`; kommt HTML zurück, war es keine Datei).
  Ordner-ZIP: `ilias.php?baseClass=ilrepositorygui&cmd=download&ref_id=<ref>`.
- **Lernmodule (lm):** Seiten-IDs aus `ilias.php?baseClass=ilLMPresentationGUI&ref_id=<ref>&cmd=showPrintViewSelection`
  (`<input name="sel_obj_id[]" value="<obj_id>">`), Seite: `…&obj_id=<obj_id>`, Text in `.ilc_page_cont_PageContainer`,
  angehängte Dateien als `<a href="…cmd=downloadFile…">`. Bewährt für das HCI-Modul (8 Lektionen, je ~15 Seiten).
- Übungen/Sitzungen/Mediacast: generische Erkennung über `cmd=download*`, `cmd=sendfile`, `target=file_…_download`;
  Sitzungen listen Materialien als Standard-Items (`go/file/…`).
- Session abgelaufen: Redirect auf `sso.uni-erlangen.de` bzw. Login-Formular (`name="password"`). Mit `redirect: follow`
  liefert der Login 200 → immer die finale URL/HTML prüfen (bekannte Falle).
- ILIAS-9-Templates auf GitHub liegen im Branch `release_9` unter `Modules/<Name>/templates/default/` (nicht `components/ILIAS/`).

## 4. Google Drive „direkt“

- Vom Browser aus braucht Drive eine OAuth-Client-ID (kein Weg ohne). Empfohlen: `chrome.identity.launchWebAuthFlow`
  mit einem OAuth-Client vom Typ **Webanwendung**, Redirect-URI `https://<extension-id>.chromiumapp.org/`,
  Scope `https://www.googleapis.com/auth/drive.file`, Implicit Flow (`response_type=token`).
- Damit die Extension-ID stabil ist, steht ein `"key"` im Manifest. Generiert am 2026-09-04:
  **Extension-ID `hceibhcelpeeniihfdlbfopkmnakhemd`** (Private Key liegt nur lokal in `.keys/`, nicht im Repo, wird für „Load unpacked“ nicht gebraucht).
- Drive-API v3: Ordner anlegen (`mimeType application/vnd.google-apps.folder`), Multipart-Upload
  `upload/drive/v3/files?uploadType=multipart`; Konvertierung durch `mimeType` in den Metadaten
  (pptx → `application/vnd.google-apps.presentation`, docx → `…document`, xlsx → `…spreadsheet`).
- NotebookLM nimmt Drive-Dateien als syncbare Quellen (RPC `izAoDd`, Drive-Form) für Docs, Slides, Sheets und PDF.
  Vorteil: pptx/xlsx werden so NotebookLM-fähig, und „Sync“ holt Änderungen nach.
- Bestehender Google-OAuth-Client aus `google-mcp` ist ein Desktop-/Testing-Client; ohne Redirect-URI-Eintrag nicht nutzbar.

## 5. Architektur v2 (umgesetzt in diesem Repo)

- **Export-Tab** (`export/export.html`) ist die Engine: volle Extension-Rechte (`chrome.storage`, `chrome.identity`,
  `chrome.downloads`), DOMParser, Blob-URLs, sichtbarer Fortschritt, überlebt lange Jobs. Kein Offscreen-Dokument,
  kein Service-Worker-Timeout-Risiko.
- Content-Script auf StudOn: Badge + Modal, ermittelt `ref_id`/Typ/Titel und öffnet den Export-Tab.
- Module in `lib/`: `ilias.js` (URLs/Typen), `text.js` (HTML→Markdown), `crawler.js` (rekursiver Scan → Baum),
  `nlm-client.js` (RPC + Upload), `drive-client.js`, `storage.js` (Kurszustand), `exporter.js` (Plan + Ausführung).
- Fetch aus Extension-Seiten sendet Cookies für Hosts mit `host_permissions` (so arbeitet auch die YouTube-Extension).
- Inkrementell: pro Kurs-`ref_id` werden Notebook-ID und hochgeladene Objekte (`ref_id`/Hash → sourceId) gespeichert.
- Tests: `node --test` mit `linkedom` als DOMParser, Fixtures aus echtem StudOn-Markup.


## 7. Live-Verifikation, die noch aussteht

1. Extension in Chrome laden (Profil mit StudOn- **und** NotebookLM-Login), Kurs öffnen, Badge → „Scannen“.
2. Prüfen, dass der Baum Ordner, Dateien, Sitzungen, Übungen, Lernmodule zeigt (Log zeigt unbekannte Typen).
3. Export in ein neues Notebook, Quellen-Status in NotebookLM prüfen (Upload → processing → ready).
4. Zweiter Lauf: nur neue Dateien werden ergänzt.
5. Optional Drive: Client-ID in den Optionen, Freigabe, Ordner in „Meine Ablage/NotebookLM Import/<Kurs>“ prüfen.

## 9. Survey ueber 65 Kurse eines Studierenden-Accounts (2026-09-04)

Skript im eingeloggten Browser: Mitgliedschaftsuebersicht → jeden Kurs bis Tiefe 3 rekursiv gelesen (368 Requests).

**Layouts:** 2 672 Legacy-Listenzeilen (`.ilCLI > .ilContainerListItemOuter`), nur 31 ILIAS-9-Items
(`.il-std-item`), 20 Kacheln (`.il-card`). Der Legacy-Pfad ist also der Normalfall, nicht der Fallback.
Folgen fuer den Parser:
- Outer- und Inner-Element einer Legacy-Zeile zeigen auf dieselbe `ref_id`; nur das Outer traegt das Icon.
  Dedupe muss pro `ref_id` passieren (vorher: zweiter Eintrag mit Typ `?` → Container-Probe → Muell-Knoten).
- Eigenschaften stehen als `.il_ItemProperty`-Spans: `pdf · 1,20 MB · 12. Mär 2026, 10:05`. Viele Dateititel
  haben keine Endung ("Cover Templates" ist ein zip; in Software-Engineering-Kursen 20-30 solcher Dateien pro Kurs).
- News-Block-Eintraege (`cmdClass=ilNewsForContextBlockGUI`) und Aktionslinks sehen wie Objekte aus → ausschliessen.

**Objekttypen (Summe):** fold 803, frm 122, file 162, webr 61, htlm 27, lm 21, exc 27, xvid 13, mcst 4,
grp 16, sess 3, copa 3, dcl 3, book 5, crsr 5, xcos 3, xpdl 3, xxco 2, tst 3, svy 2, glo 2, mep 1, bibl 1, catr 1.

**Videos:**
- `htlm` (HTML-Lernmodul) in Marketing-Kursen = Vorlesungsaufzeichnung: `ilias.php?baseClass=ilHTLMPresentationGUI&ref_id=`
  leitet **direkt auf das MP4** (261-272 MB, 83 min, 720p, ~440 kbit/s). `go/htlm/<ref>` landet dagegen auf dem
  Info-Reiter (HTML) – deshalb die Praesentations-URL benutzen und den Content-Type pruefen, bevor `res.text()`
  260 MB in den Speicher zieht.
- `xvid` = Plugin "Interaktives Video" (`ilObjInteractiveVideoGUI`): `ilias.php?baseClass=ilObjPluginDispatchGUI&cmd=forward&ref_id=<ref>&forwardCmd=showContent`,
  Seite enthaelt `<video><source src="./data/StudOn/mobs/mm_<id>/<name>.mp4?il_wac_token=…">` (Token zeitlich begrenzt)
  oder eine fau.tv-Einbettung (plyr).
- fau.tv-Links: 356 in den Kursen – Transkript-Import (Abschnitt 8) lohnt.
- NotebookLM nimmt 200 MB/Datei → Tonspur statt Video (`lib/audio-extract.js`: mp4box.js demuxt, eigener Muxer schreibt .m4a).

**Plugins ohne Inhalt fuer NotebookLM:** `xcos` = CoSub-Anmeldung (Prioritaeten), `xpdl` = Etherpad (iframe auf
etherpad233.studon.fau.de), `xxco` unbekannt → uebersprungen.

**Sonstiges:** Kurse ohne Inhalt (`#il_center_col` leer) existieren; Kursreferenzen (`crsr`) werden nicht verfolgt;
Mathematik-Kurse haben 200-360 Ordner (Tiefe > 3) – `maxDepth` 15 reicht, dauert aber.
