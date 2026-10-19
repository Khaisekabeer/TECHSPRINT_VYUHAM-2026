import React, { useState } from 'react';
import { api, session, type StaffSession } from '../lib/api';
import { Brand, Rings, Rise } from './ui';

// Shared sign-in for all staff roles (admin panel and host console).
export default function StaffLogin({ title = 'Staff', accent = 'Sign in', note }: { title?: string; accent?: string; note?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      session.set(await api<StaffSession>('/auth/login', { method: 'POST', body: { username: username.trim(), password } }));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="stage stage-grid" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <Rings size="min(140vw, 820px)" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <Rise className="panel panel-lg bracketed" style={{ width: '100%', maxWidth: 400, padding: '36px 32px' }}>
        <Brand />
        <h1 className="display" style={{ fontSize: '3.2rem', margin: '26px 0 6px' }}>{title}<br />{accent}</h1>
        <p className="dim" style={{ margin: '0 0 26px', fontSize: '0.95rem' }}>{note ?? 'Coordinators, quiz masters and volunteers.'}</p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label htmlFor="staff-username" className="eyebrow">Username or email</label>
          <input id="staff-username" className="field" value={username} onChange={e => setUsername(e.target.value)}
            autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          <label htmlFor="staff-password" className="eyebrow">Password</label>
          <input id="staff-password" className="field" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" required />
          <button type="submit" className="btn btn-heat btn-block" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? 'Signing in…' : 'Sign in →'}
          </button>
          {error && <p role="alert" className="error-text">{error}</p>}
        </form>
      </Rise>
    </div>
  );
}
