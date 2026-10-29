import React, { useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../../lib/api';
import { Panel } from '../../components/ui';

interface Recent { id: number; action: 'admit' | 'undo'; at: string; ticketId: string; name: string; college: string | null; by: string | null }

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface GameStatus { online?: boolean; error?: string; state?: string; count?: number; by?: string; players?: number }

// Where the live game runs on event day (laptop behind Cloudflare Tunnel) and whether it's up.
function GameServerPanel() {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshStatus = useCallback(() => {
    api<GameStatus>('/game/status').then(setStatus).catch(err => setStatus({ online: false, error: err.message }));
  }, []);

  useEffect(() => {
    api('/settings').then(s => { setUrl(s.gameServerUrl); setSaved(s.gameServerUrl); }).catch(() => {});
    refreshStatus();
    const id = setInterval(refreshStatus, 15000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const s = await api('/settings', { method: 'PUT', body: { gameServerUrl: url.trim() } });
      setUrl(s.gameServerUrl);
      setSaved(s.gameServerUrl);
      setMessage({ ok: true, text: 'Saved. Pages opened from now on connect to this address (refresh open pages).' });
      refreshStatus();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const online = status?.online !== false && !status?.error;
  return (
    <Panel bracketed>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Live game server</div>
          <h3 style={{ margin: '8px 0 4px', fontSize: '1.1rem' }}>Event-day laptop address</h3>
          <p className="dim" style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, maxWidth: 560 }}>
            The HTTPS address of the laptop running <span className="mono">npm run game</span> behind Cloudflare Tunnel,
            e.g. <span className="mono">https://game.yourdomain.com</span>. Leave empty when everything runs on one server.
          </p>
        </div>
        {status && (
          online
            ? <span className="pill pill-good">● Online · {status.state} · {status.count ?? 0} questions · {status.players ?? 0} players</span>
            : <span className="pill pill-bad" title={status.error}>● Offline</span>
        )}
      </div>
      <form onSubmit={save} style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <input className="field field-sm" style={{ flex: '1 1 320px', fontFamily: 'var(--font-mono)' }} value={url}
          onChange={e => setUrl(e.target.value)} placeholder="https://game.yourdomain.com" aria-label="Game server address"
          autoCapitalize="none" spellCheck={false} />
        <button className="btn btn-heat btn-sm" disabled={busy || url.trim() === saved}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refreshStatus}>Check</button>
      </form>
      {status?.error && <p className="dim" style={{ margin: '10px 0 0', fontSize: '0.82rem' }}>{status.error}</p>}
      {message && <p role="status" style={{ margin: '10px 0 0', fontSize: '0.85rem', color: message.ok ? 'var(--good)' : 'var(--bad)' }}>{message.text}</p>}
      <p className="dim" style={{ margin: '12px 0 0', fontSize: '0.82rem' }}>
        Players join at <span className="mono">{window.location.host}{import.meta.env.BASE_URL.replace(/\/$/, '')}</span> — the QR code on the projector points there.
      </p>
    </Panel>
  );
}

interface GameRow { id: string; status: string; startedAt: string; players: number }

export default function Overview() {
  const [stats, setStats] = useState<{ total: number; checkedIn: number } | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [requireCheckin, setRequireCheckin] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  // Games to export: the default is the latest finished one, not a reset or test run.
  const [games, setGames] = useState<GameRow[]>([]);
  const [gameId, setGameId] = useState('');

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
    api<GameRow[]>('/results/games').then(setGames).catch(() => {});
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
    const path = gameId ? `/results/latest.csv?game=${encodeURIComponent(gameId)}` : '/results/latest.csv';
    try { await downloadFile(path, 'techsprint-results.csv'); } catch (err: any) { setMessage(err.message); }
  };
  // Every candidate's actions in that game: joins, reconnects, answers, screen switches, eliminations.
  const downloadLog = async () => {
    const path = gameId ? `/results/activity.csv?game=${encodeURIComponent(gameId)}` : '/results/activity.csv';
    try { await downloadFile(path, 'techsprint-activity-log.csv'); } catch (err: any) { setMessage(err.message); }
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

      <GameServerPanel />

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
          <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>Game standings</h3>
          <p className="dim" style={{ margin: '0 0 16px', fontSize: '0.88rem', lineHeight: 1.5 }}>
            Results: ranks, finalists / eliminated / disqualified, scores and registration details. Activity log: everything each candidate did, in time order.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select className="field field-sm" value={gameId} onChange={e => setGameId(e.target.value)} aria-label="Game to export" style={{ flex: '1 1 220px' }}>
              <option value="">Latest finished game</option>
              {games.map(g => (
                <option key={g.id} value={g.id}>
                  {new Date(g.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {g.players} players{g.status === 'finished' ? '' : ' · not finished'}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" onClick={download}>Results CSV ↓</button>
            <button className="btn btn-ghost" onClick={downloadLog}>Activity log ↓</button>
          </div>
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
