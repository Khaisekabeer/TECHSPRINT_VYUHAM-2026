import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { guessColumns, parseCsv, type Field } from '../../lib/csv';
import { Panel } from '../../components/ui';
import { fmtTime } from './Overview';

interface Registration {
  ticketId: string; name: string; email: string | null; phone: string | null; college: string | null;
  checkedInAt: string | null; checkedInBy: string | null;
}

const FIELDS: { id: Field; label: string; required?: boolean }[] = [
  { id: 'ticketId', label: 'Ticket ID', required: true },
  { id: 'name', label: 'Name', required: true },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'college', label: 'College' },
];
const PAGE = 50;

export default function Participants() {
  return (
    <>
      <Importer />
      <ParticipantList />
    </>
  );
}

// ─── CSV import ───────────────────────────────────────────────────────────────
function Importer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<Field, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const onFile = async (file: File | undefined) => {
    setMessage(null);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setMessage({ ok: false, text: 'Excel files: open in Excel / Google Sheets and use File → Save as / Download → CSV, then upload the .csv.' });
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setMessage({ ok: false, text: 'That file has no data rows.' });
      return;
    }
    setFileName(file.name);
    setHeaders(parsed[0]);
    setRows(parsed.slice(1));
    setMapping(guessColumns(parsed[0]));
  };

  const reset = () => {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const mapped = (row: string[]) => {
    const get = (f: Field) => (mapping && mapping[f] >= 0 ? (row[mapping[f]] ?? '').trim() : '');
    const used = new Set(Object.values(mapping || {}));
    const extra: Record<string, string> = {};
    headers.forEach((h, i) => { if (!used.has(i) && row[i]?.trim()) extra[h.trim() || `Column ${i + 1}`] = row[i].trim(); });
    return { ticketId: get('ticketId'), name: get('name'), email: get('email'), phone: get('phone'), college: get('college'), extra };
  };

  const doImport = async () => {
    if (!mapping || mapping.ticketId < 0 || mapping.name < 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api('/registrations/import', { method: 'POST', body: { rows: rows.map(mapped) } });
      setMessage({ ok: true, text: `Imported ${res.imported} participants${res.skipped ? ` · skipped ${res.skipped} rows without a ticket ID or name` : ''}${res.duplicates ? ` · ${res.duplicates} duplicate ticket IDs merged` : ''}.` });
      reset();
      window.dispatchEvent(new Event('techsprint-participants-changed'));
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="eyebrow">Import participants</div>
      <h2 style={{ margin: '8px 0 6px', fontSize: '1.2rem' }}>Upload the registration CSV</h2>
      <p className="dim" style={{ margin: '0 0 16px', fontSize: '0.88rem', lineHeight: 1.5 }}>
        Export the attendee list from your ticketing platform as CSV. Re-importing updates details and never clears check-ins.
      </p>

      {!mapping ? (
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          Choose CSV file…
          <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,.xls" hidden onChange={e => onFile(e.target.files?.[0])} />
        </label>
      ) : (
        <>
          <p style={{ margin: '0 0 14px', fontSize: '0.9rem' }}>
            <strong>{fileName}</strong> <span className="dim">· {rows.length} rows · match the columns:</span>
          </p>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            {FIELDS.map(f => (
              <div key={f.id} className="form-row">
                <label className="eyebrow" htmlFor={`map-${f.id}`}>{f.label}{f.required && ' *'}</label>
                <select id={`map-${f.id}`} className="field field-sm" value={mapping[f.id]}
                  onChange={e => setMapping({ ...mapping, [f.id]: Number(e.target.value) })}>
                  <option value={-1}>{f.required ? '— choose —' : '— none —'}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="table-wrap panel" style={{ boxShadow: 'none', marginBottom: 16 }}>
            <table className="table">
              <thead><tr>{FIELDS.map(f => <th key={f.id}>{f.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 3).map((r, i) => {
                  const m = mapped(r);
                  return <tr key={i}>{FIELDS.map(f => <td key={f.id} className={f.id === 'ticketId' ? 'mono' : ''}>{(m as any)[f.id] || <span className="faint">—</span>}</td>)}</tr>;
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-heat" onClick={doImport} disabled={busy || mapping.ticketId < 0 || mapping.name < 0}>
              {busy ? 'Importing…' : `Import ${rows.length} participants`}
            </button>
            <button className="btn btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </>
      )}
      {message && <p role="status" style={{ margin: '14px 0 0', fontSize: '0.88rem', color: message.ok ? 'var(--good)' : 'var(--bad)' }}>{message.text}</p>}
    </Panel>
  );
}

// ─── Search & list ────────────────────────────────────────────────────────────
function ParticipantList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'in' | 'out'>('all');
  const [rows, setRows] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError('');
    try {
      const res = await api(`/registrations?q=${encodeURIComponent(q)}&status=${status}&limit=${PAGE}&offset=${offset}`);
      setRows(prev => (offset ? [...prev, ...res.rows] : res.rows));
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    const id = setTimeout(() => load(0), 250); // debounce typing
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    const onChange = () => load(0);
    window.addEventListener('techsprint-participants-changed', onChange);
    return () => window.removeEventListener('techsprint-participants-changed', onChange);
  }, [load]);

  const undo = async (r: Registration) => {
    if (!confirm(`Undo check-in for ${r.name} (${r.ticketId})? They will need to be scanned again.`)) return;
    try {
      const updated = await api<Registration>(`/registrations/${encodeURIComponent(r.ticketId)}/undo`, { method: 'POST' });
      setRows(prev => prev.map(x => (x.ticketId === r.ticketId ? updated : x)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <Panel style={{ padding: 0 }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 240px' }}>
          <input className="field field-sm" type="search" placeholder="Search name, ticket ID, email, college…" value={q}
            onChange={e => setQ(e.target.value)} aria-label="Search participants" />
        </div>
        <div className="tabs" role="group" aria-label="Filter by check-in">
          {([['all', 'All'], ['in', 'Checked in'], ['out', 'Not yet']] as const).map(([id, label]) => (
            <button key={id} className={`tab${status === id ? ' active' : ''}`} onClick={() => setStatus(id)}>{label}</button>
          ))}
        </div>
        <span className="mono dim" style={{ fontSize: '0.8rem' }}>{total} found</span>
      </div>

      {error && <p role="alert" className="error-text" style={{ padding: '12px 20px' }}>{error}</p>}

      {rows.length === 0 && !loading ? (
        <p className="dim" style={{ padding: '32px 20px', margin: 0, textAlign: 'center' }}>
          {q || status !== 'all' ? 'No matching participants' : 'No participants yet — import the registration CSV above.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Ticket</th><th>College</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ticketId}>
                  <td><strong>{r.name}</strong>{r.email && <div className="dim" style={{ fontSize: '0.8rem' }}>{r.email}</div>}</td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>{r.ticketId}</td>
                  <td className="dim">{r.college ?? '—'}</td>
                  <td>
                    {r.checkedInAt
                      ? <span className="pill pill-good" title={r.checkedInBy ? `by ${r.checkedInBy}` : undefined}>In · {fmtTime(r.checkedInAt)}</span>
                      : <span className="pill">Not yet</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.checkedInAt && <button className="btn btn-ghost btn-sm" onClick={() => undo(r)}>Undo</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length < total && (
        <div style={{ padding: 16, textAlign: 'center', borderTop: '1px solid var(--line)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => load(rows.length)} disabled={loading}>
            {loading ? 'Loading…' : `Load more (${total - rows.length} left)`}
          </button>
        </div>
      )}
    </Panel>
  );
}
