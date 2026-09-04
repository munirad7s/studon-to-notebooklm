import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** StudOn-Designtokens (docs/design-system-studon.md), damit das Video wie die Extension aussieht. */
export const T = {
  blue: '#04316a',
  blueHover: '#1a4a85',
  link: '#4c6586',
  text: '#161616',
  text2: '#2c2c2c',
  muted: '#6f6f6f',
  border: '#dddddd',
  panelHead: '#f9f9f9',
  bg: '#ffffff',
  green: '#1e7f3a',
  font: 'Roboto, Verdana, Arial, Helvetica, sans-serif',
  mono: 'Menlo, Consolas, monospace',
};

export const fadeIn = (frame, start, len = 15) => interpolate(frame, [start, start + len], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
export const fadeOut = (frame, end, len = 15) => interpolate(frame, [end - len, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export function Pop({ delay = 0, children, style }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
  const o = interpolate(frame - delay, [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ transform: `translateY(${(1 - s) * 24}px)`, opacity: o, ...style }}>{children}</div>;
}

export function Scene({ from, duration, children, bg = T.bg }) {
  const frame = useCurrentFrame();
  const local = frame - from;
  if (local < 0 || local >= duration) return null;
  const opacity = Math.min(fadeIn(local, 0, 12), fadeOut(local, duration, 12));
  return <AbsoluteFill style={{ background: bg, opacity, fontFamily: T.font, color: T.text }}>{children}</AbsoluteFill>;
}

export function Caption({ children, delay = 0, style }) {
  return (
    <Pop delay={delay} style={{ position: 'absolute', left: 0, right: 0, bottom: 84, textAlign: 'center', ...style }}>
      <span style={{ display: 'inline-block', background: T.blue, color: '#fff', fontSize: 40, lineHeight: '56px', padding: '10px 34px', fontWeight: 500 }}>{children}</span>
    </Pop>
  );
}

/* ---------- StudOn-Nachbau ---------- */

export function StudOnFrame({ title, children, right }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff' }}>
      <div style={{ height: 64, background: T.blue, color: '#fff', display: 'flex', alignItems: 'center', padding: '0 40px', fontSize: 26, fontWeight: 600, letterSpacing: 1 }}>
        <span style={{ border: '3px solid #fff', padding: '2px 12px', marginRight: 16, fontSize: 22 }}>FAU</span> StudOn
      </div>
      <div style={{ padding: '26px 60px 0', fontSize: 20, color: T.link }}>Magazin › 2.2 Wirtschafts- und Sozialwissenschaften › {title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '22px 60px 0' }}>
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke={T.blue} strokeWidth="1.6"><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" /></svg>
        <div style={{ fontSize: 44, fontWeight: 600, color: T.text2, flex: 1 }}>{title}</div>
        {right}
      </div>
      <div style={{ margin: '18px 60px 0', borderBottom: `3px solid ${T.blue}`, display: 'flex', gap: 0, fontSize: 22 }}>
        {['Inhalt', 'Info', 'Mitglieder', 'Lernfortschritt'].map((t, i) => (
          <div key={t} style={{ padding: '10px 26px', background: i === 0 ? T.blue : 'transparent', color: i === 0 ? '#fff' : T.text2 }}>{t}</div>
        ))}
      </div>
      <div style={{ padding: '22px 60px' }}>{children}</div>
    </div>
  );
}

export function HeaderButton({ children, highlight = false, style }) {
  return (
    <div style={{ background: T.link, color: '#fff', fontSize: 20, lineHeight: '28px', padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: highlight ? `0 0 0 6px rgba(4,49,106,0.25)` : 'none', ...style }}>
      {children}
    </div>
  );
}

export const BookIcon = ({ size = 20, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12V2.5z" /><path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H12" /><path d="M6 5.5h3.5M6 8h3.5" />
  </svg>
);

export function ListRow({ icon, title, props, delay = 0 }) {
  return (
    <Pop delay={delay} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 18px', borderBottom: `1px solid ${T.border}`, fontSize: 24 }}>
      <span style={{ fontSize: 30, width: 44, textAlign: 'center' }}>{icon}</span>
      <span style={{ color: T.link, flex: 1 }}>{title}</span>
      <span style={{ color: T.muted, fontSize: 19 }}>{props}</span>
    </Pop>
  );
}

/* ---------- Dialog-Nachbau (content/content.css) ---------- */

export function Chip({ children, on = true }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '6px 16px 6px 12px', border: `2px solid ${on ? T.blue : '#757575'}`, background: on ? '#e8eef6' : '#fff', color: on ? T.blue : T.text2, fontSize: 22, marginRight: 10, marginBottom: 10 }}>
      <span style={{ width: 20, height: 20, background: on ? T.blue : '#fff', border: `2px solid ${on ? T.blue : '#757575'}`, color: '#fff', fontSize: 14, display: 'grid', placeItems: 'center' }}>{on ? '✓' : ''}</span>
      {children}
    </span>
  );
}

export function Dialog({ title, meta, pressed = false, style }) {
  return (
    <div style={{ width: 720, background: '#fff', border: `1px solid ${T.border}`, borderRadius: 4, boxShadow: '0 16px 50px rgba(0,0,0,0.3)', fontFamily: T.font, ...style }}>
      <div style={{ background: T.panelHead, borderBottom: `1px solid ${T.border}`, padding: '18px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 20, color: T.muted }}><BookIcon size={22} color={T.blue} /> Export nach NotebookLM</div>
        <div style={{ fontSize: 30, fontWeight: 600, color: T.text2, marginTop: 6 }}>{title}</div>
        <div style={{ fontSize: 20, color: T.muted, marginTop: 2 }}>{meta}</div>
      </div>
      <div style={{ padding: '18px 26px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text2, marginBottom: 12 }}>Inhalt</div>
        <Chip>Dateien</Chip><Chip>Lernmodule</Chip><Chip>Übungen &amp; Sitzungen</Chip><Chip>Seiten &amp; Glossare</Chip><Chip>Links &amp; Videos</Chip>
      </div>
      <div style={{ padding: '18px 26px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: T.text2, marginBottom: 12 }}>Notebook</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `3px solid ${T.blue}`, fontSize: 22 }}>
          <div style={{ padding: '8px', background: T.blue, color: '#fff', textAlign: 'center' }}>Neu anlegen</div>
          <div style={{ padding: '8px', textAlign: 'center', color: T.text2 }}>Vorhandenes</div>
        </div>
        <div style={{ border: '1px solid #757575', padding: '8px 14px', fontSize: 22, marginTop: 14 }}>{title}</div>
      </div>
      <div style={{ padding: '20px 26px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, color: T.muted }}><span style={{ width: 12, height: 12, borderRadius: 6, background: T.green }} /> NotebookLM · angemeldet</div>
        <div style={{ background: pressed ? T.blueHover : T.blue, color: '#fff', fontSize: 22, padding: '9px 26px', transform: pressed ? 'scale(0.96)' : 'none' }}>Exportieren</div>
      </div>
    </div>
  );
}

/* ---------- Export-Tab-Nachbau ---------- */

export function ExportTab({ lines, progress, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: T.panelHead }}>
      <div style={{ height: 64, background: T.blue, color: '#fff', display: 'flex', alignItems: 'center', gap: 14, padding: '0 40px', fontSize: 24, fontWeight: 600 }}>
        <BookIcon size={26} /> StudOn → NotebookLM <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 20 }}>Kurs</span> Human Computer Interaction
        <span style={{ marginLeft: 'auto', fontSize: 19, border: '1px solid rgba(255,255,255,0.6)', padding: '2px 12px', background: 'rgba(30,127,58,0.5)' }}>NotebookLM: angemeldet</span>
      </div>
      <div style={{ margin: '40px 60px 0', background: '#fff', border: `1px solid ${T.border}`, borderRadius: 4 }}>
        <div style={{ background: T.panelHead, borderBottom: `1px solid ${T.border}`, padding: '12px 22px', fontSize: 24, fontWeight: 600, color: T.text2, display: 'flex', justifyContent: 'space-between' }}>
          <span>2 · Ziel &amp; Export</span><span style={{ fontWeight: 400, color: T.muted, fontSize: 20 }}>{children}</span>
        </div>
        <div style={{ margin: '18px 22px 0', height: 12, background: '#e8e8e8' }}><div style={{ width: `${progress}%`, height: '100%', background: T.blue }} /></div>
        <div style={{ margin: '16px 22px 22px', background: T.panelHead, border: `1px solid ${T.border}`, padding: '14px 18px', fontFamily: T.mono, fontSize: 21, lineHeight: '34px', color: T.text2, minHeight: 420 }}>
          {lines}
        </div>
      </div>
    </div>
  );
}

/* ---------- NotebookLM-Nachbau ---------- */

export function NotebookMock({ sources, question, answer, typed }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#f7f9fc', display: 'flex' }}>
      <div style={{ width: 520, background: '#fff', borderRight: '1px solid #e3e6ea', padding: 34 }}>
        <div style={{ fontSize: 26, fontWeight: 600, marginBottom: 20 }}>Quellen <span style={{ color: T.muted, fontWeight: 400 }}>· {sources.length}</span></div>
        {sources.map((s, i) => (
          <Pop key={s} delay={i * 4} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', fontSize: 21, borderBottom: '1px solid #f0f2f5' }}>
            <span style={{ width: 22, height: 22, border: '2px solid #5f6368', borderRadius: 4, display: 'grid', placeItems: 'center', fontSize: 14 }}>✓</span>{s}
          </Pop>
        ))}
      </div>
      <div style={{ flex: 1, padding: '48px 80px 190px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 34, fontWeight: 600 }}>Human Computer Interaction (SoSe26)</div>
        <div style={{ marginTop: 'auto' }}>
          {answer && (
            <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 16, padding: '26px 30px', fontSize: 24, lineHeight: '38px', marginBottom: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
              {answer} <span style={{ background: '#e8eef6', color: T.blue, borderRadius: 12, padding: '0 10px', fontSize: 18 }}>1</span> <span style={{ background: '#e8eef6', color: T.blue, borderRadius: 12, padding: '0 10px', fontSize: 18 }}>4</span>
            </div>
          )}
          <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 30, padding: '18px 30px', fontSize: 24, color: typed ? T.text : T.muted, display: 'flex', justifyContent: 'space-between' }}>
            <span>{typed || question}</span><span style={{ color: T.blue }}>➤</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Mauszeiger ---------- */

export function Cursor({ x, y, click = false }) {
  return (
    <svg style={{ position: 'absolute', left: x, top: y, transform: click ? 'scale(0.85)' : 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))' }} width="34" height="40" viewBox="0 0 24 28">
      <path d="M2 2l8 20 3-8 8-3L2 2z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
