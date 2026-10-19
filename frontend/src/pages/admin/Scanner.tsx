import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { api, ApiError } from '../../lib/api';
import { Panel } from '../../components/ui';
import { fmtTime } from './Overview';

interface Registration {
  ticketId: string; name: string; email: string | null; phone: string | null; college: string | null;
  checkedInAt: string | null; checkedInBy: string | null;
}
type Result =
  | { kind: 'found' | 'admitted' | 'already'; reg: Registration }
  | { kind: 'notfound'; ticketId: string }
  | { kind: 'error'; message: string };

interface Recent { id: number; action: string; at: string; ticketId: string; name: string }

const REGION_ID = 'pass-scanner-region';
const buzz = (pattern: number | number[]) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

export default function Scanner() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [admitting, setAdmitting] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const secure = window.isSecureContext;

  const loadRecent = useCallback(() => {
    api<Recent[]>('/checkin/recent?mine=1').then(setRecent).catch(() => {});
  }, []);
  useEffect(loadRecent, [loadRecent]);

  const lookup = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busyRef.current) return;
    busyRef.current = true;
    try {
      const reg = await api<Registration>(`/checkin/${encodeURIComponent(text)}`);
      setResult({ kind: reg.checkedInAt ? 'already' : 'found', reg });
      buzz(reg.checkedInAt ? [60, 60, 60] : 80);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setResult({ kind: 'notfound', ticketId: err.data?.ticketId || text.toUpperCase() });
        buzz([200, 80, 200]);
      } else {
        setResult({ kind: 'error', message: (err as Error).message });
      }
    }
  }, []);

  const stopCamera = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    setCameraOn(false);
    if (s) {
      try { await s.stop(); } catch { /* already stopped */ }
      try { s.clear(); } catch { /* ignore */ }
    }
  }, []);

  const startCamera = async () => {
    setCameraError('');
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(REGION_ID, {
        verbose: false,
        formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.EAN_13, F.DATA_MATRIX, F.PDF_417],
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w: number, h: number) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; } },
        decoded => { lookup(decoded); },
        () => { /* no code in this frame */ },
      );
      setCameraOn(true);
    } catch (err: any) {
      scannerRef.current = null;
      const msg = String(err?.message || err);
      setCameraError(/permission|notallowed/i.test(msg)
        ? 'Camera permission was denied. Allow camera access in the browser settings, or type the ticket ID below.'
        : `Could not start the camera (${msg}). Type the ticket ID below instead.`);
    }
  };

  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const next = () => {
    setResult(null);
    busyRef.current = false;
  };

  const admit = async () => {
    if (result?.kind !== 'found') return;
    setAdmitting(true);
    try {
      const res = await api(`/checkin/${encodeURIComponent(result.reg.ticketId)}`, { method: 'POST' });
      setResult({ kind: 'admitted', reg: res.registration });
      buzz([40, 40, 120]);
      loadRecent();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setResult({ kind: 'already', reg: err.data.registration });
      else setResult({ kind: 'error', message: (err as Error).message });
    } finally {
      setAdmitting(false);
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    busyRef.current = false;
    lookup(manual);
    setManual('');
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <Panel>
        <div className="eyebrow">Scan pass</div>
        <h2 className="display" style={{ fontSize: '2.2rem', margin: '10px 0 16px' }}>Entry check-in</h2>

        <div className="scan-box">
          <div id={REGION_ID} style={{ width: '100%', height: '100%' }} />
          {!cameraOn && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
              {secure ? (
                <>
                  <button className="btn btn-heat btn-lg" onClick={startCamera}>Start camera</button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>Point at the QR code on the pass</span>
                </>
              ) : (
                <span className="dim" style={{ fontSize: '0.88rem', lineHeight: 1.5 }}>
                  The camera only works on a secure (https://) address.<br />Type the ticket ID below, or ask the coordinator for the HTTPS link.
                </span>
              )}
            </div>
          )}
        </div>
        {cameraOn && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={stopCamera}>Stop camera</button>
          </div>
        )}
        {cameraError && <p role="alert" className="error-text" style={{ marginTop: 12 }}>{cameraError}</p>}

        <form onSubmit={submitManual} style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <input className="field" value={manual} onChange={e => setManual(e.target.value)} placeholder="Type ticket ID"
            aria-label="Ticket ID" autoCapitalize="characters" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }} />
          <button type="submit" className="btn btn-ghost" disabled={!manual.trim()}>Check</button>
        </form>
      </Panel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <ResultCard result={result} admitting={admitting} onAdmit={admit} onNext={next} />

        <Panel style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)' }} className="eyebrow">My recent check-ins</div>
          {recent.length === 0 ? (
            <p className="dim" style={{ padding: '22px 20px', margin: 0, textAlign: 'center', fontSize: '0.9rem' }}>None yet</p>
          ) : recent.slice(0, 8).map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid var(--line)' }}>
              <span className="mono faint" style={{ fontSize: '0.75rem', width: 44 }}>{fmtTime(r.at)}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span className="mono dim" style={{ fontSize: '0.72rem' }}>{r.ticketId}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function ResultCard({ result, admitting, onAdmit, onNext }: {
  result: Result | null; admitting: boolean; onAdmit: () => void; onNext: () => void;
}) {
  if (!result) {
    return (
      <Panel style={{ textAlign: 'center', padding: '40px 24px' }}>
        <div className="eyebrow">Waiting for a pass</div>
        <p className="dim" style={{ margin: '10px 0 0', fontSize: '0.9rem' }}>Scan a QR code or type a ticket ID.</p>
      </Panel>
    );
  }

  if (result.kind === 'notfound' || result.kind === 'error') {
    return (
      <Panel className="result-card result-bad" style={{ textAlign: 'center', padding: '30px 24px' }}>
        <div className="display" style={{ fontSize: '3rem', color: 'var(--bad)' }}>✕</div>
        <h3 className="display" style={{ fontSize: '2rem', margin: '6px 0', color: 'var(--bad)' }}>
          {result.kind === 'notfound' ? 'Not registered' : 'Check failed'}
        </h3>
        <p className="dim" style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>
          {result.kind === 'notfound' ? <>No participant with ticket <span className="mono">{result.ticketId}</span>. Send them to the help desk.</> : result.message}
        </p>
        <button className="btn btn-heat btn-block" onClick={onNext}>Scan next</button>
      </Panel>
    );
  }

  const { reg } = result;
  const tone = result.kind === 'already' ? 'result-warn' : 'result-good';
  return (
    <Panel className={`result-card ${tone}`} style={{ padding: '24px' }}>
      {result.kind === 'found' && <span className="pill pill-dark">Registered · not checked in</span>}
      {result.kind === 'admitted' && <span className="pill pill-good">✓ Admitted</span>}
      {result.kind === 'already' && <span className="pill pill-warn">Already checked in</span>}

      <h3 style={{ fontSize: '1.6rem', fontWeight: 700, margin: '14px 0 4px', letterSpacing: '-0.02em' }}>{reg.name}</h3>
      <div className="mono dim" style={{ fontSize: '0.85rem' }}>{reg.ticketId}</div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: '16px 0 0', fontSize: '0.9rem' }}>
        {reg.college && <><dt className="eyebrow" style={{ alignSelf: 'center' }}>College</dt><dd style={{ margin: 0 }}>{reg.college}</dd></>}
        {reg.email && <><dt className="eyebrow" style={{ alignSelf: 'center' }}>Email</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{reg.email}</dd></>}
        {reg.phone && <><dt className="eyebrow" style={{ alignSelf: 'center' }}>Phone</dt><dd style={{ margin: 0 }}>{reg.phone}</dd></>}
      </dl>

      {result.kind === 'already' && reg.checkedInAt && (
        <p style={{ margin: '16px 0 0', fontSize: '0.9rem', color: '#8a5a00' }}>
          Checked in at {fmtTime(reg.checkedInAt)}{reg.checkedInBy ? ` by ${reg.checkedInBy}` : ''}. Possible duplicate pass — verify ID.
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        {result.kind === 'found' ? (
          <>
            <button className="btn btn-heat btn-lg" style={{ flex: 1 }} onClick={onAdmit} disabled={admitting}>
              {admitting ? 'Admitting…' : 'Admit ✓'}
            </button>
            <button className="btn btn-ghost btn-lg" onClick={onNext} disabled={admitting}>Cancel</button>
          </>
        ) : (
          <button className="btn btn-heat btn-lg btn-block" onClick={onNext}>Scan next</button>
        )}
      </div>
    </Panel>
  );
}
