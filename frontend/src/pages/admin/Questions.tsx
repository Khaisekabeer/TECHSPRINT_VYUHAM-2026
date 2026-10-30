import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fetchObjectUrl } from '../../lib/api';
import { OPTION_LABELS, Panel } from '../../components/ui';

interface Question {
  id: number; level: number; position: number; text: string; type: 'mcq' | 'tf';
  options: string[]; correctAnswer: string; timeLimit: number; points: number; isActive: boolean;
  imageId?: string | null; // picture for "identify this person / object" questions (stored encrypted)
}
type Draft = Omit<Question, 'id' | 'position'> & { id?: number };

// Levels (rounds) are set up by the quiz master and played in this order.
interface Cut { rule: 'top' | 'percent' | 'min_score' | 'bottom' | 'min_correct'; value: number; ties: 'speed' | 'include' }
interface Level { number: number; name: string; multiplier: number; cut: Cut | null; isActive: boolean }
// Round numbers count only the levels that are on, so switching one off closes the gap after it.
const roundOf = (levels: Level[], level: Level) => levels.filter(l => l.isActive && l.number <= level.number).length;

// Who goes on to the next level when this one ends. The coordinator confirms every cut.
const CUT_RULES: { id: Cut['rule']; label: string; unit: string }[] = [
  { id: 'top', label: 'Top N go through', unit: 'players' },
  { id: 'percent', label: 'Top % go through', unit: '%' },
  { id: 'min_score', label: 'Minimum score to go through', unit: 'points' },
  { id: 'bottom', label: 'Bottom N are out', unit: 'players' },
  { id: 'min_correct', label: 'Minimum correct answers in this level', unit: 'correct' },
];

const blank = (level: number): Draft => ({
  level, text: '', type: 'mcq', options: ['', '', '', ''], correctAnswer: '', timeLimit: 20, points: 1000, isActive: true, imageId: null,
});

interface SetSummary { id: string; name: string; ready: boolean; questions: number; active: number; levels: number }
interface OpenSet { id: string; name: string }

// Question sets ("Main set", "Trial set", ...): each has its own PIN, chosen by the quiz master.
// The coordinator enters that PIN in the host console to load the set into the game.
export default function Questions() {
  const [open, setOpen] = useState<{ until: number; bank: OpenSet } | null>(null);
  const [checked, setChecked] = useState(false);
  const [notice, setNotice] = useState<{ code: string; setName: string } | null>(null);

  useEffect(() => {
    api('/auth/me')
      .then(r => { if (r.vaultUntil && r.vaultBank) setOpen({ until: r.vaultUntil, bank: r.vaultBank }); })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  // Re-lock in the UI when the server-side unlock expires.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => setOpen(null), Math.max(0, open.until - Date.now()));
    return () => clearTimeout(id);
  }, [open]);

  const opened = (r: { vaultUntil: number; bank: OpenSet; recoveryCode?: string }) => {
    setOpen({ until: r.vaultUntil, bank: r.bank });
    if (r.recoveryCode) setNotice({ code: r.recoveryCode, setName: r.bank.name });
  };

  if (!checked) return null;
  if (notice) return <RecoveryCodeNotice code={notice.code} setName={notice.setName} onDone={() => setNotice(null)} />;
  if (!open || open.until <= Date.now()) return <SetPicker onOpened={opened} />;
  return (
    <QuestionBank key={open.bank.id} bank={open.bank} vaultUntil={open.until} onLocked={() => setOpen(null)}
      onRenamed={name => setOpen({ ...open, bank: { ...open.bank, name } })}
      onRecoveryCode={code => setNotice({ code, setName: open.bank.name })} />
  );
}

// ─── Pick a set and open it with its PIN; create a set; first-time setup ──────
type SetMode = { kind: 'open' | 'setup' | 'recover'; set: SetSummary } | { kind: 'create' } | null;

const pinField = (value: string, onChange: (v: string) => void, label: string, id: string, autoFocus = false) => (
  <div className="form-row">
    <label className="eyebrow" htmlFor={id}>{label}</label>
    <input id={id} className="field" type="password" inputMode="numeric" autoComplete="off" value={value} autoFocus={autoFocus}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 12))}
      style={{ fontFamily: 'var(--font-mono)', fontSize: '1.3rem', letterSpacing: '0.4em', textAlign: 'center' }} />
  </div>
);

function SetPicker({ onOpened }: { onOpened: (r: { vaultUntil: number; bank: OpenSet; recoveryCode?: string }) => void }) {
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [mode, setMode] = useState<SetMode>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [code, setCode] = useState('');
  const [useOldCode, setUseOldCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<SetSummary[]>('/banks').then(setSets).catch(err => setError(err.message)); }, []);

  const choose = (m: SetMode) => { setMode(m); setPin(''); setPin2(''); setOldPin(''); setCode(''); setName(''); setError(''); setUseOldCode(false); };
  const needsNewPin = mode && mode.kind !== 'open';
  const pinsOk = pin.length >= 4 && (!needsNewPin || pin === pin2);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError('');
    try {
      const r = mode.kind === 'create'
        ? await api('/banks', { method: 'POST', body: { name: name.trim(), pin } })
        : mode.kind === 'open'
          ? await api(`/banks/${mode.set.id}/open`, { method: 'POST', body: { pin } })
          : mode.kind === 'recover'
            ? await api(`/banks/${mode.set.id}/recover`, { method: 'POST', body: { recoveryCode: code, pin } })
            : await api(`/banks/${mode.set.id}/setup`, { method: 'POST', body: { pin, ...(useOldCode ? { oldRecoveryCode: code } : { oldPin }) } });
      onOpened(r);
    } catch (err) {
      setError((err as Error).message);
      setPin(mode.kind === 'open' ? '' : pin);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel bracketed className="panel-lg" style={{ maxWidth: 560, margin: '24px auto', padding: '30px 28px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem' }} aria-hidden="true">🔒</div>
        <div className="eyebrow" style={{ marginTop: 8 }}>Encrypted · each set has its own PIN</div>
        <h2 className="display" style={{ fontSize: '2.6rem', margin: '8px 0 8px' }}>Question sets</h2>
        <p className="dim" style={{ margin: '0 0 20px', fontSize: '0.88rem', lineHeight: 1.5 }}>
          Open a set with its PIN to edit it (30 minutes). Give the coordinator the PIN of the set to play — they enter it in the host console to load it.
        </p>
      </div>

      {!mode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sets === null && !error && <p className="dim" style={{ textAlign: 'center' }}>Loading…</p>}
          {sets?.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <div className="dim" style={{ fontSize: '0.8rem' }}>{s.questions} questions · {s.levels} levels{s.ready ? '' : ' · needs a PIN'}</div>
              </div>
              {s.ready ? (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => choose({ kind: 'recover', set: s })}>Forgot PIN</button>
                  <button className="btn btn-heat btn-sm" onClick={() => choose({ kind: 'open', set: s })}>Open</button>
                </>
              ) : (
                <button className="btn btn-heat btn-sm" onClick={() => choose({ kind: 'setup', set: s })}>Set up</button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => choose({ kind: 'create' })} disabled={(sets?.length ?? 0) >= 20}>+ New question set</button>
        </div>
      )}

      {mode && (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
            {mode.kind === 'create' ? 'New question set'
              : mode.kind === 'open' ? `Open "${mode.set.name}"`
              : mode.kind === 'recover' ? `New PIN for "${mode.set.name}"`
              : `Set up "${mode.set.name}"`}
          </div>

          {mode.kind === 'create' && (
            <div className="form-row">
              <label className="eyebrow" htmlFor="set-name">Name</label>
              <input id="set-name" className="field" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="e.g. Main set" autoFocus required />
            </div>
          )}

          {mode.kind === 'setup' && mode.set.questions > 0 && (
            <>
              <p className="dim" style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
                These {mode.set.questions} questions were encrypted before sets existed. Confirm once with your <strong>old quiz master PIN</strong>
                {' '}(the one you used to unlock the question bank) — or the old recovery code — to move them into this set.
              </p>
              {useOldCode ? (
                <div className="form-row">
                  <label className="eyebrow" htmlFor="old-code">Old recovery code</label>
                  <input id="old-code" className="field" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    autoComplete="off" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', textAlign: 'center' }} />
                </div>
              ) : pinField(oldPin, setOldPin, 'Old quiz master PIN', 'old-pin', true)}
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setUseOldCode(!useOldCode); setCode(''); setOldPin(''); }}>
                {useOldCode ? 'Use the old PIN instead' : 'Use the old recovery code instead'}
              </button>
            </>
          )}

          {mode.kind === 'recover' && (
            <div className="form-row">
              <label className="eyebrow" htmlFor="rec-code">This set's recovery code</label>
              <input id="rec-code" className="field" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                autoComplete="off" spellCheck={false} autoFocus style={{ fontFamily: 'var(--font-mono)', textAlign: 'center' }} />
            </div>
          )}

          {mode.kind === 'open'
            ? pinField(pin, setPin, 'Set PIN', 'set-pin', true)
            : (
              <>
                {pinField(pin, setPin, mode.kind === 'create' ? 'Choose the set PIN (4–12 digits)' : 'New set PIN (4–12 digits)', 'new-pin')}
                {pinField(pin2, setPin2, 'Type it again', 'new-pin2')}
                {pin2.length >= 4 && pin !== pin2 && <p className="error-text">The PINs don't match</p>}
              </>
            )}

          <button className="btn btn-heat btn-block" disabled={busy || !pinsOk || (mode.kind === 'create' && !name.trim())
            || (mode.kind === 'setup' && mode.set.questions > 0 && (useOldCode ? code.replace(/[^A-Z0-9]/g, '').length < 24 : oldPin.length < 4))
            || (mode.kind === 'recover' && code.replace(/[^A-Z0-9]/g, '').length < 24)}>
            {busy ? 'Checking…' : mode.kind === 'create' ? 'Create set' : mode.kind === 'open' ? 'Open' : mode.kind === 'recover' ? 'Set new PIN & open' : 'Set PIN & open'}
          </button>
          {error && <p role="alert" className="error-text">{error}</p>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(null)} style={{ alignSelf: 'center' }}>← All sets</button>
        </form>
      )}
      {!mode && error && <p role="alert" className="error-text" style={{ marginTop: 12 }}>{error}</p>}
    </Panel>
  );
}

// Shown once: when a set is created or set up, and when its recovery code is replaced.
function RecoveryCodeNotice({ code, setName, onDone }: { code: string; setName: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Panel bracketed className="panel-lg" style={{ maxWidth: 520, margin: '24px auto', padding: '34px 30px', textAlign: 'center' }}>
      <div className="eyebrow">Recovery code · {setName}</div>
      <h2 className="display" style={{ fontSize: '2.4rem', margin: '10px 0 10px' }}>Save this code</h2>
      <p className="dim" style={{ margin: '0 0 20px', fontSize: '0.92rem', lineHeight: 1.55 }}>
        If this set's PIN is forgotten, this code is the <strong>only</strong> way to set a new one.
        Write it down and keep it somewhere safe. It will not be shown again.
      </p>
      <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '0.06em', padding: '18px 12px', border: '2px dashed var(--line-strong)', borderRadius: 'var(--radius)', userSelect: 'all', wordBreak: 'break-all' }}>
        {code}
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', margin: '20px 0 16px', fontSize: '0.9rem' }}>
        <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} style={{ width: 18, height: 18 }} />
        I have saved the recovery code
      </label>
      <button className="btn btn-heat btn-block" disabled={!saved} onClick={onDone}>Continue to the set</button>
    </Panel>
  );
}

// ─── Load into game (quiz master test load; the coordinator loads with the PIN) ──
function LoadIntoGame({ guard, refreshKey, bank }: { guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>; refreshKey: number; bank: OpenSet }) {
  const [status, setStatus] = useState<{ online?: boolean; error?: string; state?: string; count?: number; by?: string; bank?: OpenSet | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(() => { api('/game/questions-status').then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh, refreshKey]);

  const load = async () => {
    setBusy(true);
    setMessage('');
    const r = await guard(() => api('/game/load-questions', { method: 'POST', body: { bankId: bank.id } }));
    if (r) setMessage(`✓ ${r.count} questions from "${bank.name}" loaded into the game.`);
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
            : status?.count ? `"${status.bank?.name ?? 'A set'}" is loaded in the game — ${status.count} questions${status.by ? `, by ${status.by}` : ''}` : 'No set loaded in the game yet'}
        </div>
        <p className="dim" style={{ fontSize: '0.82rem', margin: '6px 0 0', lineHeight: 1.5 }}>
          {offline
            ? 'On event day, start it on the laptop (npm run game + Cloudflare Tunnel); an admin checks the address in Admin → Overview. You can keep editing meanwhile.'
            : inLobby
              ? 'On event day the coordinator loads the set from the host console by entering its PIN. You can also load this set from here to test it.'
              : 'The game is running — a set can be loaded again once it is reset to the lobby.'}
        </p>
        {message && <p role="status" style={{ margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--good)' }}>{message}</p>}
      </div>
      <button className="btn btn-heat" onClick={load} disabled={busy || !inLobby || offline}>
        {busy ? 'Loading…' : `Load "${bank.name}" →`}
      </button>
    </Panel>
  );
}

// ─── Bank ─────────────────────────────────────────────────────────────────────
function QuestionBank({ bank, vaultUntil, onLocked, onRenamed, onRecoveryCode }: {
  bank: OpenSet; vaultUntil: number; onLocked: () => void; onRenamed: (name: string) => void; onRecoveryCode: (code: string) => void;
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
  const round = current ? roundOf(levels, current) : 0;
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
  // Set actions: rename, change PIN (tell the coordinator), delete.
  const rename = () => {
    const name = prompt('New name for this set', bank.name)?.trim();
    if (name && name !== bank.name) guard(async () => { await api('/banks/current', { method: 'PATCH', body: { name } }); onRenamed(name); });
  };
  const changePin = () => {
    const currentPin = prompt(`Current PIN of "${bank.name}"`);
    if (!currentPin) return;
    const pin = prompt('New PIN (4-12 digits). Tell the coordinator the new PIN.');
    if (!pin) return;
    if (prompt('Type the new PIN again') !== pin) { alert("The PINs don't match — nothing changed."); return; }
    guard(async () => { await api(`/banks/${bank.id}/pin`, { method: 'POST', body: { currentPin, pin } }); alert('PIN changed.'); });
  };
  const deleteSet = () => {
    const confirmName = prompt(`Delete "${bank.name}" with all its levels and ${questions.length} questions? This cannot be undone.

Type the set name to confirm:`);
    if (confirmName === null) return;
    guard(async () => { await api('/banks/current', { method: 'DELETE', body: { confirmName } }); onLocked(); });
  };

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
        <span className="pill pill-good">🔓 {bank.name}</span>
        <span className="dim" style={{ fontSize: '0.88rem' }}>Re-locks in <span className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span></span>
        <span style={{ flex: 1 }} />
        <span className="dim" style={{ fontSize: '0.85rem' }}>{questions.filter(q => q.isActive).length} active of {questions.length} questions</span>
        <button className="btn btn-ghost btn-sm" onClick={rename}>Rename</button>
        <button className="btn btn-ghost btn-sm" onClick={changePin}>Change PIN</button>
        <button className="btn btn-ghost btn-sm" onClick={newRecoveryCode}>New recovery code</button>
        <button className="btn btn-danger btn-sm" onClick={deleteSet}>Delete set</button>
        <button className="btn btn-heat btn-sm" onClick={lock}>Lock · switch set</button>
      </Panel>

      <LoadIntoGame guard={guard} refreshKey={questions.length} bank={bank} />

      <nav className="tabs" aria-label="Levels">
        {levels.map(l => (
          <button key={l.number} className={`tab${level === l.number ? ' active' : ''}`} style={{ opacity: l.isActive ? 1 : 0.55 }} onClick={() => { setLevel(l.number); setDraft(null); }}>
            {l.isActive ? `L${roundOf(levels, l)}` : 'Off'} · {l.name}<span className="count">{questions.filter(q => q.level === l.number).length}</span>
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
                  {q.imageId && <span className="pill">🖼 Picture</span>}
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
  // Elimination when the level ends ('' = everyone goes through).
  const [rule, setRule] = useState<string>(level.cut?.rule ?? '');
  const [value, setValue] = useState(level.cut ? String(level.cut.value) : '');
  const [ties, setTies] = useState<Cut['ties']>(level.cut?.ties ?? 'speed');
  const cut = rule ? { rule, value: Number(value), ties } : null;
  const cutChanged = JSON.stringify(cut) !== JSON.stringify(level.cut ? { rule: level.cut.rule, value: level.cut.value, ties: level.cut.ties } : null);
  const dirty = name.trim() !== level.name || Number(multiplier) !== level.multiplier || cutChanged;
  const valueOk = !rule || (value.trim() !== '' && Number(value) >= (rule === 'min_score' ? 0 : 1)
    && (rule !== 'percent' || Number(value) <= 100) && (['min_score', 'percent'].includes(rule) || Number.isInteger(Number(value))));
  const valid = name.trim().length > 0 && Number(multiplier) > 0 && Number(multiplier) <= 10 && valueOk;
  const unit = CUT_RULES.find(r => r.id === rule)?.unit;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    guard(async () => {
      await api(`/levels/${level.number}`, { method: 'PUT', body: { name: name.trim(), multiplier: Number(multiplier), cut } });
      onChanged();
    });
  };
  const remove = () => {
    if (!confirm(`Delete the level "${level.name}"?`)) return;
    guard(async () => { await api(`/levels/${level.number}`, { method: 'DELETE' }); onChanged(); });
  };
  const setActive = (active: boolean) => guard(async () => {
    await api(`/levels/${level.number}/active`, { method: 'PUT', body: { active } });
    onChanged();
  });

  return (
    <Panel>
      <form onSubmit={save} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 220px' }}>
          <label className="eyebrow" htmlFor="lvl-name">{level.isActive ? `Level ${round} name` : 'Level name (off)'}</label>
          <input id="lvl-name" className="field field-sm" value={name} maxLength={40} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flex: '0 1 140px' }}>
          <label className="eyebrow" htmlFor="lvl-mult">Points ×</label>
          <input id="lvl-mult" className="field field-sm" type="number" min={0.1} max={10} step={0.1} value={multiplier}
            onChange={e => setMultiplier(e.target.value)} required />
        </div>
        <div className="form-row" style={{ flex: '1 1 240px' }}>
          <label className="eyebrow" htmlFor="lvl-cut">After this level</label>
          <select id="lvl-cut" className="field field-sm" value={rule} onChange={e => { setRule(e.target.value); if (!e.target.value) setValue(''); }}>
            <option value="">Everyone goes through</option>
            {CUT_RULES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        {rule && (
          <>
            <div className="form-row" style={{ flex: '0 1 130px' }}>
              <label className="eyebrow" htmlFor="lvl-cut-value">{unit}</label>
              <input id="lvl-cut-value" className="field field-sm" type="number" min={rule === 'min_score' ? 0 : 1} max={rule === 'percent' ? 100 : undefined}
                step={rule === 'min_score' || rule === 'percent' ? 'any' : 1} value={value} onChange={e => setValue(e.target.value)} required />
            </div>
            <div className="form-row" style={{ flex: '1 1 210px' }}>
              <label className="eyebrow" htmlFor="lvl-cut-ties">Tie at the line</label>
              <select id="lvl-cut-ties" className="field field-sm" value={ties} onChange={e => setTies(e.target.value as Cut['ties'])}>
                <option value="speed">Faster player goes through</option>
                <option value="include">Everyone tied goes through</option>
              </select>
            </div>
          </>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActive(!level.isActive)}>{level.isActive ? 'Turn level off' : 'Turn level on'}</button>
        <button className="btn btn-ghost btn-sm" disabled={!dirty || !valid}>Save level</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={questionCount > 0}
          title={questionCount > 0 ? 'Move or delete its questions first' : undefined}>Delete level</button>
      </form>
      <p className="dim" style={{ fontSize: '0.8rem', margin: '10px 0 0' }}>
        Shown on the projector and phones when this round starts. Levels are played in the order of the tabs; empty levels are skipped.
        A level that is turned off stays here with its questions but is not played, and the levels after it are renumbered.
        "After this level" decides who goes on when its last question ends; the coordinator reviews the list and confirms it in the host console. The last level has no cut.
      </p>
    </Panel>
  );
}

// ─── Question picture: upload (resized in the browser), preview, remove ──────
// Stored encrypted like the question; shown on the projector and phones only when the question is live.
async function resizeImage(file: File, maxSide = 1600): Promise<{ mime: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mime: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

function QuestionImage({ imageId, onChange }: { imageId: string | null; onChange: (id: string | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!imageId) { setPreview(null); return; }
    let url: string | null = null;
    fetchObjectUrl(`/questions/images/${imageId}`).then(u => { url = u; setPreview(u); }).catch(() => setError('Could not load the picture'));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [imageId]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const image = await resizeImage(file);
      const saved = await api<{ id: string }>('/questions/images', { method: 'POST', body: image });
      onChange(saved.id);
    } catch (err) {
      setError((err as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form-row" style={{ marginTop: 14 }}>
      <span className="eyebrow">Picture (optional) — for "identify this person / object" questions</span>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {preview && <img src={preview} alt="Question picture" style={{ width: 180, height: 120, objectFit: 'contain', border: '1px solid var(--line-strong)', borderRadius: 8, background: '#fff' }} />}
        <label className="btn btn-ghost btn-sm" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Uploading…' : imageId ? 'Replace picture' : '+ Add picture'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={busy} style={{ display: 'none' }} />
        </label>
        {imageId && <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(null)} disabled={busy}>Remove picture</button>}
      </div>
      {error && <p className="error-text" style={{ textAlign: 'left' }}>{error}</p>}
    </div>
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
              {levels.map(l => <option key={l.number} value={l.number}>{l.isActive ? `Level ${roundOf(levels, l)}` : 'Off'} · {l.name}</option>)}
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
          <textarea id="q-text" className="field" value={d.text} onChange={e => setD({ ...d, text: e.target.value })} maxLength={500} required
            placeholder="e.g. Who is this computer scientist?  /  Identify this component" />
        </div>

        <QuestionImage imageId={d.imageId ?? null} onChange={imageId => setD({ ...d, imageId })} />

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
