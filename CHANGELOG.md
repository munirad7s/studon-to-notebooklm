# Changelog

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
