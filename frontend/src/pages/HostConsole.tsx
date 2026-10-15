import { useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Brand, Panel as SharedPanel, TimerRing, Toast } from '../components/ui';
import StaffLogin from '../components/StaffLogin';
import { ROLE_LABEL, session, signOut, useStaffSession } from '../lib/api';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  intro: 'Level briefing',
  question: 'Question live',
  leaderboard: 'Reveal',
  podium: 'Podium',
};

export default function HostConsole() {
  const { socket, isConnected } = useSocket();
  const current = useStaffSession();
  const token = current && current.staff.role !== 'volunteer' ? current.token : null;
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [toast, setToast] = useState('');

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
    socket.emit('join_role', 'host', token, (res: any) => {
      if (res?.error) logout(res.error);
    });
    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('answer_count');
    };
  }, [socket, token, isConnected]);

  const hostAction = (action: string, data: any = null, onSuccess?: (res: any) => void) => {
    socket.emit('host_action', action, data, (res: any) => {
      if (res?.error === 'Not authorised') logout('Session expired — please sign in again');
      else if (res?.error) showToast(res.error);
      else onSuccess?.(res);
    });
  };

  const loadQuestions = () => hostAction('load_questions', null, res =>
    showToast(`✓ Loaded ${res.count} question${res.count !== 1 ? 's' : ''}`));
  const startGame = () => hostAction('start_game');
  const startQuestion = () => hostAction('start_question');
  const endQuestion = () => hostAction('end_question');
  const kickPlayer = (id: string, name: string) => {
    if (confirm(`Remove ${name} from the game?`)) hostAction('kick_player', { playerId: id });
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

  // ─── Sign-in: quiz master or coordinator ───────────────────────────────────
  if (!current) {
    return (
      <>
        {toast && <Toast msg={toast} />}
        <StaffLogin title="Host" accent="Command" note="Quiz master or coordinator sign-in." />
      </>
    );
  }
  if (!token) {
    return (
      <div className="stage" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <SharedPanel bracketed style={{ maxWidth: 420, textAlign: 'center', padding: '32px 28px' }}>
          <h1 className="display" style={{ fontSize: '2.4rem', margin: '0 0 10px' }}>No access</h1>
          <p className="dim" style={{ margin: '0 0 20px' }}>Volunteers can't run the game. Head to the check-in scanner instead.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a className="btn btn-heat" href="/admin">Open check-in</a>
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
  const online = players.filter(p => p.connected).length;
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
                  <button className="btn btn-ghost" onClick={loadQuestions}>Reload questions</button>
                  <span className="dim" style={{ fontSize: '0.85rem' }}>
                    {total === 0 ? 'No questions loaded.' : players.length === 0 ? 'Waiting for players to join…' : `${total} questions ready · ${players.length} players`}
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
        </div>

        {/* Roster */}
        <Panel style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'calc(100svh - 120px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div className="eyebrow">Roster</div>
              <div className="display tabular" style={{ fontSize: '2.6rem', marginTop: 6 }}>{players.length}</div>
            </div>
            <span className="chip"><span className="dot dot-live" />{online} online</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {players.length === 0 ? (
              <p className="dim" style={{ textAlign: 'center', padding: '40px 20px', margin: 0, fontSize: '0.9rem' }}>No players yet</p>
            ) : (
              players.map((p, idx) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--line)', opacity: p.connected ? 1 : 0.5 }}>
                  <span className="mono tabular faint" style={{ width: 26, fontSize: '0.72rem' }}>{String(idx + 1).padStart(2, '0')}</span>
                  <span className={`dot ${p.connected ? 'dot-live' : ''}`} title={p.connected ? 'Online' : 'Offline'} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span className="mono tabular" style={{ fontSize: '0.82rem' }}>{p.score}</span>
                  <button className="btn btn-danger btn-sm" onClick={() => kickPlayer(p.id, p.name)} aria-label={`Kick ${p.name}`}>Kick</button>
                </div>
              ))
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
