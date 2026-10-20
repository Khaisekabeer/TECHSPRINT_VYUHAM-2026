import React, { useState } from 'react';
import { api, session, type StaffSession } from '../lib/api';
import { Brand, Rings, Rise } from './ui';

// Shared sign-in and password recovery for all staff roles (admin panel and host console).
export default function StaffLogin({ title = 'Staff', accent = 'Sign in', note }: { title?: string; accent?: string; note?: string }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgotStep, setForgotStep] = useState<'request' | 'verify'>('request');

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Status state
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      session.set(await api<StaffSession>('/auth/login', { method: 'POST', body: { username: username.trim(), password } }));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api<{ success: boolean; email?: string; message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email: forgotEmail.trim() },
      });
      setNotice(res.message || 'Verification code sent to your email.');
      setForgotStep('verify');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
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
      const res = await api<{ success: boolean; message: string }>('/auth/reset-password', {
        method: 'POST',
        body: { email: forgotEmail.trim(), otp: otp.trim(), newPassword },
      });
      setNotice(res.message || 'Password reset successfully! Please sign in.');
      setUsername(forgotEmail);
      setPassword('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setMode('login');
      setForgotStep('request');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stage stage-grid" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <Rings size="min(140vw, 820px)" style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
      <Rise className="panel panel-lg bracketed" style={{ width: '100%', maxWidth: 420, padding: '36px 32px' }}>
        <Brand />

        {mode === 'login' ? (
          <>
            <h1 className="display" style={{ fontSize: '3.2rem', margin: '26px 0 6px' }}>{title}<br />{accent}</h1>
            <p className="dim" style={{ margin: '0 0 26px', fontSize: '0.95rem' }}>{note ?? 'Coordinators, quiz masters and volunteers.'}</p>

            {notice && <p role="status" style={{ color: 'var(--good)', fontSize: '0.9rem', marginBottom: 16 }}>{notice}</p>}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label htmlFor="staff-username" className="eyebrow">Username or email</label>
              <input id="staff-username" className="field" value={username} onChange={e => setUsername(e.target.value)}
                autoComplete="username" autoCapitalize="none" spellCheck={false} required />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="staff-password" className="eyebrow" style={{ margin: 0 }}>Password</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--heat)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
                  onClick={() => {
                    setMode('forgot');
                    setForgotStep('request');
                    setForgotEmail(username);
                    setError('');
                    setNotice('');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <input id="staff-password" className="field" type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" required />

              <button type="submit" className="btn btn-heat btn-block" disabled={busy} style={{ marginTop: 6 }}>
                {busy ? 'Signing in…' : 'Sign in →'}
              </button>
              {error && <p role="alert" className="error-text">{error}</p>}
            </form>
          </>
        ) : (
          <>
            <h1 className="display" style={{ fontSize: '2.4rem', margin: '26px 0 6px' }}>Reset<br />Password</h1>
            <p className="dim" style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>
              {forgotStep === 'request'
                ? 'Enter your registered email address or username to receive a 6-digit verification code.'
                : 'Enter the verification code sent to your email and create a new password.'}
            </p>

            {notice && <p role="status" style={{ color: 'var(--good)', fontSize: '0.88rem', marginBottom: 14 }}>{notice}</p>}

            {forgotStep === 'request' ? (
              <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label htmlFor="forgot-email" className="eyebrow">Registered Email or Username</label>
                <input
                  id="forgot-email"
                  className="field"
                  type="text"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="e.g. name@duk.ac.in"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  autoFocus
                />

                <button type="submit" className="btn btn-heat btn-block" disabled={busy} style={{ marginTop: 6 }}>
                  {busy ? 'Sending code…' : 'Send Reset Code →'}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    setMode('login');
                    setError('');
                    setNotice('');
                  }}
                  disabled={busy}
                >
                  ← Back to Sign in
                </button>

                {error && <p role="alert" className="error-text">{error}</p>}
              </form>
            ) : (
              <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label htmlFor="reset-otp" className="eyebrow">6-Digit Verification Code</label>
                <input
                  id="reset-otp"
                  className="field mono"
                  type="text"
                  inputMode="numeric"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  style={{ letterSpacing: '6px', textAlign: 'center', fontSize: '1.4rem' }}
                  maxLength={6}
                  required
                  autoFocus
                />

                <label htmlFor="reset-new-pw" className="eyebrow">New Password (min 8 chars)</label>
                <input
                  id="reset-new-pw"
                  className="field"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />

                <label htmlFor="reset-confirm-pw" className="eyebrow">Confirm New Password</label>
                <input
                  id="reset-confirm-pw"
                  className="field"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />

                <button type="submit" className="btn btn-heat btn-block" disabled={busy} style={{ marginTop: 6 }}>
                  {busy ? 'Resetting password…' : 'Reset Password & Sign in →'}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-block btn-sm"
                  onClick={() => {
                    setForgotStep('request');
                    setError('');
                  }}
                  disabled={busy}
                >
                  ← Request a new code / change email
                </button>

                {error && <p role="alert" className="error-text">{error}</p>}
              </form>
            )}
          </>
        )}
      </Rise>
    </div>
  );
}
