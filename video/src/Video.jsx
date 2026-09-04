import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { T, Scene, Pop, Caption, StudOnFrame, HeaderButton, BookIcon, ListRow, Dialog, ExportTab, NotebookMock, Cursor, fadeIn } from './ui.jsx';

/* Szenenplan (30 fps):
   0–120     Titel
   120–360   Problem: Material verstreut
   360–600   Der Button neben "Aktionen"
   600–900   Dialog
   900–1320  Export läuft
   1320–1650 NotebookLM antwortet
   1650–1950 Vier Stärken
   1950–2220 Installation + Adresse                                          = 74 s */

export const DURATION = 2220;

const clampFrame = (frame, start, end) => Math.max(0, Math.min(1, (frame - start) / (end - start)));

function Title() {
  const frame = useCurrentFrame();
  return (
    <Scene from={0} duration={120} bg={T.blue}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', color: '#fff' }}>
        <Pop delay={4} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <BookIcon size={96} />
          <div style={{ fontSize: 96, fontWeight: 600 }}>StudOn → NotebookLM</div>
        </Pop>
        <Pop delay={18} style={{ fontSize: 40, opacity: 0.9, marginTop: 24 }}>Dein ganzer Kurs in NotebookLM. Ein Klick.</Pop>
        <Pop delay={34} style={{ fontSize: 26, opacity: 0.7, marginTop: 60, border: '1px solid rgba(255,255,255,0.5)', padding: '8px 22px' }}>Chrome-Extension · Open Source · MIT</Pop>
      </AbsoluteFill>
    </Scene>
  );
}

function Problem() {
  const frame = useCurrentFrame() - 120;
  const rows = [
    ['📁', 'Vorlesungsfolien', '12 Dateien'],
    ['📕', 'Lernmodul: Evaluation', '14 Seiten'],
    ['🎬', 'Vorlesung_10.06.2026.mp4', '261 MB'],
    ['🔗', 'fau.tv – Aufzeichnung Kapitel 6', 'Weblink'],
    ['📁', 'Übungsblätter', '6 Dateien'],
    ['📝', 'Übung 1: Bedürfnisse', 'Übung'],
    ['🗣️', 'HCI-Forum', '123 Beiträge'],
  ];
  return (
    <Scene from={120} duration={240}>
      <StudOnFrame title="Human Computer Interaction (SoSe26)" right={<HeaderButton>Aktionen ▾</HeaderButton>}>
        <div style={{ border: `1px solid ${T.border}` }}>
          {rows.map(([icon, title, props], i) => <ListRow key={title} icon={icon} title={title} props={props} delay={10 + i * 9} />)}
        </div>
      </StudOnFrame>
      <Caption delay={100}>Folien hier, Aufzeichnung dort, Transkript nirgends.</Caption>
    </Scene>
  );
}

function Button() {
  const frame = useCurrentFrame() - 360;
  const slide = interpolate(frame, [20, 40], [-40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const btnOpacity = fadeIn(frame, 20, 14);
  // Cursor faehrt zum Button und klickt
  const cx = interpolate(frame, [90, 150], [1500, 1470], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cy = interpolate(frame, [90, 150], [700, 218], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const click = frame >= 156 && frame < 170;
  return (
    <Scene from={360} duration={240}>
      <StudOnFrame
        title="Human Computer Interaction (SoSe26)"
        right={(
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ opacity: btnOpacity, transform: `translateX(${slide}px)` }}>
              <HeaderButton highlight={frame > 150}><BookIcon size={18} /> NotebookLM</HeaderButton>
            </div>
            <HeaderButton>Aktionen ▾</HeaderButton>
          </div>
        )}
      >
        <div style={{ border: `1px solid ${T.border}` }}>
          {[['📁', 'Vorlesungsfolien', '12 Dateien'], ['📕', 'Lernmodul: Evaluation', '14 Seiten'], ['🎬', 'Vorlesung_10.06.2026.mp4', '261 MB']].map(([icon, title, props]) => (
            <ListRow key={title} icon={icon} title={title} props={props} />
          ))}
        </div>
      </StudOnFrame>
      {frame >= 90 && <Cursor x={cx} y={cy} click={click} />}
      <Caption delay={40}>Ein Button – direkt neben „Aktionen“, wie von StudOn.</Caption>
    </Scene>
  );
}

function DialogScene() {
  const frame = useCurrentFrame() - 600;
  const cx = interpolate(frame, [110, 170], [1300, 1255], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cy = interpolate(frame, [110, 170], [900, 775], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pressed = frame >= 176;
  return (
    <Scene from={600} duration={300}>
      <StudOnFrame title="Human Computer Interaction (SoSe26)" right={<HeaderButton><BookIcon size={18} /> NotebookLM</HeaderButton>} />
      <AbsoluteFill style={{ background: 'rgba(22,22,22,0.45)', justifyContent: 'center', alignItems: 'center' }}>
        <Pop delay={6}>
          <Dialog title="Human Computer Interaction (SoSe26)" meta="Kurs · ref 6748584" pressed={pressed} />
        </Pop>
      </AbsoluteFill>
      {frame >= 110 && <Cursor x={cx} y={cy} click={pressed && frame < 190} />}
      <Caption delay={30}>Was soll rein? Neues oder vorhandenes Notebook? Fertig.</Caption>
    </Scene>
  );
}

function ExportScene() {
  const frame = useCurrentFrame() - 900;
  const log = [
    ['📓', 'Notebook „Human Computer Interaction (SoSe26)“ angelegt'],
    ['📝', 'Info – Human Computer Interaction'],
    ['📝', 'Lernmodul – Evaluation (14 Seiten, 3 812 Wörter)'],
    ['📄', 'HCI_SS_2026_06_Evaluation.pdf'],
    ['🎬', 'Vorlesung_10.06.2026.mp4: Tonspur wird herausgelöst (261 MB Video)'],
    ['🎧', 'Vorlesung_10.06.2026.m4a: 71 MB, 83 min'],
    ['📝', 'Transkript – 9 - Human Computer Interaction (HCI) - Evaluation 1'],
    ['📄', 'Blatt_03.pdf'],
    ['✓', 'Verarbeitung in NotebookLM abgeschlossen – 23 Quellen'],
  ];
  const shown = Math.min(log.length, Math.floor(Math.max(0, frame - 20) / 34));
  const progress = interpolate(frame, [20, 330], [2, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Scene from={900} duration={420}>
      <ExportTab progress={progress} lines={log.slice(0, shown).map(([i, t], k) => <div key={k}>{i} {t}</div>)}>
        {shown < log.length ? 'Export läuft …' : 'Export abgeschlossen'}
      </ExportTab>
      <Caption delay={60}>Videos werden zur Tonspur, fau.tv-Clips zum Transkript.</Caption>
    </Scene>
  );
}

function NotebookScene() {
  const frame = useCurrentFrame() - 1320;
  const question = 'Was unterscheidet heuristische Evaluation von einem Nutzertest?';
  const chars = Math.floor(interpolate(frame, [40, 130], [0, question.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const answer = frame > 170
    ? 'Heuristische Evaluation lässt Expert:innen die Oberfläche gegen Prinzipien wie Nielsens Heuristiken prüfen, ohne Nutzer:innen; ein Nutzertest beobachtet echte Personen bei Aufgaben. Die Vorlesung empfiehlt beides zu kombinieren.'
    : null;
  return (
    <Scene from={1320} duration={330}>
      <NotebookMock
        sources={['Lernmodul – Evaluation', 'HCI_SS_2026_06_Evaluation.pdf', 'Vorlesung_10.06.2026.m4a', 'Transkript – Evaluation 1', 'Blatt_03.pdf', 'Info – Human Computer Interaction']}
        question="Frage an deinen Kurs …"
        typed={chars > 0 ? question.slice(0, chars) : null}
        answer={answer}
      />
      <Caption delay={200}>Antworten mit Beleg – aus Folien, Aufzeichnung und Transkript.</Caption>
    </Scene>
  );
}

function Features() {
  const tiles = [
    ['Alles vom Kurs', 'Ordner, Dateien, Lernmodule, Übungen, Wikis, Glossare, Foren – alle drei StudOn-Layouts.'],
    ['Videos als Tonspur', 'Aufzeichnungen über 200 MB werden ohne Neukodierung zur .m4a – NotebookLM transkribiert.'],
    ['fau.tv-Transkripte', 'Statt des Videos das fertige Whisper-Transkript mit Zeitmarken.'],
    ['Inkrementell', 'Beim nächsten Lauf kommt nur Neues dazu. Nichts doppelt.'],
  ];
  return (
    <Scene from={1650} duration={300} bg={T.panelHead}>
      <AbsoluteFill style={{ padding: '110px 140px' }}>
        <Pop style={{ fontSize: 56, fontWeight: 600, color: T.text2, marginBottom: 50 }}>Was die Extension kann</Pop>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
          {tiles.map(([h, p], i) => (
            <Pop key={h} delay={14 + i * 12} style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 4, padding: '30px 34px' }}>
              <div style={{ fontSize: 34, fontWeight: 600, color: T.blue, marginBottom: 12 }}>{h}</div>
              <div style={{ fontSize: 26, lineHeight: '38px', color: T.text2 }}>{p}</div>
            </Pop>
          ))}
        </div>
      </AbsoluteFill>
    </Scene>
  );
}

function Install() {
  const steps = [
    'ZIP herunterladen und entpacken',
    'chrome://extensions → Entwicklermodus → „Entpackte Erweiterung laden“',
    'Kurs auf StudOn öffnen → NotebookLM-Button',
  ];
  return (
    <Scene from={1950} duration={270} bg={T.blue}>
      <AbsoluteFill style={{ padding: '120px 160px', color: '#fff' }}>
        <Pop style={{ fontSize: 60, fontWeight: 600, marginBottom: 46 }}>In drei Schritten</Pop>
        {steps.map((s, i) => (
          <Pop key={s} delay={12 + i * 14} style={{ display: 'flex', alignItems: 'center', gap: 28, fontSize: 34, marginBottom: 30 }}>
            <span style={{ width: 64, height: 64, border: '3px solid #fff', display: 'grid', placeItems: 'center', fontWeight: 600, flex: 'none' }}>{i + 1}</span>{s}
          </Pop>
        ))}
        <Pop delay={70} style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', gap: 30 }}>
          <span style={{ fontSize: 48, fontWeight: 600 }}>studon-to-notebooklm.pages.dev</span>
          <span style={{ fontSize: 26, opacity: 0.8 }}>Kostenlos · Open Source · Läuft komplett im Browser</span>
        </Pop>
      </AbsoluteFill>
    </Scene>
  );
}

export function Video() {
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Title />
      <Problem />
      <Button />
      <DialogScene />
      <ExportScene />
      <NotebookScene />
      <Features />
      <Install />
    </AbsoluteFill>
  );
}
