import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Brand, Rings, Rise, Spinner, TimerRing, OPTION_LABELS } from '../components/ui';
import { API_BASE } from '../lib/api';
import confetti from 'canvas-confetti';

const TOKEN_KEY = 'vyuham_player_token';

// localStorage can throw (private mode, blocked storage); the game still works without it.
const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const centerRings: CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
const screenPad: CSSProperties = { width: '100%', maxWidth: 440, margin: '0 auto', padding: '0 22px' };

export default function ParticipantView() {
  const { socket, isConnected } = useSocket();
  const [name, setName] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [requireCheckin, setRequireCheckin] = useState(true);
  const [joining, setJoining] = useState(false);
  const [gameState, setGameState] = useState<any>(null);
  const [playerInfo, setPlayerInfo] = useState<any>(null);
  const [answerResult, setAnswerResult] = useState<any>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [removedOptions, setRemovedOptions] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [rejoining, setRejoining] = useState(() => !!storage.get());
  const questionIndexRef = useRef<number | null>(null);

  const timeLeft = useCountdown(
    gameState?.state === 'question' ? gameState.questionEndsAt : null,
    gameState?.serverNow,
  );
  const maxTime = gameState?.currentQuestion?.timeLimit || 20;
  const level = gameState?.currentLevel ?? 1;

  // Clear per-question UI only when a *new* question starts (not on repeated state broadcasts).
  const applyState = (state: any) => {
    setGameState(state);
    if (state.state === 'question' && state.currentQuestionIndex !== questionIndexRef.current) {
      questionIndexRef.current = state.currentQuestionIndex;
      setSelectedOption(null);
      setAnswerResult(null);
      setRemovedOptions([]);
      setMessage('');
    }
  };

  const leaveGame = (reason: string) => {
    storage.clear();
    setPlayerInfo(null);
    setGameState(null);
    setAnswerResult(null);
    setSelectedOption(null);
    questionIndexRef.current = null;
    setMessage(reason);
  };

  useEffect(() => {
    socket.on('game_state', applyState);
    socket.on('kicked', () => {
      leaveGame('You were removed by the host.');
      setTimeout(() => socket.connect(), 500); // the server closed our connection
    });
    socket.on('game_reset', () => leaveGame('The game was reset. Join again to play.'));
    return () => {
      socket.off('game_state');
      socket.off('kicked');
      socket.off('game_reset');
    };
  }, [socket]);

  // Reclaim our seat after a refresh or a dropped connection.
  useEffect(() => {
    if (!isConnected) return;
    const token = storage.get();
    if (!token) {
      setRejoining(false);
      return;
    }
    socket.emit('rejoin_game', token, (res: any) => {
      setRejoining(false);
      if (!res?.success) {
        storage.clear();
        return;
      }
      setPlayerInfo(res.player);
      questionIndexRef.current = res.gameState.currentQuestionIndex;
      setGameState(res.gameState);
      setSelectedOption(res.myAnswer?.answer ?? null);
      setAnswerResult(res.myAnswer);
    });
  }, [socket, isConnected]);

  // Whether players join with a ticket ID (check-in required) or just a name.
  useEffect(() => {
    fetch(`${API_BASE}/api/config`).then(r => r.json()).then(c => setRequireCheckin(c.requireCheckin !== false)).catch(() => {});
    const onConfig = (c: any) => setRequireCheckin(c.requireCheckin !== false);
    socket.on('config', onConfig);
    return () => { socket.off('config', onConfig); };
  }, [socket]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (requireCheckin ? !ticketId.trim() : !name.trim()) return;
    setMessage('');
    setJoining(true);
    const payload = requireCheckin ? { ticketId: ticketId.trim(), name: name.trim() } : { name: name.trim() };
    socket.emit('join_game', payload, (res: any) => {
      setJoining(false);
      if (res.success) {
        storage.set(res.token);
        setPlayerInfo(res.player);
      } else {
        setMessage(res.error);
      }
    });
  };

  const handleAnswer = (option: string) => {
    if (selectedOption || gameState?.state !== 'question') return;
    setSelectedOption(option);
    socket.emit('submit_answer', option, (res: any) => {
      if (!res.success) {
        setSelectedOption(null);
        setMessage(res.error);
        return;
      }
      setAnswerResult(res);
      setPlayerInfo((prev: any) => ({ ...prev, score: (prev?.score ?? 0) + res.points }));
      if (res.isCorrect) {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 }, colors: ['#3da9fc', '#ff5c8a', '#ffc531', '#3ddc97'] });
        if (navigator.vibrate) navigator.vibrate(150);
      } else {
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      }
    });
  };

  const useDrone = () => {
    if ((playerInfo?.droneAssists ?? 0) <= 0) return;
    socket.emit('use_drone', (res: any) => {
      if (res.success) {
        setPlayerInfo((prev: any) => ({ ...prev, droneAssists: res.droneAssists }));
        setRemovedOptions(res.removedOptions);
      } else {
        setMessage(res.error);
      }
    });
  };

  // ─── Connecting ────────────────────────────────────────────────────────────
  if (!isConnected || rejoining) {
    return <Spinner label={playerInfo ? 'Reconnecting…' : 'Connecting…'} />;
  }

  // ─── Join ──────────────────────────────────────────────────────────────────
  if (!playerInfo) {
    return (
      <div className="stage stage-grid" data-level="1">
        <Rings size="min(150vw, 760px)" style={{ top: '-16%', left: '50%', transform: 'translateX(-50%)' }} />
        <header style={{ ...screenPad, paddingTop: 22, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand event={false} />
          <span className="eyebrow">Vyuham '26</span>
        </header>

        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 36 }}>
          <Rise d={60} className="eyebrow eyebrow-heat">● Live tech quiz</Rise>
          <Rise d={140} as="h1" className="display" style={{ fontSize: 'clamp(4.2rem, 23vw, 7rem)', margin: '14px 0 16px' }}>
            Tech<br />Sprint
          </Rise>
          <Rise d={240} as="p" className="dim" style={{ margin: '0 0 28px', fontSize: '1rem', lineHeight: 1.5 }}>
            Three levels. Rising stakes. Answer fast — the quickest minds take the lead.
          </Rise>

          <Rise d={340}>
            <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {requireCheckin && (
                <>
                  <label htmlFor="player-ticket" className="eyebrow">Ticket ID (on your pass)</label>
                  <input
                    id="player-ticket"
                    className="field"
                    type="text"
                    value={ticketId}
                    onChange={(e) => setTicketId(e.target.value.toUpperCase())}
                    maxLength={40}
                    placeholder="e.g. MMP49081761"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
                  />
                </>
              )}
              <label htmlFor="player-name" className="eyebrow">
                {requireCheckin ? 'Leaderboard name (optional)' : 'Your call sign'}
              </label>
              <input
                id="player-name"
                className="field"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder={requireCheckin ? 'Defaults to your first name' : 'Name or nickname'}
                autoComplete="nickname"
                required={!requireCheckin}
              />
              <button type="submit" className="btn btn-heat btn-lg btn-block" disabled={joining}>
                {joining ? 'Checking ticket…' : 'Join game →'}
              </button>
              {message && <p role="alert" className="error-text">{message}</p>}
            </form>
          </Rise>
        </main>
      </div>
    );
  }

  // ─── Lobby ─────────────────────────────────────────────────────────────────
  if (!gameState || gameState.state === 'lobby') {
    return (
      <div className="stage stage-grid" data-level="1">
        <Rings size="min(160vw, 720px)" style={centerRings} />
        <header style={{ ...screenPad, paddingTop: 22 }}><Brand /></header>
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Rise className="eyebrow eyebrow-heat">You're on the starting line</Rise>
          <h1 className="display slam" style={{ fontSize: 'clamp(3.4rem, 18vw, 6rem)', margin: '16px 0 18px', overflowWrap: 'anywhere', ['--d' as string]: '120ms' }}>
            {playerInfo.name}
          </h1>
          <Rise d={300} as="p" className="dim" style={{ margin: 0, lineHeight: 1.6 }}>
            Waiting for the host to begin.<br />Keep your eyes on the big screen.
          </Rise>
          <Rise d={420} style={{ marginTop: 36 }}>
            <span className="chip">½ 50/50 lifelines × {playerInfo.droneAssists}</span>
          </Rise>
        </main>
      </div>
    );
  }

  // ─── Level intro ───────────────────────────────────────────────────────────
  if (gameState.state === 'intro') {
    return (
      <div className="stage stage-grid" data-level={level}>
        <Rings size="min(170vw, 760px)" style={centerRings} />
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Rise className="eyebrow">Level</Rise>
          <div className="display heat slam" style={{ fontSize: 'clamp(9rem, 55vw, 14rem)', lineHeight: 0.8, margin: '8px 0 6px' }}>
            {String(level).padStart(2, '0')}
          </div>
          <Rise d={250} as="h2" className="display" style={{ fontSize: 'clamp(2.4rem, 12vw, 3.6rem)' }}>{gameState.levelConfig?.name}</Rise>
          <Rise d={400} style={{ marginTop: 26 }}>
            <span className="chip chip-heat">× {gameState.levelConfig?.multiplier} points</span>
          </Rise>
        </main>
      </div>
    );
  }

  // ─── Question ──────────────────────────────────────────────────────────────
  if (gameState.state === 'question') {
    const q = gameState.currentQuestion;
    const timeUp = timeLeft <= 0;
    return (
      <div className="stage" data-level={level}>
        <header style={{ ...screenPad, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 22px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div className="eyebrow">Question</div>
            <div className="display" style={{ fontSize: '2.2rem', marginTop: 4 }}>
              {gameState.currentQuestionIndex + 1}<span className="faint" style={{ fontSize: '1.3rem' }}> / {gameState.totalQuestions}</span>
            </div>
          </div>
          <span className="chip chip-heat">Lvl {level} · {gameState.levelConfig?.name}</span>
          <TimerRing value={timeLeft} max={maxTime} size={60} />
        </header>

        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 18, paddingBottom: 18 }}>
          <p className="eyebrow" style={{ margin: '0 0 14px', textAlign: 'center' }}>Read the question on the big screen</p>

          <div style={{ flex: 1, maxHeight: 560, display: 'grid', gridAutoRows: 'minmax(68px, 1fr)', gap: 10 }}>
            {q?.options?.map((opt: string, idx: number) => {
              const isSelected = selectedOption === opt;
              const isRemoved = removedOptions.includes(opt);
              const isDisabled = selectedOption !== null || isRemoved || timeUp;
              let cls = 'opt-btn pop';
              if (isSelected) cls += ' selected';
              else if (isRemoved) cls += ' removed';
              else if (isDisabled) cls += ' faded';
              return (
                <button
                  key={idx}
                  data-opt={idx}
                  className={cls}
                  style={{ ['--d' as string]: `${idx * 70}ms` }}
                  onClick={() => handleAnswer(opt)}
                  disabled={isDisabled}
                >
                  <span className="opt-label">{OPTION_LABELS[idx]}</span>
                  <span className="opt-text">{opt}</span>
                </button>
              );
            })}
          </div>

          {message && <p role="alert" className="error-text" style={{ marginTop: 14 }}>{message}</p>}

          <div style={{ marginTop: 'auto', paddingTop: 20, textAlign: 'center' }}>
            {!selectedOption && !timeUp && q?.type === 'mcq' && removedOptions.length === 0 && (
              <button className="chip" onClick={useDrone} disabled={(playerInfo?.droneAssists ?? 0) <= 0}>
                ½ Use 50/50 · {playerInfo?.droneAssists ?? 0} left
              </button>
            )}
            {(selectedOption || timeUp) && (
              <p className="eyebrow" style={{ margin: 0 }}>
                {selectedOption ? '● Answer locked in — awaiting reveal' : "Time's up — awaiting reveal"}
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ─── Podium: final rank ────────────────────────────────────────────────────
  if (gameState.state === 'podium') {
    const board: any[] = gameState.finalLeaderboard || [];
    const rank = board.findIndex(p => p.id === playerInfo.id) + 1;
    const me = board[rank - 1];
    const medal = rank === 1 ? 'Champion' : rank === 2 ? 'Runner-up' : rank === 3 ? 'Third place' : 'Final standing';
    return (
      <div className="stage stage-grid">
        <Rings size="min(170vw, 760px)" style={centerRings} />
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Rise className="eyebrow eyebrow-heat">{medal}</Rise>
          {rank > 0 ? (
            <>
              <div className="display heat slam" style={{ fontSize: 'clamp(9rem, 50vw, 13rem)', lineHeight: 0.85, margin: '10px 0' }}>
                <span style={{ fontSize: '0.45em', verticalAlign: 'top' }}>#</span>{rank}
              </div>
              <Rise d={300} as="p" className="dim" style={{ margin: 0 }}>of {board.length} players</Rise>
              <Rise d={420} className="panel bracketed" style={{ marginTop: 28, padding: '16px 28px' }}>
                <div className="eyebrow">Final score</div>
                <div className="display tabular" style={{ fontSize: '2.8rem', marginTop: 6 }}>{me?.score ?? 0}</div>
              </Rise>
            </>
          ) : (
            <h1 className="display" style={{ fontSize: '4rem', marginTop: 12 }}>Game over</h1>
          )}
          <Rise d={560} as="p" className="eyebrow" style={{ marginTop: 32 }}>Thanks for playing TechSprint · Vyuham '26</Rise>
        </main>
      </div>
    );
  }

  // ─── Reveal: result of the last question ───────────────────────────────────
  if (gameState.state === 'leaderboard') {
    const isCorrect = answerResult?.isCorrect;
    const notAnswered = !answerResult;
    const tone = notAnswered ? 'var(--bone-dim)' : isCorrect ? 'var(--good)' : 'var(--bad)';
    const headline = notAnswered ? 'Too slow' : isCorrect ? 'Correct' : 'Wrong';
    return (
      <div className="stage" data-level={level} style={{ ['--heat' as string]: tone }}>
        <Rings size="min(170vw, 760px)" style={{ ...centerRings, top: '42%' }} />
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div className="display heat pop" style={{ fontSize: '5.5rem', lineHeight: 1 }} aria-hidden="true">
            {notAnswered ? '⧗' : isCorrect ? '✓' : '✕'}
          </div>
          <h1 className="display heat slam" style={{ fontSize: 'clamp(4rem, 22vw, 6.5rem)', margin: '8px 0 10px', ['--d' as string]: '80ms' }}>{headline}</h1>

          {isCorrect ? (
            <>
              <Rise d={250} className="display tabular" style={{ fontSize: '2.6rem' }}>+{answerResult.points}</Rise>
              {answerResult.badge && (
                <Rise d={380} style={{ marginTop: 16 }}><span className="chip chip-gold">★ {answerResult.badge}</span></Rise>
              )}
            </>
          ) : (
            <Rise d={250} as="p" className="dim" style={{ margin: 0 }}>
              {notAnswered ? "You didn't answer in time." : '0 points this round. Streak reset.'}
            </Rise>
          )}

          <Rise d={480} className="panel bracketed" style={{ marginTop: 40, padding: '16px 28px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="eyebrow">Your total</span>
              <span className="display tabular" style={{ fontSize: '2.2rem' }}>{playerInfo.score ?? 0}</span>
            </div>
          </Rise>
          <Rise d={560} as="p" className="eyebrow" style={{ marginTop: 18 }}>Standings are on the big screen</Rise>
        </main>
      </div>
    );
  }

  return null;
}
