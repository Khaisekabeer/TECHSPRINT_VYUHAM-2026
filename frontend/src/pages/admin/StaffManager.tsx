import React, { useCallback, useEffect, useState } from 'react';
import { api, ROLE_LABEL, useStaffSession, type Role } from '../../lib/api';
import { Panel } from '../../components/ui';

interface StaffRow { id: string; username: string; displayName: string; role: Role; active: boolean; hasPin: boolean }

const ROLE_HELP: Record<Role, string> = {
  admin: 'Management: participants (MakeMyPass CSV), staff accounts, check-in, settings, results. Everything except the question bank.',
  quizmaster: 'Writes the questions and answers in the encrypted question bank (opened with a PIN) and loads them into the game.',
  coordinator: 'Conducts the live event from the host console: start, next question, reveal, kick, reset.',
  volunteer: 'Checks in passes at the entry and monitors the live event (who is online, answers in).',
};

export default function StaffManager() {
  const me = useStaffSession();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<StaffRow | null>(null);

  const load = useCallback(() => {
    api<StaffRow[]>('/staff').then(setStaff).catch(err => setError(err.message));
  }, []);
  useEffect(load, [load]);

  const patch = async (s: StaffRow, body: Record<string, unknown>, done?: string) => {
    setError('');
    setSuccess('');
    try {
      await api(`/staff/${s.id}`, { method: 'PATCH', body });
      load();
      if (done) setSuccess(done);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const setPin = (s: StaffRow) => {
    const pin = prompt(`New question-bank PIN for ${s.displayName} (4-8 digits).\n\nThey'll get the question key back the next time another quiz master unlocks the bank, or with the recovery code.`);
    if (pin) patch(s, { pin }, `PIN updated for ${s.displayName}.`);
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
        {success && <p role="status" style={{ padding: '12px 20px', color: 'var(--good)', fontSize: '0.9rem' }}>{success}</p>}
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
                    <button className="btn btn-ghost btn-sm" onClick={() => setPasswordTarget(s)}>Password</button>{' '}
                    {s.role === 'quizmaster' && <><button className="btn btn-ghost btn-sm" onClick={() => setPin(s)}>PIN</button>{' '}</>}
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

      {passwordTarget && (
        <ChangePasswordModal
          target={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onSuccess={(msg) => {
            setSuccess(msg);
            load();
          }}
        />
      )}
    </>
  );
}

function ChangePasswordModal({ target, onClose, onSuccess }: { target: StaffRow; onClose: () => void; onSuccess: (msg: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api(`/staff/${target.id}`, {
        method: 'PATCH',
        body: { currentPassword, password: newPassword },
      });
      onSuccess(`Password updated for ${target.displayName}.`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update password');
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 20,
    }}>
      <Panel style={{ width: '100%', maxWidth: 420, padding: 28, position: 'relative' }}>
        <div className="eyebrow" style={{ color: 'var(--heat)' }}>Admin Verification Required</div>
        <h2 style={{ margin: '8px 0 16px', fontSize: '1.25rem' }}>Change Password</h2>
        <p className="dim" style={{ fontSize: '0.9rem', marginBottom: 20 }}>
          Changing password for <strong>{target.displayName}</strong> (<span className="mono">{target.username}</span>).
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="eyebrow" htmlFor="current-pw">Your Current Admin Password</label>
            <input
              id="current-pw"
              className="field field-sm"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Enter your current password to authorize"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="eyebrow" htmlFor="new-pw">New Password (min 8 chars)</label>
            <input
              id="new-pw"
              className="field field-sm"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="eyebrow" htmlFor="confirm-pw">Confirm New Password</label>
            <input
              id="confirm-pw"
              className="field field-sm"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <p role="alert" className="error-text" style={{ margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-heat btn-sm" disabled={busy}>
              {busy ? 'Updating…' : 'Update Password'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function CreateStaff({ onCreated }: { onCreated: () => void }) {
  const empty = { displayName: '', username: '', role: 'volunteer' as Role, password: '', pin: '' };
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
      if (form.role === 'quizmaster') body.pin = form.pin;
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
          {form.role === 'quizmaster' && (
            <div className="form-row">
              <label className="eyebrow" htmlFor="st-pin">Question-bank PIN</label>
              <input id="st-pin" className="field field-sm" type="password" inputMode="numeric" value={form.pin} onChange={set('pin')}
                required pattern="\d{4,8}" title="4-8 digits" autoComplete="new-password" />
            </div>
          )}
        </div>
        <p className="dim" style={{ fontSize: '0.85rem', margin: '14px 0' }}>{ROLE_HELP[form.role]}</p>
        <button type="submit" className="btn btn-heat" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        {message && <p role="status" style={{ margin: '12px 0 0', fontSize: '0.88rem', color: message.ok ? 'var(--good)' : 'var(--bad)' }}>{message.text}</p>}
      </form>
    </Panel>
  );
}
