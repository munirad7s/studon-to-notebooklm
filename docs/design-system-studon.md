# Design-System: StudOn (studon9skin)

Gemessen am 2026-09-04 per `getComputedStyle` auf www.studon.fau.de (Kursseite). Gilt für alle
Oberflächen der Extension: Dialog auf der StudOn-Seite, Export-Tab, Popup, Optionen.
Umgesetzt in `ui/theme.css` (Extension-Seiten) und `content/content.css` (Dialog im Shadow DOM).

| Token | Wert | Herkunft |
|---|---|---|
| Schrift | `Roboto-StudOn, Verdana, Arial, Helvetica, sans-serif`, 14px / 20px | `body` |
| Text | `#161616`; Titel `#2c2c2c`, 600 | `body`, `h1` |
| Primär (FAU-Blau) | `#04316a`, Schrift weiß | `.btn-primary`, aktiver Reiter, Hauptleiste |
| Link / Header-Buttons | `#4c6586` | `a`, `#il_head_action .btn-default` (gefüllt, weiß, 12px, 3px 6px) |
| Panel | Rahmen `#dddddd`, Radius 3px; Kopf `#f9f9f9` | `.panel`, `.panel-heading` |
| Eingabefelder | Rahmen `#757575`, eckig, 28px hoch, 12–13px | `input`, `select` |
| Buttons | eckig (0px); Standard: weiß mit Rahmen `#2c2c2c` | `.btn-default` außerhalb des Headers |
| Hinweise | Bootstrap-3-Alerts: info `#d9edf7/#31708f`, warning `#fcf8e3/#8a6d3b`, danger `#f2dede/#a94442` | `.alert-*` |

Auslöser auf der Kursseite: ein `div.btn-group > button.btn.btn-default` **vor** dem „Aktionen“-Button in
`#il_head_action #tttt` – im Light DOM, damit das Seiten-CSS greift und der Button exakt wie das Original
aussieht. Ohne diesen Bereich (z. B. Lernmodul-Ansicht) fällt der Auslöser auf einen schwebenden Button zurück.

Das frühere dunkle Linear-Theme der 2.0-Vorabversion ist damit abgelöst.
