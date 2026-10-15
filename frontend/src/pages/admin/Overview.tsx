import { useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { Panel } from '../../components/ui';

interface Recent { id: number; action: 'admit' | 'undo'; at: string; ticketId: string; name: string; college: string | null; by: string | null }

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function Overview() {
  const [stats, setStats] = useState<{ total: number; checkedIn: number } | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [requireCheckin, setRequireCheckin] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api('/checkin/stats'), api<Recent[]>('/checkin/recent')]);
      setStats(s);
      setRecent(r);
    } catch (err: any) {
      setMessage(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    api('/settings').then(s => setRequireCheckin(s.requireCheckin)).catch(err => setMessage(err.message));
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const toggleCheckin = async (next: boolean) => {
    if (!next && !confirm('Let anyone join the quiz with just a name (no ticket check)?')) return;
    try {
      const s = await api('/settings', { method: 'PUT', body: { requireCheckin: next } });
      setRequireCheckin(s.requireCheckin);
    } catch (err: any) {
      setMessage(err.message);
    }
  };

  const download = async () => {
    try { await downloadFile('/results/latest.csv', 'techsprint-results.csv'); } catch (err: any) { setMessage(err.message); }
  };

  const pct = stats && stats.total ? Math.round((stats.checkedIn / stats.total) * 100) : 0;

  return (
    <>
      {message && <p role="alert" className="error-text" style={{ textAlign: 'left' }}>{message}</p>}

      <div className="grid-stats">
        <Panel><div className="eyebrow">Registered</div><div className="stat-value">{stats?.total ?? '—'}</div></Panel>
        <Panel><div className="eyebrow">Checked in</div><div className="stat-value">{stats?.checkedIn ?? '—'}</div></Panel>
        <Panel><div className="eyebrow">Still to arrive</div><div className="stat-value">{stats ? stats.total - stats.checkedIn : '—'}</div></Panel>
        <Panel>
          <div className="eyebrow">Arrival</div>
          <div className="stat-value">{stats ? `${pct}%` : '—'}</div>
          <div className="meter" style={{ marginTop: 12 }}><span style={{ width: `${pct}%` }} /></div>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div className="eyebrow">Quiz entry</div>
              <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>Require check-in to play</h3>
            </div>
            <label className="switch" aria-label="Require check-in to play">
              <input type="checkbox" checked={!!requireCheckin} disabled={requireCheckin === null} onChange={e => toggleCheckin(e.target.checked)} />
              <span />
            </label>
          </div>
          <p className="dim" style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5 }}>
            {requireCheckin === false
              ? 'Off — anyone can join with a display name. Use only as a fallback if scanning is down.'
              : 'On — players join with the ticket ID on their pass, and only admitted tickets can play.'}
          </p>
        </Panel>

        <Panel>
          <div className="eyebrow">Results</div>
          <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>Latest game standings</h3>
          <p className="dim" style={{ margin: '0 0 16px', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Ranks, scores, ticket IDs and registration details as a spreadsheet.
          </p>
          <button className="btn btn-ghost" onClick={download}>Download CSV ↓</button>
        </Panel>
      </div>

      <Panel style={{ padding: 0 }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="eyebrow">Recent check-ins</div>
          <button className="btn btn-ghost btn-sm" onClick={refresh}>Refresh</button>
        </div>
        {recent.length === 0 ? (
          <p className="dim" style={{ padding: '28px 20px', margin: 0, textAlign: 'center' }}>No check-ins yet</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Participant</th><th>Ticket</th><th>By</th><th /></tr></thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: '0.8rem' }}>{fmtTime(r.at)}</td>
                    <td><strong>{r.name}</strong>{r.college && <div className="dim" style={{ fontSize: '0.8rem' }}>{r.college}</div>}</td>
                    <td className="mono" style={{ fontSize: '0.8rem' }}>{r.ticketId}</td>
                    <td>{r.by ?? '—'}</td>
                    <td>{r.action === 'admit' ? <span className="pill pill-good">Admitted</span> : <span className="pill pill-warn">Undone</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
