import type { CSSProperties, ReactNode } from 'react';

export const OPTION_LABELS = ['A', 'B', 'C', 'D'];

// Chakravyuha mark: three broken concentric rings, each opening offset like a formation's gate.
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="56 10" transform="rotate(-60 12 12)" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="33 8" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function Brand({ size }: { size?: string }) {
  return (
    <span className="brand" style={size ? { fontSize: size } : undefined}>
      <BrandMark />
      Vyuham <span className="brand-year">'26</span>
    </span>
  );
}

// Slowly rotating concentric rings: the backdrop motif.
export function Rings({ size = 640, style }: { size?: number | string; style?: CSSProperties }) {
  return (
    <svg className="rings" viewBox="0 0 400 400" style={{ width: size, ...style }} aria-hidden="true">
      <g className="r-spin">
        <circle cx="200" cy="200" r="196" strokeWidth="1" strokeDasharray="2 10" opacity="0.5" />
        <circle cx="200" cy="200" r="150" strokeWidth="1.2" strokeDasharray="700 242" opacity="0.35" />
      </g>
      <g className="r-spin-rev">
        <circle cx="200" cy="200" r="172" strokeWidth="0.8" opacity="0.18" />
        <circle cx="200" cy="200" r="112" strokeWidth="1.2" strokeDasharray="520 184" opacity="0.4" />
        <circle cx="200" cy="200" r="74" strokeWidth="0.8" strokeDasharray="1 6" opacity="0.6" />
      </g>
      <circle className="r-pulse" cx="200" cy="200" r="40" strokeWidth="1.5" />
      <circle cx="200" cy="200" r="4" fill="currentColor" stroke="none" opacity="0.8" />
    </svg>
  );
}

export function TimerRing({ value, max, size = 56, stroke = 3, fontSize }: {
  value: number; max: number; size?: number; stroke?: number; fontSize?: string;
}) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(1, value / max));
  const urgent = value <= 5;
  return (
    <div className={`timer${urgent ? ' urgent' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={`${value} seconds left`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="bar" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} strokeLinecap="butt"
        />
      </svg>
      <span className="count" style={{ fontSize: fontSize ?? `${size * 0.42}px` }}>{value}</span>
    </div>
  );
}

export function Toast({ msg }: { msg: string }) {
  return <div className="toast" role="status">{msg}</div>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="stage stage-grid" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Rings size="min(90vw, 520px)" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <BrandMark className="brand-mark brand-mark-lg" />
      <p className="eyebrow" style={{ marginTop: 18 }}>{label}</p>
    </div>
  );
}

// Staggered entrance helper: <Rise d={120}>…</Rise>
export function Rise({ d = 0, as: Tag = 'div', className = '', style, children }: {
  d?: number; as?: 'div' | 'span' | 'p' | 'h1' | 'h2'; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  return <Tag className={`rise ${className}`} style={{ ...style, ['--d' as string]: `${d}ms` }}>{children}</Tag>;
}
