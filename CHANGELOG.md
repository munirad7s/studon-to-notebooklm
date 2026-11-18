# Changelog

## 2.4.0 – 2026-11-18

- **Export funktioniert wieder.** StudOn steht seit November 2026 hinter einem Bot-Schutz (Anubis). Dessen
  Durchlass gilt nur in StudOn-Tabs; der Export-Tab bekam statt der Kursseite die Prüfseite, der Scan meldete
  „0 Einträge“ und ins Notebook gingen nur Kursstruktur und Info. Jetzt holt ein StudOn-Tab die Seiten und
  Dateien und reicht sie an den Export-Tab weiter (`content/bridge.js`, `lib/studon-bridge.js`). Das ist der
  Tab, aus dem du startest. Klickst du dort weiter oder schließt ihn, übernimmt ein anderer StudOn-Tab; ist
  keiner offen, öffnet die Erweiterung einen im Hintergrund und schließt ihn danach wieder.
- **Klare Meldungen statt leerer Exporte.** Die Prüfseite des Bot-Schutzes wird erkannt und bricht den Scan
  mit Hinweis ab. Findet ein Scan nur die Info-Seite, steht das als Warnung da und der automatische Export
  startet nicht.
- **Schneller.** Während eine Datei zu NotebookLM hochlädt, wird die nächste schon von StudOn geholt – weiterhin
  nur ein StudOn-Download zur selben Zeit.
- **Läuft im Hintergrund durch.** Chrome friert Tabs ein, die einige Minuten nicht zu sehen sind, und bremst ihre
  Timer auf einen pro Minute – ein langer Export blieb stehen, sobald man den Tab wechselte. Export-Tab und
  StudOn-Tab halten jetzt für die Dauer des Laufs eine Web-Sperre (solche Tabs friert Chrome nicht ein), und die
  Pausen zwischen den Abrufen laufen über einen Worker. Antwortet der StudOn-Tab trotzdem nicht mehr, merkt die
  Erweiterung das nach wenigen Sekunden und wechselt den Tab.
- **Protokoll.** Scan- und Export-Protokoll des letzten Laufs werden je Kurs gespeichert; „Protokoll kopieren“
  im Export-Tab legt es für Fehlerberichte in die Zwischenablage.
- Der schwebende „NotebookLM“-Button unten rechts erschien zusätzlich zum Button neben „Aktionen“. Behoben.

## 2.3.1 – 2026-10-21

- **Geänderte Texte werden ersetzt.** Bisher blieb ein Text, der schon im Notebook lag, für immer in der alten
  Fassung – auch wenn das Lernmodul inzwischen viel mehr hergab. Jetzt wird die Wortzahl gemerkt; weicht sie
  spürbar ab (mehr als 10 % bzw. 20 Wörter), wird die alte Quelle gelöscht und die neue hochgeladen. Texte aus
  Exporten vor 2.3.0 werden beim nächsten Lauf einmalig erneuert (dort fehlten H5P-Inhalte und Lernmodul-Seiten
  standen doppelt).

## 2.3.0 – 2026-10-21

- **H5P-Inhalte werden exportiert.** Lernmodule (z. B. vhb-Kurse) bestehen oft fast nur aus H5P-Blöcken; bisher
  landete davon nur der Platzhalter „Bitte warten Sie, bis der Inhalt geladen werden konnte.“ im Notebook. Der
  Inhalt wird jetzt direkt aus dem Seitenquelltext gelesen (`il.H5P.initContent`, base64) und an seiner Stelle
  eingesetzt: Texte, Akkordeons, Course Presentations, Interactive Videos/Books und Selbsttests (Multiple Choice,
  Richtig/Falsch, Lückentext, Drag the Words, Guess the Answer) jeweils mit Lösung. H5P-Videos kommen als Datei
  (bzw. Tonspur) dazu, YouTube-Quellen als Link. Gilt für alle Seitentypen (Lernmodul, Inhaltsseite, Wiki …).
- Lernmodule: jede erste Seite eines Kapitels stand doppelt im Text, weil Kapitel und Seiten getrennt abgerufen
  wurden. Jetzt werden nur noch Seiten geholt (halb so viele Anfragen).

## 2.2.0 – 2026-09-22

- FAU.tv unabhängig von StudOn starten: über den Button auf Video- und Serienseiten oder einen eingefügten Link im Erweiterungs-Popup.
- Ganze Serien auflösen, Transkripte einzeln auswählen und in ein neues oder vorhandenes Notebook exportieren.
- Zusätzliche Video- und Serienlinks im StudOn-Exporter ergänzen; Links für erneute Scans merken.
- Überschneidende Links zusammenführen und fehlende Transkripte bzw. nötige Anmeldungen pro Video anzeigen.

## 2.1.1 – 2026-09-06

- Mediacasts/Seiten, die YouTube- oder fau.tv-Videos als `<video src=…>` einbinden, erzeugten einen Download-Job „watch“, der mit „Failed to fetch“ scheiterte. Solche Videos sind jetzt Links (YouTube-Quelle bzw. fau.tv-Transkript).

## 2.1.0 – 2026-09-05

- **Dubletten-Schutz gegen das echte Notebook:** Vor jedem Export wird die Quellenliste des Ziel-Notebooks geladen.
  Quellen, die dort liegen, aber lokal unbekannt sind (Reset, anderer Rechner, anderes Notebook), werden per Titel
  bzw. URL dem Kursobjekt zugeordnet statt erneut hochgeladen; lokal vermerkte Quellen, die im Notebook fehlen
  (in NotebookLM gelöscht), werden neu hochgeladen. Gleichlautende Quellen im Notebook werden gemeldet und lassen
  sich mit einem Klick (nach Rückfrage) entfernen.
- **Zustand gilt pro Notebook:** Derselbe Kurs in ein neues oder anderes Notebook bekommt alle Quellen; zurück im
  alten Notebook wird nichts doppelt angelegt. Folge-Notebooks „(2)“, „(3)“ bilden mit ihrem Ursprung eine Kette;
  nachgeladen wird ins letzte Glied, gezählt wird pro Kette.
- Lange Texte (mehrere Teile) und ZIP-Inhalte werden vollständig vermerkt und beim Ersetzen vollständig gelöscht
  (vorher blieben Teile bzw. entpackte Dateien als Dubletten stehen).
- Ist das bisherige Notebook gelöscht, legt „Zuletzt verwendet“ ein neues an statt fehlzuschlagen.

## 2.0.0 – 2026-09-04

Vollständiger Neubau. Die 1.x-Version lud nur ein ZIP herunter; jetzt landet der Kurs direkt in NotebookLM.

- **Direkter Export nach NotebookLM** über die interne batchexecute-Schnittstelle (Notebook anlegen,
  Dateien hochladen, Texte als Quellen, Verarbeitung abwarten). Folge-Notebook, wenn das Quellen-Limit erreicht ist.
- **Kompletter Kurs-Scan** (ILIAS 9 / StudOn): Ordner, Gruppen, Sitzungen, Dateien (inkl. ZIP-Entpacken),
  Lernmodule, HTML-Lernmodule (auch mit MP4 als Startdatei), Inhaltsseiten, Wikis, Glossare, Übungen,
  Weblinks, Mediacasts, Interaktive Videos (Plugin `xvid`), Foren (optional). Alle drei StudOn-Layouts
  (ILIAS-9-Items, klassische Listenzeilen, Kacheln).
- **Videos als Tonspur:** MP4-Aufzeichnungen werden ohne Neukodierung zu `.m4a` (mp4box.js + eigener Muxer),
  weil NotebookLM 200 MB pro Datei nimmt und nur den Ton auswertet.
- **fau.tv-Transkripte:** statt des Videos das Whisper-Transkript des Videoportals als Textquelle mit Zeitmarken.
- **Inkrementeller Sync:** pro Kurs wird gemerkt, was schon im Notebook liegt; der nächste Lauf ergänzt nur Neues.
- **Dialog auf der Kursseite** neben „Aktionen“ (StudOn-Design): Inhalt wählen, Notebook neu oder vorhanden,
  ein Klick – der Export-Tab läuft ohne weiteren Klick durch. „Mehr Einstellungen“ öffnet die volle Ansicht.
- **Google-Drive-Spiegel** (optional, eigene OAuth-Client-ID): pptx/docx/xlsx werden konvertiert und als
  syncbare Quellen verknüpft. **ZIP-Export** als Fallback.
- Tests (`node --test`) gegen Fixtures aus echtem StudOn-Markup; Browser-Harness für den kompletten Ablauf ohne Netz.

## 1.0.x

ZIP-Download mit geratenen URL-Mustern; kein Upload. Ersetzt.
