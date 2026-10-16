import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { OPTION_LABELS, Panel } from '../../components/ui';

interface Question {
  id: number; level: number; position: number; text: string; type: 'mcq' | 'tf';
  options: string[]; correctAnswer: string; timeLimit: number; points: number; isActive: boolean;
}
type Draft = Omit<Question, 'id' | 'position'> & { id?: number };

// Levels (rounds) are set up by the quiz master and played in this order.
interface Level { number: number; name: string; multiplier: number; qualifyTop: number | null }
const blank = (level: number): Draft => ({
  level, text: '', type: 'mcq', options: ['', '', '', ''], correctAnswer: '', timeLimit: 20, points: 1000, isActive: true,
});

export default function Questions() {
  const [vaultUntil, setVaultUntil] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    api('/auth/me').then(r => setVaultUntil(r.vaultUntil)).catch(() => {}).finally(() => setChecked(true));
  }, []);

  // Re-lock in the UI when the server-side unlock expires.
  useEffect(() => {
    if (!vaultUntil) return;
    const id = setTimeout(() => setVaultUntil(null), Math.max(0, vaultUntil - Date.now()));
    return () => clearTimeout(id);
  }, [vaultUntil]);

  if (!checked) return null;
  if (recoveryCode) return <RecoveryCodeNotice code={recoveryCode} onDone={() => setRecoveryCode(null)} />;
  if (!vaultUntil || vaultUntil <= Date.now()) {
    return <VaultLock onUnlock={(until, code) => { setVaultUntil(until); if (code) setRecoveryCode(code); }} />;
  }
  return <QuestionBank vaultUntil={vaultUntil} onLocked={() => setVaultUntil(null)} onRecoveryCode={setRecoveryCode} />;
}

// ─── Second sign-in: quiz master PIN (decrypts the bank's key on the server) ──
function VaultLock({ onUnlock }: { onUnlock: (until: number, recoveryCode?: string) => void }) {
  const [pin, setPin] = useState('');
  const [recovery, setRecovery] = useState('');
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = needsRecovery
        ? await api('/auth/vault/recover', { method: 'POST', body: { pin, recoveryCode: recovery } })
        : await api('/auth/vault', { method: 'POST', body: { pin } });
      onUnlock(r.vaultUntil, r.recoveryCode);
    } catch (err) {
      if (err instanceof ApiError && err.data?.needsGrant) setNeedsRecovery(true);
      setError((err as Error).message);
      if (!(err instanceof ApiError && err.data?.needsGrant)) setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel bracketed className="panel-lg" style={{ maxWidth: 440, margin: '24px auto', padding: '34px 30px', textAlign: 'center' }}>
      <div style={{ fontSize: '2rem' }} aria-hidden="true">🔒</div>
      <div className="eyebrow" style={{ marginTop: 10 }}>Encrypted · quiz master only</div>
      <h2 className="display" style={{ fontSize: '2.6rem', margin: '8px 0 8px' }}>Question bank</h2>
      <p className="dim" style={{ margin: '0 0 22px', fontSize: '0.9rem', lineHeight: 1.5 }}>
        Questions are stored encrypted. Your PIN unlocks them for 30 minutes on this session.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input className="field" type="password" inputMode="numeric" autoComplete="one-time-code" value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} aria-label="PIN" autoFocus
          style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '1.6rem', letterSpacing: '0.5em' }} />
        {needsRecovery && (
          <>
            <label className="eyebrow" htmlFor="recovery" style={{ textAlign: 'left', marginTop: 6 }}>Recovery code</label>
            <input id="recovery" className="field" value={recovery} onChange={e => setRecovery(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', fontSize: '0.95rem' }} />
          </>
        )}
        <button className="btn btn-heat btn-block" disabled={busy || pin.length < 4 || (needsRecovery && recovery.replace(/[^A-Z0-9]/g, '').length < 24)}>
          {busy ? 'Checking…' : needsRecovery ? 'Unlock with recovery code' : 'Unlock'}
        </button>
        {error && <p role="alert" className="error-text">{error}</p>}
        {!needsRecovery && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNeedsRecovery(true)} style={{ alignSelf: 'center' }}>
            Use recovery code
          </button>
        )}
      </form>
    </Panel>
  );
}

// Shown exactly once, when the question bank is encrypted for the first time.
function RecoveryCodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Panel bracketed className="panel-lg" style={{ maxWidth: 520, margin: '24px auto', padding: '34px 30px', textAlign: 'center' }}>
      <div className="eyebrow">Question bank encrypted</div>
      <h2 className="display" style={{ fontSize: '2.4rem', margin: '10px 0 10px' }}>Save your recovery code</h2>
      <p className="dim" style={{ margin: '0 0 20px', fontSize: '0.92rem', lineHeight: 1.55 }}>
        If every quiz master's PIN is lost or reset, this code is the <strong>only</strong> way to decrypt the questions.
        Write it down and keep it somewhere safe. It will not be shown again.
      </p>
      <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '0.06em', padding: '18px 12px', border: '2px dashed var(--line-strong)', borderRadius: 'var(--radius)', userSelect: 'all', wordBreak: 'break-all' }}>
        {code}
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', margin: '20px 0 16px', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ width: 18, height: 18 }} />
        I have saved the recovery code
      </label>
      <button className="btn btn-heat btn-block" disabled={!saved} onClick={onDone}>Continue to the question bank</button>
    </Panel>
  );
}

// ─── Load into game: the only way questions reach the live event ──────────────
function LoadIntoGame({ guard, refreshKey }: { guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>; refreshKey: number }) {
  const [status, setStatus] = useState<{ online?: boolean; error?: string; state?: string; count?: number; by?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => { api('/game/questions-status').then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const load = async () => {
    setBusy(true);
    setMessage('');
    const r = await guard(() => api('/game/load-questions', { method: 'POST' }));
    if (r) setMessage(`✓ ${r.count} questions decrypted and loaded into the game. The coordinator can start.`);
    setBusy(false);
    refresh();
  };

  const offline = status?.online === false;
  const inLobby = !status || offline || status.state === 'lobby';
  return (
    <Panel bracketed style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div className="eyebrow">Live event {offline ? <span className="pill pill-bad" style={{ marginLeft: 8 }}>Game server offline</span> : null}</div>
        <div style={{ fontWeight: 600, marginTop: 8 }}>
          {offline
            ? 'The event-day game server is not reachable'
            : status?.count ? `${status.count} questions loaded in the game${status.by ? ` by ${status.by}` : ''}` : 'No questions loaded in the game yet'}
        </div>
        <p className="dim" style={{ fontSize: '0.82rem', margin: '6px 0 0', lineHeight: 1.5 }}>
          {offline
            ? 'On event day, start it on the laptop (npm run game + Cloudflare Tunnel); an admin checks the address in Admin → Overview. You can keep editing questions meanwhile.'
            : inLobby
              ? 'Loading decrypts the active questions and sends them straight to the game server. Phones and the projector see each question only when it goes live.'
              : 'The game is running — questions can be loaded again once it is reset to the lobby.'}
        </p>
        {message && <p role="status" style={{ margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--good)' }}>{message}</p>}
      </div>
      <button className="btn btn-heat" onClick={load} disabled={busy || !inLobby || offline}>
        {busy ? 'Loading…' : status?.count ? 'Reload into game' : 'Load into game →'}
      </button>
    </Panel>
  );
}

// ─── Bank ─────────────────────────────────────────────────────────────────────
function QuestionBank({ vaultUntil, onLocked, onRecoveryCode }: {
  vaultUntil: number; onLocked: () => void; onRecoveryCode: (code: string) => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Any 423 means the server locked the bank (timeout) — go back to the PIN screen.
  const guard = useCallback(async <T,>(fn: () => Promise<T>) => {
    setError('');
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) onLocked();
      else setError((err as Error).message);
      return undefined;
    }
  }, [onLocked]);

  const load = useCallback(() => guard(async () => {
    const [qs, ls] = await Promise.all([api<Question[]>('/questions'), api<Level[]>('/levels')]);
    setQuestions(qs);
    setLevels(ls);
    setLevel(current => (ls.some(l => l.number === current) ? current : ls[0]?.number ?? 1));
  }), [guard]);
  useEffect(() => { load(); }, [load]);

  const inLevel = questions.filter(q => q.level === level);
  const current = levels.find(l => l.number === level);
  const round = levels.findIndex(l => l.number === level) + 1;
  const addLevel = () => guard(async () => {
    const created = await api<Level>('/levels', { method: 'POST', body: { name: `Level ${levels.length + 1}`, multiplier: 1 } });
    await load();
    setLevel(created.number);
    setDraft(null);
  });
  const lock = async () => { await api('/auth/vault/lock', { method: 'POST' }).catch(() => {}); onLocked(); };
  const newRecoveryCode = () => {
    if (!confirm('Create a new recovery code? The old code will stop working.')) return;
    guard(async () => onRecoveryCode((await api('/questions/recovery-code', { method: 'POST' })).recoveryCode));
  };
  const left = Math.max(0, Math.round((vaultUntil - now) / 1000));

  const move = (q: Question, direction: 'up' | 'down') =>
    guard(async () => { await api(`/questions/${q.id}/move`, { method: 'POST', body: { direction } }); await load(); });
  const remove = (q: Question) => {
    if (!confirm(`Delete this question?\n\n${q.text}`)) return;
    guard(async () => { await api(`/questions/${q.id}`, { method: 'DELETE' }); await load(); });
  };
  const applyTimer = (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = Number(timer);
    if (!confirm(`Set every "${current?.name}" question to ${seconds} seconds?`)) return;
    guard(async () => { await api(`/levels/${level}/timer`, { method: 'PUT', body: { seconds } }); setTimer(''); await load(); });
  };

  return (
    <>
      <Panel style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className="pill pill-good">🔓 Unlocked</span>
        <span className="dim" style={{ fontSize: '0.88rem' }}>Re-locks in <span className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></span>
        <span style={{ flex: 1 }} />
        <span className="dim" style={{ fontSize: '0.85rem' }}>{questions.filter(q => q.isActive).length} active of {questions.length} questions</span>
        <button className="btn btn-ghost btn-sm" onClick={newRecoveryCode}>New recovery code</button>
        <button className="btn btn-ghost btn-sm" onClick={lock}>Lock now</button>
      </Panel>

      <LoadIntoGame guard={guard} refreshKey={questions.length} />

      <nav className="tabs" aria-label="Levels">
        {levels.map((l, i) => (
          <button key={l.number} className={`tab${level === l.number ? ' active' : ''}`} onClick={() => { setLevel(l.number); setDraft(null); }}>
            L{i + 1} · {l.name}<span className="count">{questions.filter(q => q.level === l.number).length}</span>
          </button>
        ))}
        <button className="tab" onClick={addLevel} disabled={levels.length >= 20}>+ Add level</button>
      </nav>

      {current && (
        <LevelSettings key={current.number} level={current} round={round} questionCount={inLevel.length} guard={guard}
          onChanged={load} />
      )}

      <div className="grid-2" style={{ alignItems: 'end' }}>
        <Panel>
          <div className="eyebrow">Timer for every question in this level</div>
          <form onSubmit={applyTimer} style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <input className="field field-sm" type="number" min={5} max={300} placeholder="Seconds" value={timer}
              onChange={e => setTimer(e.target.value)} style={{ maxWidth: 140 }} aria-label={`Seconds for every ${current?.name} question`} />
            <button className="btn btn-ghost btn-sm" disabled={!timer || Number(timer) < 5 || Number(timer) > 300}>Apply to all in level</button>
          </form>
          <p className="dim" style={{ fontSize: '0.8rem', margin: '10px 0 0' }}>Or set a timer per question when editing it. Points ×{current?.multiplier ?? 1} in this level.</p>
        </Panel>
        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-heat" onClick={() => setDraft(blank(level))} disabled={(!!draft && !draft.id) || !current}>+ Add question to {current?.name ?? 'this level'}</button>
        </div>
      </div>

      {error && <p role="alert" className="error-text" style={{ textAlign: 'left' }}>{error}</p>}

      {draft && !draft.id && (
        <Editor draft={draft} levels={levels} onCancel={() => setDraft(null)}
          onSave={d => guard(async () => { await api('/questions', { method: 'POST', body: d }); setDraft(null); await load(); })} />
      )}

      {inLevel.length === 0 && !draft && (
        <Panel style={{ textAlign: 'center', padding: '36px 20px' }}>
          <p className="dim" style={{ margin: 0 }}>No questions in this level yet.</p>
        </Panel>
      )}

      {inLevel.map((q, i) => (
        draft?.id === q.id ? (
          <Editor key={q.id} draft={draft} levels={levels} onCancel={() => setDraft(null)}
            onSave={d => guard(async () => { await api(`/questions/${q.id}`, { method: 'PUT', body: d }); setDraft(null); await load(); })} />
        ) : (
          <Panel key={q.id} style={{ opacity: q.isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <span className="display faint" style={{ fontSize: '2rem', width: 36 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '2px 0 12px', fontWeight: 600, fontSize: '1.05rem', lineHeight: 1.4 }}>{q.text}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                  {q.options.map((o, oi) => (
                    <div key={oi} data-opt={oi} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px 6px 6px', borderRadius: 8, fontSize: '0.88rem',
                      border: '1px solid', borderColor: o === q.correctAnswer ? 'var(--good)' : 'var(--line)',
                      background: o === q.correctAnswer ? 'color-mix(in srgb, var(--good) 8%, var(--ink-0))' : 'var(--ink-0)',
                    }}>
                      <span className="display" style={{ width: 24, height: 24, borderRadius: 5, display: 'grid', placeItems: 'center', background: 'var(--opt)', color: 'var(--on-opt)', fontSize: '1rem' }}>
                        {OPTION_LABELS[oi]}
                      </span>
                      <span style={{ flex: 1 }}>{o}</span>
                      {o === q.correctAnswer && <strong style={{ color: 'var(--good)' }}>✓</strong>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <span className="pill">⏱ {q.timeLimit}s</span>
                  <span className="pill">{q.points} pts</span>
                  <span className="pill">{q.type === 'tf' ? 'True / False' : 'Multiple choice'}</span>
                  {!q.isActive && <span className="pill pill-warn">Hidden from game</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ ...q, options: q.type === 'mcq' ? [...q.options, '', '', ''].slice(0, 4) : q.options })}>Edit</button>
                <button className="btn btn-ghost btn-sm" onClick={() => move(q, 'up')} disabled={i === 0} aria-label="Move up">↑</button>
                <button className="btn btn-ghost btn-sm" onClick={() => move(q, 'down')} disabled={i === inLevel.length - 1} aria-label="Move down">↓</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(q)}>Delete</button>
              </div>
            </div>
          </Panel>
        )
      ))}
    </>
  );
}

// ─── Level settings: name, multiplier, delete ────────────────────────────────
function LevelSettings({ level, round, questionCount, guard, onChanged }: {
  level: Level; round: number; questionCount: number;
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>; onChanged: () => void;
}) {
  const [name, setName] = useState(level.name);
  const [multiplier, setMultiplier] = useState(String(level.multiplier));
  // Elimination: only the top N go on to the next level (blank = everyone).
  const [qualifyTop, setQualifyTop] = useState(level.qualifyTop ? String(level.qualifyTop) : '');
  const top = qualifyTop.trim() === '' ? null : Number(qualifyTop);
  const dirty = name.trim() !== level.name || Number(multiplier) !== level.multiplier || top !== level.qualifyTop;
  const valid = name.trim().length > 0 && Number(multiplier) > 0 && Number(multiplier) <= 10
    && (top === null || (Number.isInteger(top) && top >= 1));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    guard(async () => {
      await api(`/levels/${level.number}`, { method: 'PUT', body: { name: name.trim(), multiplier: Number(multiplier), qualifyTop: top } });
      onChanged();
    });
  };
  const remove = () => {
    if (!confirm(`Delete the level "${level.name}"?`)) return;
    guard(async () => { await api(`/levels/${level.number}`, { method: 'DELETE' }); onChanged(); });
  };

  return (
    <Panel>
      <form onSubmit={save} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 220px' }}>
          <label className="eyebrow" htmlFor="lvl-name">Level {round} name</label>
          <input id="lvl-name" className="field field-sm" value={name} maxLength={40} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flex: '0 1 140px' }}>
          <label className="eyebrow" htmlFor="lvl-mult">Points ×</label>
          <input id="lvl-mult" className="field field-sm" type="number" min={0.1} max={10} step={0.1} value={multiplier}
            onChange={e => setMultiplier(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flex: '0 1 180px' }}>
          <label className="eyebrow" htmlFor="lvl-top">Top N advance</label>
          <input id="lvl-top" className="field field-sm" type="number" min={1} step={1} value={qualifyTop} placeholder="Everyone"
            onChange={e => setQualifyTop(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-sm" disabled={!dirty || !valid}>Save level</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={questionCount > 0}
          title={questionCount > 0 ? 'Move or delete its questions first' : undefined}>Delete level</button>
      </form>
      <p className="dim" style={{ fontSize: '0.8rem', margin: '10px 0 0' }}>
        Shown on the projector and phones when this round starts. Levels are played in the order of the tabs; empty levels are skipped.
        With "Top N advance", everyone below the top N after this level's last question is eliminated (ties go to the faster player); the last level has no cut.
      </p>
    </Panel>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────
function Editor({ draft, levels, onSave, onCancel }: {
  draft: Draft; levels: Level[]; onSave: (d: Draft) => Promise<unknown>; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [saving, setSaving] = useState(false);
  const options = d.type === 'tf' ? ['True', 'False'] : d.options;
  const filled = options.map(o => o.trim()).filter(Boolean);

  const setOption = (i: number, value: string) => {
    const next = [...d.options];
    const wasCorrect = d.correctAnswer === d.options[i];
    next[i] = value;
    setD({ ...d, options: next, correctAnswer: wasCorrect ? value : d.correctAnswer });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ ...d, options: d.type === 'tf' ? ['True', 'False'] : filled, correctAnswer: d.correctAnswer.trim() });
    setSaving(false);
  };

  return (
    <Panel bracketed className="panel-lg">
      <form onSubmit={submit}>
        <div className="eyebrow">{d.id ? 'Edit question' : 'New question'}</div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="form-row">
            <label className="eyebrow" htmlFor="q-level">Level</label>
            <select id="q-level" className="field field-sm" value={d.level} onChange={e => setD({ ...d, level: Number(e.target.value) })}>
              {levels.map((l, i) => <option key={l.number} value={l.number}>Level {i + 1} · {l.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="q-type">Type</label>
            <select id="q-type" className="field field-sm" value={d.type}
              onChange={e => setD({ ...d, type: e.target.value as Draft['type'], correctAnswer: '', options: e.target.value === 'tf' ? ['True', 'False'] : ['', '', '', ''] })}>
              <option value="mcq">Multiple choice</option>
              <option value="tf">True / False</option>
            </select>
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="q-time">Timer (seconds)</label>
            <input id="q-time" className="field field-sm" type="number" min={5} max={300} value={d.timeLimit}
              onChange={e => setD({ ...d, timeLimit: Number(e.target.value) })} required />
          </div>
          <div className="form-row">
            <label className="eyebrow" htmlFor="q-points">Base points</label>
            <input id="q-points" className="field field-sm" type="number" min={100} max={10000} step={50} value={d.points}
              onChange={e => setD({ ...d, points: Number(e.target.value) })} required />
          </div>
        </div>

        <div className="form-row" style={{ marginTop: 14 }}>
          <label className="eyebrow" htmlFor="q-text">Question</label>
          <textarea id="q-text" className="field" value={d.text} onChange={e => setD({ ...d, text: e.target.value })} maxLength={500} required />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
          <legend className="eyebrow" style={{ marginBottom: 10 }}>Options — tick the correct answer</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
            {options.map((o, i) => (
              <div key={i} data-opt={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="display" style={{ width: 34, height: 40, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--opt)', color: 'var(--on-opt)', fontSize: '1.3rem', flexShrink: 0 }}>
                  {OPTION_LABELS[i]}
                </span>
                {d.type === 'tf' ? (
                  <span style={{ flex: 1, fontWeight: 600 }}>{o}</span>
                ) : (
                  <input className="field field-sm" value={o} onChange={e => setOption(i, e.target.value)} maxLength={160}
                    placeholder={i < 2 ? `Option ${OPTION_LABELS[i]} (required)` : `Option ${OPTION_LABELS[i]} (optional)`} required={i < 2} />
                )}
                <input type="radio" name="correct" aria-label={`Option ${OPTION_LABELS[i]} is correct`} checked={!!o.trim() && d.correctAnswer === o}
                  disabled={!o.trim()} onChange={() => setD({ ...d, correctAnswer: o })} style={{ width: 20, height: 20, accentColor: 'var(--good)' }} />
              </div>
            ))}
          </div>
        </fieldset>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, fontSize: '0.9rem' }}>
          <input type="checkbox" checked={d.isActive} onChange={e => setD({ ...d, isActive: e.target.checked })} style={{ width: 18, height: 18 }} />
          Include in the game (untick to keep it as a draft)
        </label>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="submit" className="btn btn-heat" disabled={saving || !d.correctAnswer || !options.includes(d.correctAnswer)}>
            {saving ? 'Saving…' : d.id ? 'Save changes' : 'Add question'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
