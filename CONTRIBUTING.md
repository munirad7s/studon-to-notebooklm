# Mitmachen

Danke fürs Interesse. Das Projekt ist bewusst klein: reine Browser-Extension, keine Build-Kette,
kein Backend. Alles, was du brauchst, ist Node 22 und Chrome.

## Einrichten

```bash
git clone https://github.com/munirad7s/studon-to-notebooklm.git
cd studon-to-notebooklm
npm install          # nur Dev-Abhängigkeiten (linkedom für Tests, mp4box für Updates des Vendor-Bundles)
npm test             # node --test, ~60 Fälle, läuft in unter einer Sekunde
npm run package      # prüft Manifest-Verweise und Importe, baut dist/*.zip
```

Extension laden: `chrome://extensions` → Entwicklermodus → „Entpackte Erweiterung laden“ → Repo-Ordner.
Nach Änderungen an `manifest.json`, Content-Script oder Service Worker die Extension neu laden (↻).

## Ohne Netz testen

Zwei Harness-Seiten spielen die Oberfläche mit gefälschtem StudOn, fau.tv und NotebookLM durch:

```bash
python3 -m http.server 8791
# http://localhost:8791/test/browser-harness.html          Export-Tab, komplett (auch ?autostart=1&mode=existing…)
# http://localhost:8791/test/modal-harness.html            Dialog auf der Kursseite (?known=1, ?loggedout=1)
```

Der Seitentitel der Harness zeigt `OK` oder `FEHLER (n)`.

## Wo was liegt

| Bereich | Datei |
|---|---|
| StudOn-URLs, Objekttypen, Login-Erkennung | `lib/ilias.js` |
| Kurs-Scan (Ordner, Lernmodule, Übungen, Videos, …) | `lib/crawler.js` |
| NotebookLM-Protokoll (batchexecute, Upload) | `lib/nlm-client.js`, Details in `docs/FINDINGS.md` |
| fau.tv-Transkripte | `lib/fautv.js` |
| Tonspur aus MP4 | `lib/audio-extract.js` |
| Export-Plan und Ausführung | `lib/exporter.js` |
| Oberflächen | `content/` (Dialog auf StudOn), `export/` (Engine-Tab), `popup/`, `options/` |
| Design-Tokens | `docs/design-system-studon.md`, `ui/theme.css` |

## Regeln für Änderungen

- **Fixtures aus echtem Markup.** Neue StudOn-Fälle bitte mit einem Ausschnitt des echten DOM als Fixture
  in `test/fixtures/` belegen (personenbezogene Daten entfernen). Was nur „so ähnlich“ ist, bricht auf der
  nächsten Kursseite.
- **Keine Zugangsdaten im Code.** Die Extension nutzt ausschließlich die Sessions des Browsers. Google-Drive
  braucht eine eigene OAuth-Client-ID, die der Nutzer in den Optionen einträgt.
- **Tests grün, `npm run package` grün**, bevor du einen PR stellst. Der Manifest-Check hat schon einmal
  eine unbenutzbare Version verhindert.
- **Protokolländerungen dokumentieren.** Ändert Google die RPC-IDs oder fau.tv sein Markup, gehört der neue
  Befund nach `docs/FINDINGS.md`, nicht nur in den Code.

## Fehler melden

Bitte mit: StudOn-Objekttyp (Icon oder `go/<typ>/…`-Link), was im Scan-Log steht, und – falls möglich –
ein bereinigter HTML-Ausschnitt der Seite. Keine Session-Cookies, keine Screenshots mit Namen anderer Studierender.
