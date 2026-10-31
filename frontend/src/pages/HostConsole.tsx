import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Brand, Panel as SharedPanel, TimerRing, Toast, Avatar } from '../components/ui';
import StaffLogin from '../components/StaffLogin';
import { CAN_HOST, ROLE_LABEL, session, signOut, useStaffSession } from '../lib/api';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  intro: 'Level briefing',
  video: 'Video playing',
  question: 'Question live',
  leaderboard: 'Reveal',
  podium: 'Podium',
};

// Scoring options the coordinator sets in the lobby (see gameEngine DEFAULT_RULES). All ticked except
// round reset = the original rules.
const VIDEO_STATUS: Record<string, string> = {
  playing: 'Video playing.',
  paused: 'Video paused.',
  ended: 'Video finished.',
  error: 'The video could not play on the projector.',
};

const SCORING_RULES = [
  { key: 'multiplier', label: 'Level multipliers', hint: "Each level's points ×. Off: every level counts ×1." },
  { key: 'firstBlood', label: 'First-to-answer bonus', hint: '+20% for the first correct answer on each question.' },
  { key: 'streak', label: 'Streak bonus', hint: '+10% for each correct answer once a player has 3 in a row.' },
  { key: 'roundReset', label: 'Reset points every round', hint: 'Everyone still in starts each round at 0; the cut uses that round\'s points.' },
];

export default function HostConsole() {
  const { socket, isConnected } = useSocket();
  const current = useStaffSession();
  const token = current && CAN_HOST.includes(current.staff.role) ? current.token : null;
  const [loaded, setLoaded] = useState<{ count: number; by?: string } | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [toast, setToast] = useState('');
  // The latest cut after a level: who advanced and who was eliminated.
  const [cut, setCut] = useState<any>(null);
  const [pendingCut, setPendingCut] = useState<any>(null);
  const [backups, setBackups] = useState<{ id: number; text: string; used: boolean }[]>([]);
  const [videoStatus, setVideoStatus] = useState('');

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
    socket.on('game_state', (state: any) => {
      setGameState(state);
      if (state.state !== 'video') setVideoStatus('');
    });
    socket.on('players_list', setPlayers);
    socket.on('answer_count', setAnswerCount);
    socket.on('questions_loaded', setLoaded);
    socket.on('question_result', (r: any) => { if (r?.elimination) setCut(r.elimination); });
    socket.on('cut_pending', setPendingCut);
    socket.on('backups', setBackups);
    socket.on('video_status', setVideoStatus);
    socket.on('cut_result', (data: any) => {
      setPendingCut(null);
      if (data?.elimination) setCut(data.elimination);
    });
    socket.on('game_reset', () => {
      setCut(null);
      setPendingCut(null);
    });
    socket.emit('join_role', 'host', token, (res: any) => {
      if (res?.error) logout(res.error);
    });
    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('answer_count');
      socket.off('questions_loaded');
      socket.off('question_result');
      socket.off('cut_pending');
      socket.off('backups');
      socket.off('video_status');
      socket.off('cut_result');
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
  const videoControl = (action: 'play' | 'pause' | 'replay') => hostAction('video_control', { action });
  const cancelQuestion = () => {
    if (confirm('Cancel this question? Answers are dropped and it does not count for anyone.')) hostAction('cancel_question');
  };
  const playBackup = (id: number) => {
    if (confirm('Play this backup in place of the cancelled question? It starts straight away.')) hostAction('use_backup', { id });
  };
  const adjustCut = (id: string, keep: boolean) => hostAction('cut_adjust', { playerId: id, keep });
  const confirmCut = () => {
    if (!pendingCut) return;
    if (!confirm(`Confirm the cut? ${pendingCut.out.length} player(s) will be eliminated and ${pendingCut.advance.length} go through.`)) return;
    hostAction('cut_confirm', null, (r: any) => showToast(`Cut confirmed — ${r.eliminated} eliminated`));
  };
  const kickPlayer = (id: string, name: string) => {
    if (confirm(`Remove ${name} from the lobby?`)) hostAction('kick_player', { playerId: id });
  };
  // Take one player out of the game: they keep their rank and see "Eliminated" on their phone.
  const eliminate = (id: string, name: string) => {
    const reason = prompt(`Eliminate ${name}? They keep their rank and see "Eliminated" on their phone.`, 'Eliminated by the quiz host');
    if (reason === null) return;
    hostAction('eliminate_player', { playerId: id, reason: reason.trim() || 'Eliminated by the quiz host' }, () => showToast(`${name} eliminated`));
  };
  // Malpractice only: the player loses their rank and sees "Disqualified", kept on record with a reason.
  const disqualify = (id: string, name: string) => {
    const reason = prompt(`Disqualify ${name} for malpractice? They lose their rank and see "Disqualified". Reason (e.g. "Using another device"):`, 'Malpractice');
    if (reason === null) return;
    hostAction('disqualify_player', { playerId: id, reason: reason.trim() || 'Disqualified by the quiz host' }, () => showToast(`${name} disqualified`));
  };
  const toggleFinalStandings = (hide: boolean) => hostAction('set_hide_final_standings', { hide },
    () => showToast(hide ? 'Standings hidden in the final round' : 'Standings shown in the final round'));
  const setRule = (key: string, on: boolean) => hostAction('set_scoring_rules', { rules: { [key]: on } },
    () => showToast('Scoring rules updated'));
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
            <a className="btn btn-heat" href={`${import.meta.env.BASE_URL}admin`}>Open admin panel</a>
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

  // Players who are out, grouped by the round they went out in (latest round first), then the disqualified.
  const eliminated = players.filter(p => p.status === 'eliminated');
  const outRounds = [...new Set(eliminated.map(p => p.exit?.round ?? 0))].sort((a, b) => b - a).map(round => {
    const group = eliminated.filter(p => (p.exit?.round ?? 0) === round).sort((a, b) => (a.exit?.rank ?? 0) - (b.exit?.rank ?? 0));
    return { round, levelName: group[0]?.exit?.levelName, players: group };
  });
  const disqualified = players.filter(p => p.status === 'disqualified');

  const groupHeader = (label: string, count: number, color?: string) => (
    <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px 8px', background: 'var(--ink-2)', borderBottom: '1px solid var(--line)', color }}>
      <span>{label}</span><span className="mono tabular">{count}</span>
    </div>
  );

  // num: current rank for players still in, rank when they went out for the eliminated.
  const playerRow = (p: any, num: string) => (
    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--line)', opacity: p.connected && (p.status ?? 'active') === 'active' ? 1 : 0.55 }}>
      <span className="mono tabular faint" style={{ width: 26, fontSize: '0.72rem' }}>{num}</span>
      <span className={`dot ${p.connected ? 'dot-live' : ''}`} title={p.connected ? 'Online' : 'Offline'} />
      <Avatar id={p.avatar} size={30} style={p.status === 'active' ? undefined : { filter: 'grayscale(1)' }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        {(p.ticketId || flagged(p) || p.exit?.note) && (
          <span className="mono faint" style={{ display: 'block', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.ticketId}
            {p.status !== 'active' && p.exit?.note && <span style={{ marginLeft: p.ticketId ? 6 : 0 }}>{p.exit.note}</span>}
            {flagged(p) && (
              <span style={{ color: 'var(--bad)', marginLeft: 6 }} title="Left the quiz screen during a question / very fast correct answers">
                ⚠ {p.flags.away ? `left screen ×${p.flags.away} (${Math.round(p.flags.awayMs / 1000)}s)` : ''}{p.flags.away && p.flags.fastCorrect ? ' · ' : ''}{p.flags.fastCorrect ? `fast ×${p.flags.fastCorrect}` : ''}
              </span>
            )}
          </span>
        )}
      </span>
      {p.status === 'eliminated' && <span className="pill" title={p.exit?.note}>{p.exit?.reason === 'cut' ? 'Cut' : 'By host'}</span>}
      {p.status === 'disqualified' && <span className="pill pill-warn" title={p.exit?.note}>DQ</span>}
      <span className="mono tabular" style={{ fontSize: '0.82rem' }}>{p.score}</span>
      {phase === 'lobby' ? (
        <button className="btn btn-danger btn-sm" onClick={() => kickPlayer(p.id, p.name)} aria-label={`Kick ${p.name}`}>Kick</button>
      ) : (
        <>
          {p.status === 'active' && (
            <button className="btn btn-ghost btn-sm" onClick={() => eliminate(p.id, p.name)} aria-label={`Eliminate ${p.name}`}>Eliminate</button>
          )}
          {p.status !== 'disqualified' && (
            <button className="btn btn-danger btn-sm" onClick={() => disqualify(p.id, p.name)} aria-label={`Disqualify ${p.name} for malpractice`} title="Disqualify (malpractice)">DQ</button>
          )}
        </>
      )}
    </div>
  );

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
        <a className="btn btn-ghost btn-sm" href={`${import.meta.env.BASE_URL}admin`}>Admin</a>
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
                <span className="chip chip-heat">Level {level} · {gameState?.levelConfig?.name ?? '—'}</span>
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
                      ? 'Waiting for the quiz master to load the questions (Admin → Questions → Load into game).'
                      : `${total} questions loaded${loaded?.by ? ` by ${loaded.by}` : ''} · ${players.length === 0 ? 'waiting for players to join…' : `${players.length} players`}`}
                  </span>
                </>
              )}
              {(phase === 'intro' || phase === 'leaderboard') && (
                <>
                  <button className="btn btn-heat btn-lg" onClick={startQuestion} disabled={!!pendingCut}>
                    {isFinalReveal ? 'Show final results →' : phase === 'intro' ? 'Launch first question →' : 'Next question →'}
                  </button>
                  {pendingCut && <span className="dim" style={{ fontSize: '0.85rem' }}>Review and confirm the cut below first.</span>}
                </>
              )}
              {phase === 'video' && (
                <>
                  <button className="btn btn-heat btn-lg" onClick={startQuestion}>Start question →</button>
                  {videoStatus === 'paused'
                    ? <button className="btn btn-ghost btn-lg" onClick={() => videoControl('play')}>Play</button>
                    : <button className="btn btn-ghost btn-lg" onClick={() => videoControl('pause')} disabled={videoStatus === 'ended'}>Pause</button>}
                  <button className="btn btn-ghost btn-lg" onClick={() => videoControl('replay')}>Replay</button>
                  <button className="btn btn-danger btn-lg" onClick={cancelQuestion}>Cancel question</button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>
                    {VIDEO_STATUS[videoStatus] ?? 'Video on the projector.'} The question and timer start only when you press Start question.
                  </span>
                </>
              )}
              {phase === 'question' && (
                <>
                  <button className="btn btn-ghost btn-lg" onClick={endQuestion}>End now &amp; reveal</button>
                  <button className="btn btn-danger btn-lg" onClick={cancelQuestion}>Cancel question</button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>Ends automatically when the timer runs out.</span>
                </>
              )}
              {phase === 'podium' && (
                <span className="dim">Game complete — results saved. Use <strong className="heat">Reset game</strong> to run another round.</span>
              )}
            </div>
            {gameState?.cancelled && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Question cancelled · replace it with a backup</div>
                {!gameState.canUseBackup && <p className="dim" style={{ margin: 0, fontSize: '0.85rem' }}>No backup available. Carry on with the next move.</p>}
                {gameState.canUseBackup && backups.filter(b => !b.used).map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.88rem', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{b.text.replace(/\*/g, '')}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => playBackup(b.id)}>Play backup</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)', fontSize: '0.88rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!gameState?.hideFinalStandings}
                onChange={e => toggleFinalStandings(e.target.checked)}
              />
              <span>
                Hide standings in the final round
                <span className="dim" style={{ display: 'block', fontSize: '0.78rem' }}>
                  The projector keeps the leaderboard hidden during the last round; it's revealed on the final results.
                  {gameState?.standingsHidden && <strong className="heat"> Hidden now.</strong>}
                </span>
              </span>
            </label>
            {gameState?.rules && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>
                  Scoring rules{phase !== 'lobby' && <span className="dim"> · fixed for this game</span>}
                </div>
                {SCORING_RULES.map(r => (
                  <label key={r.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 8, fontSize: '0.88rem', cursor: phase === 'lobby' ? 'pointer' : 'default' }}>
                    <input
                      type="checkbox"
                      checked={!!gameState.rules[r.key]}
                      disabled={phase !== 'lobby'}
                      onChange={e => setRule(r.key, e.target.checked)}
                    />
                    <span>
                      {r.label}
                      <span className="dim" style={{ display: 'block', fontSize: '0.78rem' }}>{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Panel>

          {/* End-of-level cut: review, adjust, confirm */}
          {pendingCut && phase !== 'lobby' && (
            <CutReview cut={pendingCut} onAdjust={adjustCut} onConfirm={confirmCut} />
          )}

          {cut && !pendingCut && phase !== 'lobby' && (
            <Panel>
              <div className="eyebrow eyebrow-heat">Cut after {cut.levelName}</div>
              <p style={{ margin: '8px 0 0', fontSize: '0.95rem' }}>
                <strong>{cut.advanced}</strong> advance · <strong>{cut.eliminated.length}</strong> eliminated
                {cut.eliminated.length > 0 && <span className="dim">: {cut.eliminated.slice(0, 8).map((e: any) => e.name).join(', ')}{cut.eliminated.length > 8 ? '…' : ''}</span>}
              </p>
            </Panel>
          )}

          {/* Live question */}
          {phase === 'question' && (
            <Panel bracketed>
              <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
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
          {phase !== 'lobby' && players.length > 0 && <PlayerDashboard players={players} />}
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
              <>
                {active.map((p, idx) => playerRow(p, String(idx + 1).padStart(2, '0')))}
                {outRounds.map(g => (
                  <div key={g.round}>
                    {groupHeader(`Out in round ${g.round}${g.levelName ? ` · ${g.levelName}` : ''}`, g.players.length)}
                    {g.players.map(p => playerRow(p, `#${p.exit?.rank ?? '–'}`))}
                  </div>
                ))}
                {disqualified.length > 0 && (
                  <>
                    {groupHeader('Disqualified', disqualified.length, 'var(--bad)')}
                    {disqualified.map(p => playerRow(p, '—'))}
                  </>
                )}
              </>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ children, style, bracketed }: { children: ReactNode; style?: CSSProperties; bracketed?: boolean }) {
  return (
    <section className={`panel${bracketed ? ' bracketed' : ''}`} style={{ padding: '20px 22px', ...style }}>
      {children}
    </section>
  );
}

// The proposed cut at the end of a level: who goes through, who is out. The coordinator can move
// anyone across the line, then confirms; nobody is eliminated until then.
// Every player's answers over the whole game, in rank order, plus the totals.
function PlayerDashboard({ players }: { players: any[] }) {
  const sum = (key: string) => players.reduce((n, p) => n + (p.answers?.[key] ?? 0), 0);
  const STATUS: Record<string, string> = { active: 'In', eliminated: 'Out', disqualified: 'DQ' };
  const cell: CSSProperties = { padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' };
  return (
    <Panel style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '16px 20px' }}>
        <div className="eyebrow">Player dashboard</div>
        <span className="mono tabular" style={{ fontSize: '0.8rem' }}>
          <strong style={{ color: 'var(--good)' }}>{sum('correct')} right</strong> · <span style={{ color: 'var(--bad)' }}>{sum('wrong')} wrong</span> · <span className="dim">{sum('skipped')} skipped</span>
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
        <thead>
          <tr className="eyebrow" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
            <th style={{ ...cell, textAlign: 'left', paddingLeft: 20 }}>#</th>
            <th style={{ ...cell, textAlign: 'left' }}>Player</th>
            <th style={cell}>Status</th><th style={cell}>Score</th><th style={cell}>Right</th><th style={cell}>Wrong</th><th style={cell}>Skipped</th>
            <th style={{ ...cell, paddingRight: 20 }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ ...cell, textAlign: 'left', paddingLeft: 20 }} className="mono tabular">{i + 1}</td>
              <td style={{ ...cell, textAlign: 'left', fontWeight: 600, whiteSpace: 'normal' }}>{p.name}</td>
              <td style={cell}>{STATUS[p.status] ?? p.status}</td>
              <td style={cell} className="mono tabular">{p.score}</td>
              <td style={{ ...cell, color: 'var(--good)' }} className="mono tabular">{p.answers?.correct ?? 0}</td>
              <td style={{ ...cell, color: 'var(--bad)' }} className="mono tabular">{p.answers?.wrong ?? 0}</td>
              <td style={cell} className="mono tabular dim">{p.answers?.skipped ?? 0}</td>
              <td style={{ ...cell, paddingRight: 20 }} className="mono tabular dim">{((p.time ?? 0) / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function CutReview({ cut, onAdjust, onConfirm }: { cut: any; onAdjust: (id: string, keep: boolean) => void; onConfirm: () => void }) {
  const row = (p: any, keep: boolean) => (
    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: '0.88rem' }}>
      <span className="mono faint" style={{ width: 26 }}>#{p.rank}</span>
      <Avatar id={p.avatar} size={24} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
      <span className="mono tabular" style={{ fontSize: '0.8rem' }}>{p.score}</span>
      <span className="mono faint" style={{ fontSize: '0.72rem' }} title="Correct answers in this level">✓{p.correctInLevel}</span>
      <button className={`btn btn-sm ${keep ? 'btn-danger' : 'btn-ghost'}`} onClick={() => onAdjust(p.id, !keep)}>{keep ? 'Remove' : 'Keep'}</button>
    </div>
  );
  return (
    <Panel bracketed>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow eyebrow-heat">Cut after {cut.levelName}</div>
          <div style={{ fontWeight: 700, marginTop: 6 }}>{cut.label}{cut.ties === 'include' ? ' · ties go through' : ' · ties: faster player'}</div>
        </div>
        <button className="btn btn-heat" onClick={onConfirm}>Confirm cut · {cut.out.length} out</button>
      </div>
      <div className="grid-2" style={{ marginTop: 14, gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Going through ({cut.advance.length})</div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>{cut.advance.map((p: any) => row(p, true))}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--bad)' }}>Out ({cut.out.length})</div>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>{cut.out.length ? cut.out.map((p: any) => row(p, false)) : <p className="dim" style={{ fontSize: '0.85rem' }}>Nobody</p>}</div>
        </div>
      </div>
      <p className="dim" style={{ fontSize: '0.8rem', margin: '12px 0 0' }}>
        Nobody is eliminated until you confirm. The projector shows "The cut is coming…" meanwhile.
      </p>
    </Panel>
  );
}

