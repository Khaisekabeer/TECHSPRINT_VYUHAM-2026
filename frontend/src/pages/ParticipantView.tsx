import React, { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Avatar, Brand, Rings, Rise, Spinner, TimerRing, OPTION_LABELS } from '../components/ui';
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
  // Continuing on a new device: the server asks for the last 4 digits of the registered phone.
  const previewMode = new URLSearchParams(window.location.search).get('preview');
  const mock = previewMode ? ({
    first: {
      gameState: { state: 'leaderboard', currentLevel: 1 },
      playerInfo: { name: 'Aarav Nair', score: 1420 },
      answerResult: { isCorrect: true, points: 108, badge: '1st to Answer' },
    },
    streak: {
      gameState: { state: 'leaderboard', currentLevel: 1 },
      playerInfo: { name: 'Diya Menon', score: 1280 },
      answerResult: { isCorrect: true, points: 95, badge: 'Streak Master' },
    },
    leaderboard: {
      gameState: { state: 'leaderboard', currentLevel: 1 },
      playerInfo: { name: 'Aarav Nair', score: 1420 },
      answerResult: { isCorrect: true, points: 108, badge: '1st to Answer' },
    },
    wrong: {
      gameState: { state: 'leaderboard', currentLevel: 1 },
      playerInfo: { name: 'Rohan Pillai', score: 1150 },
      answerResult: { isCorrect: false, points: 0, badge: null },
    },
  } as Record<string, any>)[previewMode] : null;

  const [needsVerify, setNeedsVerify] = useState(false);
  const [verify, setVerify] = useState('');
  const [requireCheckin, setRequireCheckin] = useState(true);
  const [joining, setJoining] = useState(false);
  const [gameState, setGameState] = useState<any>(mock?.gameState || null);
  const [playerInfo, setPlayerInfo] = useState<any>(mock?.playerInfo || null);
  const [answerResult, setAnswerResult] = useState<any>(mock?.answerResult || null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  // End of a round: { round, levelName, isFinal, cutPending, cutLabel, eliminated } until the next question.
  const [roundEnd, setRoundEnd] = useState<any>(null);
  // Our place among the players still in: { rank, of, atRisk, cutLabel }.
  const [standing, setStanding] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [rejoining, setRejoining] = useState(() => !mock && !!storage.get());
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
    if (state.state !== 'leaderboard') setRoundEnd(null);
    if (state.state === 'question' && state.currentQuestionIndex !== questionIndexRef.current) {
      questionIndexRef.current = state.currentQuestionIndex;
      setSelectedOption(null);
      setAnswerResult(null);
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
    if (previewMode) return;
    socket.on('game_state', applyState);
    socket.on('kicked', () => {
      leaveGame('You were removed by the host.');
      setTimeout(() => socket.connect(), 500); // the server closed our connection
    });
    socket.on('game_reset', () => leaveGame('The game was reset. Join again to play.'));
    // Our own result for the question that just ended.
    socket.on('my_result', (res: any) => {
      setPlayerInfo(res.player);
      setAnswerResult(res.myAnswer);
      setStanding(res.standing ?? null);
      setRoundEnd(res.roundEnd ?? null);
      if (res.myAnswer?.isCorrect) {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 }, colors: ['#3da9fc', '#ff5c8a', '#ffc531', '#3ddc97'] });
        if (navigator.vibrate) navigator.vibrate(150);
      } else if (res.myAnswer) {
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      }
    });
    // Status changes outside a reveal: eliminated or disqualified by the host, or the end-of-round cut.
    socket.on('player_update', (res: any) => {
      setPlayerInfo(res.player);
      setStanding(res.standing ?? null);
      if (!res.roundEnd) return;
      setRoundEnd(res.roundEnd);
      if (res.player?.status === 'active') {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ['#3da9fc', '#ff5c8a', '#ffc531', '#3ddc97'] });
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      } else if (navigator.vibrate) {
        navigator.vibrate(400);
      }
    });
    return () => {
      socket.off('game_state');
      socket.off('kicked');
      socket.off('game_reset');
      socket.off('my_result');
      socket.off('player_update');
    };
  }, [socket]);

  // Tell the server when the quiz page is hidden during a question (switching apps or tabs).
  // Staff see it as a flag; nothing happens automatically.
  const answering = !!playerInfo && playerInfo.status === 'active' && gameState?.state === 'question';
  useEffect(() => {
    if (!answering) return;
    const report = () => socket.emit('screen', { hidden: document.visibilityState === 'hidden' });
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [socket, answering]);

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
      setStanding(res.standing ?? null);
      setRoundEnd(res.roundEnd ?? null);
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
    const payload = requireCheckin
      ? { ticketId: ticketId.trim(), name: name.trim(), ...(needsVerify ? { verify: verify.trim() } : {}) }
      : { name: name.trim() };
    socket.emit('join_game', payload, (res: any) => {
      setJoining(false);
      if (res.success) {
        storage.set(res.token);
        setPlayerInfo(res.player);
        setNeedsVerify(false);
        setVerify('');
      } else {
        if (res.needsVerify) setNeedsVerify(true);
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
      // Right/wrong is only revealed when the question ends (my_result).
      setAnswerResult({ answer: option, success: true });
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
            Round by round, the stakes rise. Answer fast — the quickest minds take the lead.
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
                    onChange={(e) => { setTicketId(e.target.value.toUpperCase()); setNeedsVerify(false); setVerify(''); }}
                    maxLength={40}
                    placeholder="e.g. MMP49081761"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
                  />
                  {needsVerify && (
                    <>
                      <label htmlFor="player-verify" className="eyebrow">Last 4 digits of your registered phone</label>
                      <input
                        id="player-verify"
                        className="field"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        value={verify}
                        onChange={(e) => setVerify(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••"
                        autoComplete="off"
                        required
                        autoFocus
                        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em' }}
                      />
                    </>
                  )}
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
          <Rise d={60} style={{ marginTop: 18 }}><Avatar id={playerInfo.avatar} size={96} /></Rise>
          <h1 className="display slam" style={{ fontSize: 'clamp(3.4rem, 18vw, 6rem)', margin: '16px 0 18px', overflowWrap: 'anywhere', ['--d' as string]: '120ms' }}>
            {playerInfo.name}
          </h1>
          <Rise d={300} as="p" className="dim" style={{ margin: 0, lineHeight: 1.6 }}>
            Waiting for the host to begin.<br />Keep your eyes on the big screen.
          </Rise>
        </main>
      </div>
    );
  }

  // ─── Out of the game: cut after a round, eliminated by the host, or disqualified ──
  if (playerInfo.status && playerInfo.status !== 'active' && gameState.state !== 'podium') {
    const exit = playerInfo.exit || {};
    const disqualified = playerInfo.status === 'disqualified';
    const byHost = !disqualified && exit.reason === 'manual';
    return (
      <div className="stage stage-grid" style={{ ['--heat' as string]: disqualified ? 'var(--bad)' : 'var(--bone-dim)' }}>
        <Rings size="min(170vw, 760px)" style={centerRings} />
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Rise style={{ marginBottom: 14 }}><Avatar id={playerInfo.avatar} size={72} style={{ filter: 'grayscale(1)' }} /></Rise>
          <Rise className="eyebrow eyebrow-heat">{disqualified ? 'Disqualified' : `Eliminated in round ${exit.round ?? ''}`}</Rise>
          <h1 className="display heat slam" style={{ fontSize: 'clamp(3.2rem, 16vw, 5.5rem)', margin: '12px 0 14px' }}>
            {disqualified ? 'Disqualified' : byHost ? 'Eliminated' : "Didn't make the cut"}
          </h1>
          <Rise d={250} as="p" className="dim" style={{ margin: 0, lineHeight: 1.6 }}>
            {disqualified
              ? (exit.note || 'The quiz host removed you from the game.')
              : <>{String(exit.note || 'Eliminated').replace(/\.$/, '')}.<br />You finished <strong>#{exit.rank}</strong> with <strong>{exit.score}</strong> points.</>}
          </Rise>
          {!disqualified && (
            <Rise d={340} as="p" className="display" style={{ margin: '22px 0 0', fontSize: '1.6rem', letterSpacing: '0.02em' }}>
              Well played. Better luck next time!
            </Rise>
          )}
          <Rise d={420} as="p" className="eyebrow" style={{ marginTop: 32 }}>
            {disqualified ? 'Speak to the quiz desk if you think this is a mistake' : 'Stay and watch the rest on the big screen'}
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
            {gameState.rules?.multiplier !== false && <span className="chip chip-heat">× {gameState.levelConfig?.multiplier} points</span>}
            {gameState.rules?.roundReset && <span className="chip" style={{ marginLeft: 8 }}>Everyone starts this round at 0</span>}
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
              const isDisabled = selectedOption !== null || timeUp;
              let cls = 'opt-btn pop';
              if (isSelected) cls += ' selected';
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
    const disqualified = playerInfo.status === 'disqualified';
    const ranked = board.filter(p => p.status !== 'disqualified');
    const rank = disqualified ? 0 : ranked.findIndex(p => p.id === playerInfo.id) + 1;
    const me = ranked[rank - 1];
    const medal = disqualified ? 'Disqualified' : rank === 1 ? 'Champion' : rank === 2 ? 'Runner-up' : rank === 3 ? 'Third place' : 'Final standing';
    return (
      <div className="stage stage-grid">
        <Rings size="min(170vw, 760px)" style={centerRings} />
        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <Rise style={{ marginBottom: 14 }}><Avatar id={playerInfo.avatar} size={80} /></Rise>
          <Rise className="eyebrow eyebrow-heat">{medal}</Rise>
          {rank > 0 ? (
            <>
              <div className="display heat slam" style={{ fontSize: 'clamp(9rem, 50vw, 13rem)', lineHeight: 0.85, margin: '10px 0' }}>
                <span style={{ fontSize: '0.45em', verticalAlign: 'top' }}>#</span>{rank}
              </div>
              <Rise d={300} as="p" className="dim" style={{ margin: 0 }}>of {ranked.length} players</Rise>
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
          {isCorrect && answerResult?.badge && (
            <Rise d={120} style={{ marginBottom: 18 }}>
              {answerResult.badge === '1st to Answer' || answerResult.badge === 'First Blood' ? (
                <span className="chip chip-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 18px', fontSize: '1rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                  <img src="/first-icon.svg" alt="1st" style={{ width: 28, height: 28, display: 'block' }} />
                  <span>1ST TO ANSWER</span>
                </span>
              ) : (
                <span className="chip chip-gold" style={{ fontSize: '0.95rem', padding: '8px 18px', fontWeight: 700 }}>
                  ★ {answerResult.badge}
                </span>
              )}
            </Rise>
          )}

          <div className="display heat pop" style={{ fontSize: '5.5rem', lineHeight: 1 }} aria-hidden="true">
            {notAnswered ? '⧗' : isCorrect ? '✓' : '✕'}
          </div>
          <h1 className="display heat slam" style={{ fontSize: 'clamp(4rem, 22vw, 6.5rem)', margin: '8px 0 10px', ['--d' as string]: '80ms' }}>{headline}</h1>

          {isCorrect ? (
            <Rise d={250} className="display tabular" style={{ fontSize: '2.6rem' }}>+{answerResult.points}</Rise>
          ) : (
            <Rise d={250} as="p" className="dim" style={{ margin: 0 }}>
              {notAnswered ? "You didn't answer in time." : `0 points for this question.${gameState.rules?.streak === false ? '' : ' Streak reset.'}`}
            </Rise>
          )}

          {roundEnd && !roundEnd.isFinal && <RoundEndNotice roundEnd={roundEnd} standing={standing} />}

          <Rise d={480} className="panel bracketed" style={{ marginTop: roundEnd && !roundEnd.isFinal ? 16 : 40, padding: '16px 28px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar id={playerInfo.avatar} size={34} />
                <span className="eyebrow">{gameState.rules?.roundReset ? 'Round points' : 'Your total'}</span>
              </span>
              <span className="display tabular" style={{ fontSize: '2.2rem' }}>{playerInfo.score ?? 0}</span>
            </div>
          </Rise>
          <Rise d={560} as="p" className="eyebrow" style={{ marginTop: 18 }}>
            {gameState.standingsHidden ? 'Final round — standings revealed at the end' : 'Standings are on the big screen'}
          </Rise>
        </main>
      </div>
    );
  }

  return null;
}

// Shown on the reveal at the end of a round: the cut is being decided, or we made it through.
function RoundEndNotice({ roundEnd, standing }: { roundEnd: any; standing: any }) {
  const through = !roundEnd.cutPending;
  return (
    <Rise d={380} className="panel bracketed" style={{ marginTop: 32, padding: '16px 22px', width: '100%', textAlign: 'left', borderColor: through ? 'var(--good)' : undefined }}>
      <div className="eyebrow eyebrow-heat">Round {roundEnd.round} complete · {roundEnd.levelName}</div>
      {roundEnd.cutPending ? (
        <>
          <div className="display" style={{ fontSize: '1.8rem', marginTop: 6 }}>The cut is coming…</div>
          <p className="dim" style={{ margin: '6px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
            {roundEnd.cutLabel}. {standing?.atRisk ? "You're below the line right now — the host is confirming." : 'The host is confirming who goes through.'}
          </p>
        </>
      ) : (
        <>
          <div className="display" style={{ fontSize: '1.8rem', marginTop: 6, color: 'var(--good)' }}>Congratulations! You're through to round {roundEnd.round + 1}.</div>
          <p className="dim" style={{ margin: '6px 0 0', fontSize: '0.9rem', lineHeight: 1.5 }}>
            {standing ? <>You're <strong>#{standing.rank}</strong> of {standing.of} still in.</> : null}
            {roundEnd.eliminated > 0 ? ` ${roundEnd.eliminated} player${roundEnd.eliminated === 1 ? '' : 's'} eliminated.` : ''}
          </p>
        </>
      )}
    </Rise>
  );
}
