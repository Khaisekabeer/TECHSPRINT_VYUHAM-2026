import React, { useCallback, useEffect, useState } from 'react';
import { api, ROLE_LABEL, useStaffSession, type Role } from '../../lib/api';
import { Panel } from '../../components/ui';

interface StaffRow { id: string; username: string; displayName: string; role: Role; active: boolean; hasPin: boolean }

const ROLE_HELP: Record<Role, string> = {
  admin: 'Management: participants (MakeMyPass CSV), staff accounts, check-in, settings, results. Everything except the question bank.',
  quizmaster: 'Builds the question sets (e.g. Main set, Trial set). Each set is encrypted and has its own PIN, chosen by the quiz master.',
  coordinator: 'Conducts the live event from the host console: loads a question set with its PIN, then start, next question, reveal, disqualify, reset.',
  volunteer: 'Checks in passes at the entry and monitors the live event (who is online, answers in).',
};

export default function StaffManager() {
  const me = useStaffSession();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<StaffRow[]>('/staff').then(setStaff).catch(err => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const patch = async (s: StaffRow, body: Record<string, unknown>, done?: string) => {
    setError('');
    try {
      await api(`/staff/${s.id}`, { method: 'PATCH', body });
      load();
      if (done) alert(done);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const resetPassword = (s: StaffRow) => {
    const password = prompt(`New password for ${s.displayName} (at least 8 characters):`);
    if (password) patch(s, { password }, `Password updated for ${s.displayName}.`);
  };
  const toggleActive = (s: StaffRow) => {
    if (s.active && !confirm(`Deactivate ${s.displayName}? They will be signed out immediately.`)) return;
    patch(s, { active: !s.active });
  };

  return (
    <>
      <CreateStaff onCreated={load} />
      <Panel style={{ padding: 0 }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)' }} className="eyebrow">Staff accounts · {staff.length}</div>
        {error && <p role="alert" className="error-text" style={{ padding: '12px 20px' }}>{error}</p>}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td><strong>{s.displayName}</strong>{s.id === me?.staff.id && <span className="dim" style={{ fontSize: '0.8rem' }}> (you)</span>}</td>
                  <td className="mono" style={{ fontSize: '0.82rem' }}>{s.username}</td>
                  <td><span className={`pill${s.role === 'admin' ? ' pill-dark' : ''}`}>{ROLE_LABEL[s.role]}</span></td>
                  <td>{s.active ? <span className="pill pill-good">Active</span> : <span className="pill pill-bad">Disabled</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(s)}>Password</button>{' '}
                    {s.id !== me?.staff.id && (
                      <button className={`btn btn-sm ${s.active ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggleActive(s)}>
                        {s.active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function CreateStaff({ onCreated }: { onCreated: () => void }) {
  const empty = { displayName: '', username: '', role: 'volunteer' as Role, password: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, string> = { displayName: form.displayName, username: form.username, role: form.role, password: form.password };
      await api('/staff', { method: 'POST', body });
      setMessage({ ok: true, text: `Created ${ROLE_LABEL[form.role].toLowerCase()} "${form.username}". Share the username and password with them privately.` });
      setForm(empty);
      onCreated();
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="eyebrow">Add staff</div>
      <h2 style={{ margin: '8px 0 16px', fontSize: '1.2rem' }}>Create an account</h2>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="form-row">
            <label className="eyebrow" htmlFor="st-name">Full name</label>
            <input id="st-name" className="field field-sm" value={form.displayName} onChange={set('displayName')} required maxLength={60} />
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="st-user">Username or email</label>
            <input id="st-user" className="field field-sm" value={form.username} onChange={set('username')} required
              pattern="[a-zA-Z0-9._@+\-]{3,64}" title="An email address, or 3-64 letters, numbers, dot, dash or underscore" autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="st-role">Role</label>
            <select id="st-role" className="field field-sm" value={form.role} onChange={set('role')}>
              {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="st-pass">Password</label>
            <input id="st-pass" className="field field-sm" type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
          </div>
        </div>
        <p className="dim" style={{ fontSize: '0.85rem', margin: '14px 0' }}>{ROLE_HELP[form.role]}</p>
        <button type="submit" className="btn btn-heat" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        {message && <p role="status" style={{ margin: '12px 0 0', fontSize: '0.88rem', color: message.ok ? 'var(--good)' : 'var(--bad)' }}>{message.text}</p>}
      </form>
    </Panel>
  );
}
