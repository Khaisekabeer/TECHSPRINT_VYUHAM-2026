import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Avatar, Brand, Panel as SharedPanel, TimerRing, Toast } from '../components/ui';
import StaffLogin from '../components/StaffLogin';
import { api, CAN_HOST, ROLE_LABEL, session, signOut, useStaffSession } from '../lib/api';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  intro: 'Level briefing',
  question: 'Question live',
  leaderboard: 'Reveal',
  podium: 'Podium',
};

export default function HostConsole() {
  const { socket, isConnected, serverUrl } = useSocket();
  const current = useStaffSession();
  const token = current && CAN_HOST.includes(current.staff.role) ? current.token : null;
  const [loaded, setLoaded] = useState<{ count: number; by?: string; bank?: { id: string; name: string } | null } | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [toast, setToast] = useState('');
  // The latest cut after a level: who advanced and who was eliminated.
  const [cut, setCut] = useState<any>(null);

  const timeLeft = useCountdown(
    gameState?.state === 'question' ? gameState.questionEndsAt : null,
    gameState?.serverNow,
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const logout = (msg?: string) => {
    session.clear();
    if (msg) showToast(msg);
  };

  useEffect(() => {
    if (!token || !isConnected) return;
    socket.on('game_state', setGameState);
    socket.on('players_list', setPlayers);
    socket.on('answer_count', setAnswerCount);
    socket.on('questions_loaded', setLoaded);
    socket.on('question_result', (r: any) => { if (r?.elimination) setCut(r.elimination); });
    socket.on('game_reset', () => setCut(null));
    socket.emit('join_role', 'host', token, (res: any) => {
      if (res?.error) logout(res.error);
    });
    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('answer_count');
      socket.off('questions_loaded');
      socket.off('question_result');
      socket.off('game_reset');
    };
  }, [socket, token, isConnected]);

  const hostAction = (action: string, data: any = null, onSuccess?: (res: any) => void) => {
    socket.emit('host_action', action, data, (res: any) => {
      if (res?.error === 'Not authorised') logout('Session expired — please sign in again');
      else if (res?.error) showToast(res.error);
      else onSuccess?.(res);
    });
  };

  const startGame = () => hostAction('start_game');
  const startQuestion = () => hostAction('start_question');
  const endQuestion = () => hostAction('end_question');
  const kickPlayer = (id: string, name: string) => {
    if (confirm(`Remove ${name} from the lobby?`)) hostAction('kick_player', { playerId: id });
  };
  // Once the game is running, removing a player is a disqualification, kept on record with a reason.
  const disqualify = (id: string, name: string) => {
    const reason = prompt(`Disqualify ${name}? They stay on record with this reason (e.g. "Using another device").`, 'Malpractice');
    if (reason === null) return;
    hostAction('disqualify_player', { playerId: id, reason: reason.trim() || 'Disqualified by the quiz host' }, () => showToast(`${name} disqualified`));
  };
  const resetGame = () => {
    if (confirm('Reset the entire game? All players and scores will be cleared.')) {
      hostAction('reset_game', null, () => showToast('Game reset'));
    }
  };

  // Which question number to show: the live one, the one just finished, or progress so far.
  const questionNumber = (() => {
    if (!gameState) return 0;
    if (gameState.state === 'question') return gameState.currentQuestionIndex + 1;
    if (gameState.state === 'podium') return gameState.totalQuestions;
    return Math.max(0, gameState.currentQuestionIndex);
  })();

  // ─── Sign-in: coordinator (or admin) conducts the live event ───────────────
  if (!current) {
    return (
      <>
        {toast && <Toast msg={toast} />}
        <StaffLogin title="Host" accent="Command" note="Coordinator sign-in — conducts the live event." />
      </>
    );
  }
  if (!token) {
    return (
      <div className="stage" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <SharedPanel bracketed style={{ maxWidth: 420, textAlign: 'center', padding: '32px 28px' }}>
          <h1 className="display" style={{ fontSize: '2.4rem', margin: '0 0 10px' }}>No access</h1>
          <p className="dim" style={{ margin: '0 0 20px' }}>
            The coordinator conducts the live event. {ROLE_LABEL[current.staff.role]}s use the admin panel.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a className="btn btn-heat" href="/admin">Open admin panel</a>
            <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </SharedPanel>
      </div>
    );
  }

  // ─── Console ───────────────────────────────────────────────────────────────
  const phase = gameState?.state;
  const level = gameState?.currentLevel ?? 1;
  const total = gameState?.totalQuestions ?? 0;
  const active = players.filter(p => (p.status ?? 'active') === 'active');
  const online = active.filter(p => p.connected).length;
  const flagged = (p: any) => (p.flags?.away ?? 0) + (p.flags?.fastCorrect ?? 0) > 0;
  const isFinalReveal = phase === 'leaderboard' && gameState.currentQuestionIndex >= total;
  const answeredPct = answerCount.total ? (answerCount.answered / answerCount.total) * 100 : 0;

  return (
    <div className="stage" data-level={level}>
      {toast && <Toast msg={toast} />}

      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px clamp(16px, 3vw, 36px)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <Brand />
        <span className="eyebrow">Host command</span>
        <span style={{ flex: 1 }} />
        <span className="chip"><span className={`dot ${isConnected ? 'dot-live' : 'dot-off'}`} />{isConnected ? 'Connected' : 'Offline'}</span>
        <button className="btn btn-danger btn-sm" onClick={resetGame}>Reset game</button>
        <span className="pill pill-dark">{ROLE_LABEL[current.staff.role]}</span>
        <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{current.staff.displayName}</span>
        <a className="btn btn-ghost btn-sm" href="/admin">Admin</a>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
      </header>

      <div className="host-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {/* Phase */}
          <Panel>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div className="eyebrow">Current phase</div>
                <div className="display heat" style={{ fontSize: 'clamp(2.6rem, 5vw, 3.8rem)', marginTop: 8 }}>{PHASE_LABEL[phase] ?? '—'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="chip chip-heat">Round {level}{gameState?.totalLevels ? `/${gameState.totalLevels}` : ''} · {gameState?.levelConfig?.name ?? '—'}{gameState?.levelConfig?.theme ? ` · ${gameState.levelConfig.theme}` : ''}</span>
                <div className="display tabular" style={{ fontSize: '2.4rem', marginTop: 10 }}>
                  {questionNumber}<span className="faint" style={{ fontSize: '1.4rem' }}> / {total || '—'}</span>
                </div>
              </div>
            </div>

            {/* Question progress strip */}
            {total > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 20 }} aria-label={`Question ${questionNumber} of ${total}`}>
                {Array.from({ length: total }, (_, i) => {
                  const done = phase === 'podium' || i < gameState.currentQuestionIndex;
                  const live = phase === 'question' && i === gameState.currentQuestionIndex;
                  return (
                    <span key={i} style={{
                      flex: 1, height: 6, borderRadius: 1,
                      background: live ? 'var(--heat)' : done ? 'color-mix(in srgb, var(--heat) 45%, transparent)' : 'var(--line)',
                    }} />
                  );
                })}
              </div>
            )}
          </Panel>

          {/* Load a question set (lobby only): pick the set, enter its PIN */}
          {phase === 'lobby' && <LoadSet loaded={loaded} onLoaded={msg => showToast(msg)} />}

          {/* Next move */}
          <Panel>
            <div className="eyebrow" style={{ marginBottom: 16 }}>Next move</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              {phase === 'lobby' && (
                <>
                  <button className="btn btn-heat btn-lg" onClick={startGame} disabled={players.length === 0 || total === 0}>
                    Start game →
                  </button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>
                    {total === 0
                      ? 'Load a question set first (above): pick the set and enter its PIN from the quiz master.'
                      : `${loaded?.bank?.name ? `"${loaded.bank.name}" · ` : ''}${total} questions · ${players.length === 0 ? 'waiting for players to join…' : `${players.length} players`}`}
                  </span>
                </>
              )}
              {(phase === 'intro' || phase === 'leaderboard') && (
                <button className="btn btn-heat btn-lg" onClick={startQuestion}>
                  {isFinalReveal ? 'Show final results →' : phase === 'intro' ? 'Launch first question →' : 'Next question →'}
                </button>
              )}
              {phase === 'question' && (
                <>
                  <button className="btn btn-ghost btn-lg" onClick={endQuestion}>End now &amp; reveal</button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>Ends automatically when the timer runs out.</span>
                </>
              )}
              {phase === 'podium' && (
                <span className="dim">Game complete — results saved. Use <strong className="heat">Reset game</strong> to run another round.</span>
              )}
            </div>
          </Panel>

          {cut && phase !== 'lobby' && (
            <Panel>
              <div className="eyebrow eyebrow-heat">Cut after {cut.levelName}</div>
              <p style={{ margin: '8px 0 0', fontSize: '0.95rem' }}>
                <strong>{cut.advanced}</strong> advance (top {cut.qualifyTop}) · <strong>{cut.eliminated.length}</strong> eliminated
                {cut.eliminated.length > 0 && <span className="dim">: {cut.eliminated.slice(0, 8).map((e: any) => e.name).join(', ')}{cut.eliminated.length > 8 ? '…' : ''}</span>}
              </p>
            </Panel>
          )}

          {/* Live question */}
          {phase === 'question' && (
            <Panel bracketed>
              <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
                {gameState.currentQuestion?.hasImage ? (
                  <img src={`${serverUrl}/live-image/${gameState.currentQuestionIndex}?t=${gameState.questionStartTime}`} alt="" style={{ width: 120, height: 96, objectFit: 'contain', border: '1px solid var(--line-strong)', borderRadius: 8, background: '#fff' }} />
                ) : null}
                <TimerRing value={timeLeft} max={gameState.currentQuestion?.timeLimit || 20} size={96} stroke={5} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="eyebrow eyebrow-heat">Live question</div>
                  <p style={{ fontSize: '1.2rem', fontWeight: 600, lineHeight: 1.35, margin: '8px 0 14px' }}>{gameState.currentQuestion?.text}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="eyebrow">Answers in</span>
                    <span className="mono tabular" style={{ fontSize: '0.85rem' }}>
                      <strong className="heat">{answerCount.answered}</strong><span className="faint"> / {answerCount.total}</span>
                    </span>
                  </div>
                  <div className="meter"><span style={{ width: `${answeredPct}%` }} /></div>
                </div>
              </div>
            </Panel>
          )}
        </div>

        {/* Roster */}
        <Panel style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'calc(100svh - 120px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div className="eyebrow">{phase === 'lobby' ? 'Roster' : 'Still in'}</div>
              <div className="display tabular" style={{ fontSize: '2.6rem', marginTop: 6 }}>
                {active.length}{active.length !== players.length && <span className="faint" style={{ fontSize: '1.3rem' }}> / {players.length}</span>}
              </div>
            </div>
            <span className="chip"><span className="dot dot-live" />{online} online</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {players.length === 0 ? (
              <p className="dim" style={{ textAlign: 'center', padding: '40px 20px', margin: 0, fontSize: '0.9rem' }}>No players yet</p>
            ) : (
              players.map((p, idx) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--line)', opacity: p.connected && (p.status ?? 'active') === 'active' ? 1 : 0.5 }}>
                  <span className="mono tabular faint" style={{ width: 26, fontSize: '0.72rem' }}>{String(idx + 1).padStart(2, '0')}</span>
                  <span className={`dot ${p.connected ? 'dot-live' : ''}`} title={p.connected ? 'Online' : 'Offline'} />
                  <Avatar id={p.avatar} size={30} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    {(p.ticketId || flagged(p)) && (
                      <span className="mono faint" style={{ fontSize: '0.7rem' }}>
                        {p.ticketId}
                        {flagged(p) && (
                          <span style={{ color: 'var(--bad)', marginLeft: 6 }} title="Left the quiz screen during a question / very fast correct answers">
                            ⚠ {p.flags.away ? `left screen ×${p.flags.away} (${Math.round(p.flags.awayMs / 1000)}s)` : ''}{p.flags.away && p.flags.fastCorrect ? ' · ' : ''}{p.flags.fastCorrect ? `fast ×${p.flags.fastCorrect}` : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {p.status === 'eliminated' && <span className="pill">Out R{p.exit?.round}</span>}
                  {p.status === 'disqualified' && <span className="pill pill-warn">DQ</span>}
                  <span className="mono tabular" style={{ fontSize: '0.82rem' }}>{p.score}</span>
                  {phase === 'lobby' ? (
                    <button className="btn btn-danger btn-sm" onClick={() => kickPlayer(p.id, p.name)} aria-label={`Kick ${p.name}`}>Kick</button>
                  ) : p.status !== 'disqualified' && (
                    <button className="btn btn-danger btn-sm" onClick={() => disqualify(p.id, p.name)} aria-label={`Disqualify ${p.name}`}>DQ</button>
                  )}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// The coordinator loads the set to play (e.g. "Trial set" for a practice round, then "Main set")
// with the PIN the quiz master gave them. The questions stay hidden; they go straight to the game.
function LoadSet({ loaded, onLoaded }: { loaded: { count: number; by?: string; bank?: { id: string; name: string } | null } | null; onLoaded: (msg: string) => void }) {
  const [sets, setSets] = useState<{ id: string; name: string; ready: boolean; active: number }[]>([]);
  const [bankId, setBankId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/banks').then((list: any[]) => {
      const ready = list.filter(b => b.ready);
      setSets(ready);
      setBankId(id => id || ready[0]?.id || '');
    }).catch(err => setError(err.message));
  }, []);

  const load = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/game/load-questions', { method: 'POST', body: { bankId, pin } });
      setPin('');
      onLoaded(`Loaded "${r.bank?.name ?? 'set'}" — ${r.count} questions`);
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel bracketed>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow">Question set</div>
        {loaded?.count ? (
          <span className="pill pill-good">✓ "{loaded.bank?.name ?? 'Set'}" loaded · {loaded.count} questions{loaded.by ? ` · by ${loaded.by}` : ''}</span>
        ) : <span className="pill pill-warn">No set loaded</span>}
      </div>
      <form onSubmit={load} style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ flex: '1 1 200px' }}>
          <label className="eyebrow" htmlFor="load-set">Set</label>
          <select id="load-set" className="field field-sm" value={bankId} onChange={e => setBankId(e.target.value)}>
            {sets.length === 0 && <option value="">No sets ready — the quiz master sets them up</option>}
            {sets.map(b => <option key={b.id} value={b.id}>{b.name} · {b.active} questions</option>)}
          </select>
        </div>
        <div className="form-row" style={{ flex: '0 1 160px' }}>
          <label className="eyebrow" htmlFor="load-pin">Set PIN</label>
          <input id="load-pin" className="field field-sm" type="password" inputMode="numeric" autoComplete="off" value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em' }} />
        </div>
        <button className="btn btn-heat" disabled={busy || !bankId || pin.length < 4}>{busy ? 'Loading…' : loaded?.count ? 'Load this set instead' : 'Load set'}</button>
      </form>
      {error && <p role="alert" className="error-text" style={{ textAlign: 'left', marginTop: 10 }}>{error}</p>}
      <p className="dim" style={{ fontSize: '0.8rem', margin: '10px 0 0' }}>
        The quiz master gives you the PIN of the set to play. You never see the questions — they go straight to the game and appear on screen one at a time.
      </p>
    </Panel>
  );
}

function Panel({ children, style, bracketed }: { children: ReactNode; style?: CSSProperties; bracketed?: boolean }) {
  return (
    <section className={`panel${bracketed ? ' bracketed' : ''}`} style={{ padding: '20px 22px', ...style }}>
      {children}
    </section>
  );
}
