import React, { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Avatar, Burst, ComicBg, Rise, Spinner, TimerRing, VyuhamLogo, OPTION_LABELS } from '../components/ui';
import { API_BASE } from '../lib/api';
import { avatarChoices } from '../lib/avatar';
import confetti from 'canvas-confetti';

const TOKEN_KEY = 'vyuham_player_token';

// localStorage can throw (private mode, blocked storage); the game still works without it.
const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string) => { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

const screenPad: CSSProperties = { width: '100%', maxWidth: 460, margin: '0 auto', padding: '0 20px' };

// A phone screen: paper backdrop (rays, halftone, rings) + content. Same look for every level.
function Screen({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="stage" data-theme="mono" style={style}>
      <ComicBg />
      {children}
    </div>
  );
}

export default function ParticipantView() {
  const { socket, isConnected, serverUrl } = useSocket();
  const [name, setName] = useState('');
  const [ticketId, setTicketId] = useState('');
  // Continuing on a new device: the server asks for the last 4 digits of the registered phone.
  const [needsVerify, setNeedsVerify] = useState(false);
  const [verify, setVerify] = useState('');
  // Character picked on the join screen.
  const [avatarOptions, setAvatarOptions] = useState<string[]>(() => avatarChoices(12));
  const [avatar, setAvatar] = useState('');
  const [requireCheckin, setRequireCheckin] = useState(true);
  const [joining, setJoining] = useState(false);
  const [gameState, setGameState] = useState<any>(null);
  const [playerInfo, setPlayerInfo] = useState<any>(null);
  const [answerResult, setAnswerResult] = useState<any>(null);
  // Our place among those still in, and whether we're below the level's cut line right now.
  const [standing, setStanding] = useState<{ rank: number; of: number; atRisk?: boolean; cutLabel?: string | null } | null>(null);
  const [lastCut, setLastCut] = useState<any>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [rejoining, setRejoining] = useState(() => !!storage.get());
  const questionIndexRef = useRef<number | null>(null);

  const timeLeft = useCountdown(
    gameState?.state === 'question' ? gameState.questionEndsAt : null,
    gameState?.serverNow,
  );
  const maxTime = gameState?.currentQuestion?.timeLimit || 20;
  const chosenAvatar = avatar || avatarOptions[0];

  // Clear per-question UI only when a *new* question starts (not on repeated state broadcasts).
  const applyState = (state: any) => {
    setGameState(state);
    if (state.state === 'question' && state.currentQuestionIndex !== questionIndexRef.current) {
      questionIndexRef.current = state.currentQuestionIndex;
      setSelectedOption(null);
      setAnswerResult(null);
      setLastCut(null);
      setMessage('');
    }
  };

  const leaveGame = (reason: string) => {
    storage.clear();
    setPlayerInfo(null);
    setGameState(null);
    setAnswerResult(null);
    setStanding(null);
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
    // Our own result for the question that just ended (and our place among those still in).
    socket.on('my_result', (res: any) => {
      setPlayerInfo(res.player);
      setAnswerResult(res.myAnswer);
      setStanding(res.standing ?? null);
      if (res.myAnswer?.isCorrect) {
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 }, colors: ['#3da9fc', '#ff5c8a', '#ffc531', '#3ddc97'] });
        if (navigator.vibrate) navigator.vibrate(150);
      } else if (res.myAnswer) {
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
      }
    });
    // Whether a cut happened at this reveal ("You made the cut!").
    socket.on('question_result', (r: any) => setLastCut(r?.elimination ?? null));
    // Status changes outside a reveal (e.g. disqualified by the host).
    socket.on('player_update', (res: any) => {
      setPlayerInfo(res.player);
      if (res.standing !== undefined) setStanding(res.standing);
    });
    // The coordinator confirmed the end-of-level cut ("You made the cut!" if we're still in).
    socket.on('cut_result', (data: any) => setLastCut(data.elimination));
    return () => {
      socket.off('game_state');
      socket.off('kicked');
      socket.off('game_reset');
      socket.off('my_result');
      socket.off('question_result');
      socket.off('player_update');
      socket.off('cut_result');
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
      ? { ticketId: ticketId.trim(), name: name.trim(), avatar: chosenAvatar, ...(needsVerify ? { verify: verify.trim() } : {}) }
      : { name: name.trim(), avatar: chosenAvatar };
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

  const center: CSSProperties = { ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 };

  // ─── Connecting ────────────────────────────────────────────────────────────
  if (!isConnected || rejoining) {
    return <Spinner label={playerInfo ? 'Reconnecting…' : 'Connecting…'} />;
  }

  // ─── Join ──────────────────────────────────────────────────────────────────
  if (!playerInfo) {
    return (
      <Screen>
        <header style={{ ...screenPad, paddingTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <VyuhamLogo height={46} />
          <span className="comic-badge light" style={{ fontSize: '0.8rem' }}>Vyuham '26</span>
        </header>

        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: 28, gap: 18 }}>
          <Rise style={{ alignSelf: 'center' }}>
            <Burst style={{ padding: '30px 34px 34px' }}>
              <h1 className="comic-title slam" style={{ fontSize: 'clamp(3.2rem, 17vw, 5rem)', textAlign: 'center' }}>Tech<br />Sprint</h1>
            </Burst>
          </Rise>

          <Rise d={200}>
            <form onSubmit={handleJoin} className="comic-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '18px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="comic-text" style={{ fontSize: '1.05rem' }}>Pick your character</span>
                <button type="button" className="chip" onClick={() => { setAvatarOptions(avatarChoices(12)); setAvatar(''); }}>↻ Shuffle</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }} role="radiogroup" aria-label="Character">
                {avatarOptions.map(id => (
                  <button key={id} type="button" role="radio" aria-checked={chosenAvatar === id}
                    className={`avatar-pick${chosenAvatar === id ? ' picked' : ''}`} onClick={() => setAvatar(id)}>
                    <Avatar id={id} size="100%" style={{ aspectRatio: '1', display: 'block' }} />
                  </button>
                ))}
              </div>

              {requireCheckin && (
                <>
                  <label htmlFor="player-ticket" className="eyebrow" style={{ marginTop: 4 }}>Ticket ID (on your pass)</label>
                  <input
                    id="player-ticket" className="field" type="text" value={ticketId}
                    onChange={(e) => { setTicketId(e.target.value.toUpperCase()); setNeedsVerify(false); setVerify(''); }}
                    maxLength={40} placeholder="e.g. MMP49081761" autoCapitalize="characters" autoComplete="off" spellCheck={false} required
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
                  />
                  {needsVerify && (
                    <>
                      <label htmlFor="player-verify" className="eyebrow">Last 4 digits of your registered phone</label>
                      <input
                        id="player-verify" className="field" type="text" inputMode="numeric" pattern="[0-9]{4}" value={verify}
                        onChange={(e) => setVerify(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="••••" autoComplete="off" required autoFocus
                        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em' }}
                      />
                    </>
                  )}
                </>
              )}
              <label htmlFor="player-name" className="eyebrow">{requireCheckin ? 'Leaderboard name (optional)' : 'Your call sign'}</label>
              <input
                id="player-name" className="field" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={20}
                placeholder={requireCheckin ? 'Defaults to your first name' : 'Name or nickname'} autoComplete="nickname" required={!requireCheckin}
              />
              <button type="submit" className="btn btn-heat btn-lg btn-block" disabled={joining}>
                {joining ? 'Checking ticket…' : "Let's play!"}
              </button>
              {message && <p role="alert" className="error-text">{message}</p>}
            </form>
          </Rise>
        </main>
      </Screen>
    );
  }

  // ─── Lobby ─────────────────────────────────────────────────────────────────
  if (!gameState || gameState.state === 'lobby') {
    return (
      <Screen>
        <header style={{ ...screenPad, paddingTop: 18 }}><VyuhamLogo height={42} /></header>
        <main style={center}>
          <Rise><span className="comic-badge">You're in!</span></Rise>
          <div className="pop"><Avatar id={playerInfo.avatar} size={150} style={{ border: '2px solid #fff', boxShadow: 'var(--shadow-lg)' }} /></div>
          <Burst style={{ padding: '18px 30px 22px' }}>
            <h1 className="comic-title" style={{ fontSize: 'clamp(2.4rem, 13vw, 4rem)', overflowWrap: 'anywhere' }}>{playerInfo.name}</h1>
          </Burst>
          <Rise d={300} as="p" className="comic-text" style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.4 }}>
            Waiting for the host to begin.<br />Keep your eyes on the big screen!
          </Rise>
        </main>
      </Screen>
    );
  }

  // ─── Out of the game: cut after a level, or disqualified ───────────────────
  if (playerInfo.status && playerInfo.status !== 'active' && gameState.state !== 'podium') {
    const exit = playerInfo.exit || {};
    const disqualified = playerInfo.status === 'disqualified';
    return (
      <Screen>
        <main style={center}>
          <Rise><span className="comic-badge">{disqualified ? 'Disqualified' : `Out after round ${exit.round ?? ''}`}</span></Rise>
          <Avatar id={playerInfo.avatar} size={110} style={{ filter: 'grayscale(0.6)', border: '3px solid var(--t-ink, #111)' }} />
          <Burst style={{ padding: '20px 28px 24px' }}>
            <h1 className="comic-title" style={{ fontSize: 'clamp(2.2rem, 11vw, 3.4rem)', textAlign: 'center' }}>
              {disqualified ? 'Disqualified' : "Didn't make the cut"}
            </h1>
          </Burst>
          <div className="comic-panel" style={{ padding: '14px 18px', lineHeight: 1.5 }}>
            {disqualified
              ? (exit.note || 'The quiz host removed you from the game.')
              : <>{exit.note}.<br />You finished <strong>#{exit.rank}</strong> with <strong>{exit.score}</strong> points.</>}
          </div>
          <p className="comic-text" style={{ margin: 0, fontSize: '1rem' }}>
            {disqualified ? 'Speak to the quiz desk if you think this is a mistake' : 'Stay and watch the rest on the big screen!'}
          </p>
        </main>
      </Screen>
    );
  }

  // ─── Level intro ───────────────────────────────────────────────────────────
  if (gameState.state === 'intro') {
    const config = gameState.levelConfig || {};
    return (
      <Screen>
        <main style={center}>
          <Rise><span className="comic-badge light">Round {gameState.currentLevel} of {gameState.totalLevels}</span></Rise>
          <Burst style={{ padding: '34px 30px 40px' }}>
            <h1 className="comic-title slam" style={{ fontSize: 'clamp(2.6rem, 14vw, 4.4rem)', textAlign: 'center' }}>{config.name}</h1>
          </Burst>
          <Rise d={350} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <span className="comic-badge">× {config.multiplier} points</span>
            {config.cut && <span className="comic-badge light">✂ {config.cut.label}</span>}
          </Rise>
        </main>
      </Screen>
    );
  }

  // ─── Question ──────────────────────────────────────────────────────────────
  if (gameState.state === 'question') {
    const q = gameState.currentQuestion;
    const timeUp = timeLeft <= 0;
    return (
      <Screen>
        <header style={{ ...screenPad, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 8 }}>
          <span className="comic-badge light" style={{ fontSize: '1.2rem' }}>
            Q{gameState.currentQuestionIndex + 1}<span style={{ opacity: 0.5 }}>/{gameState.totalQuestions}</span>
          </span>
          <span className="comic-badge" style={{ fontSize: '0.75rem', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gameState.levelConfig?.name}</span>
          <div className="timer-disc"><TimerRing value={timeLeft} max={maxTime} size={58} stroke={4} /></div>
        </header>

        <main style={{ ...screenPad, flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 8, paddingBottom: 16, gap: 10 }}>
          {q?.hasImage ? (
            <img key={gameState.currentQuestionIndex} className="q-image pop" alt="Question picture"
              src={`${serverUrl}/live-image/${gameState.currentQuestionIndex}?t=${gameState.questionStartTime}`}
              style={{ height: 'min(30vh, 260px)' }} />
          ) : (
            <p className="comic-text" style={{ margin: '0 0 4px', textAlign: 'center', fontSize: '1rem' }}>Read the question on the big screen</p>
          )}

          <div style={{ flex: 1, maxHeight: 520, display: 'grid', gridAutoRows: 'minmax(60px, 1fr)', gap: 10 }}>
            {q?.options?.map((opt: string, idx: number) => {
              const isSelected = selectedOption === opt;
              const isDisabled = selectedOption !== null || timeUp;
              let cls = 'opt-btn pop';
              if (isSelected) cls += ' selected';
              else if (isDisabled) cls += ' faded';
              return (
                <button key={idx} data-opt={idx} className={cls} style={{ ['--d' as string]: `${idx * 70}ms` }}
                  onClick={() => handleAnswer(opt)} disabled={isDisabled}>
                  <span className="opt-label">{OPTION_LABELS[idx]}</span>
                  <span className="opt-text">{opt}</span>
                </button>
              );
            })}
          </div>

          {message && <p role="alert" className="error-text" style={{ marginTop: 6 }}>{message}</p>}
          {(selectedOption || timeUp) && (
            <p className="comic-text" style={{ margin: 0, textAlign: 'center', fontSize: '1.05rem' }}>
              {selectedOption ? '● Locked in — wait for the reveal!' : "Time's up — wait for the reveal"}
            </p>
          )}
        </main>
      </Screen>
    );
  }

  // ─── Podium: final rank ────────────────────────────────────────────────────
  if (gameState.state === 'podium') {
    const board: any[] = gameState.finalLeaderboard || [];
    const disqualified = playerInfo.status === 'disqualified';
    const ranked = board.filter(p => p.status !== 'disqualified');
    const rank = disqualified ? 0 : ranked.findIndex(p => p.id === playerInfo.id) + 1;
    const me = ranked[rank - 1];
    const medal = disqualified ? 'Disqualified' : rank === 1 ? 'Champion!' : rank === 2 ? 'Runner-up!' : rank === 3 ? 'Third place!' : 'Final standing';
    return (
      <Screen>
        <main style={center}>
          <Rise><span className="comic-badge">{medal}</span></Rise>
          <Avatar id={playerInfo.avatar} size={120} style={{ border: '2px solid #fff', boxShadow: 'var(--shadow-lg)' }} />
          {rank > 0 ? (
            <>
              <Burst style={{ padding: '24px 40px 30px' }}>
                <div className="comic-title slam" style={{ fontSize: 'clamp(5rem, 30vw, 8rem)' }}><span style={{ fontSize: '0.5em' }}>#</span>{rank}</div>
              </Burst>
              <span className="comic-badge light">{me?.score ?? 0} points · of {ranked.length}</span>
            </>
          ) : (
            <h1 className="comic-title" style={{ fontSize: '3rem' }}>Game over</h1>
          )}
          <VyuhamLogo height={54} style={{ marginTop: 10 }} />
          <p className="comic-text" style={{ margin: 0 }}>Thanks for playing TechSprint · Vyuham '26</p>
        </main>
      </Screen>
    );
  }

  // ─── Reveal: result of the last question ───────────────────────────────────
  if (gameState.state === 'leaderboard') {
    const isCorrect = answerResult?.isCorrect;
    const notAnswered = !answerResult;
    const headline = notAnswered ? 'Too slow!' : isCorrect ? 'Correct!' : 'Wrong!';
    const cutLabel = lastCut ? null : standing?.cutLabel;
    const safe = standing && cutLabel ? !standing.atRisk : null;
    return (
      <Screen>
        <main style={center}>
          <Burst style={{ padding: '26px 34px 30px' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="comic-title pop" style={{ fontSize: '4.2rem', color: notAnswered ? '#8a8a8a' : isCorrect ? '#15803d' : '#b91c1c' }} aria-hidden="true">
                {notAnswered ? '⧗' : isCorrect ? '✓' : '✕'}
              </div>
              <h1 className="comic-title slam" style={{ fontSize: 'clamp(2.6rem, 14vw, 4rem)', color: notAnswered ? '#8a8a8a' : isCorrect ? '#15803d' : '#b91c1c' }}>{headline}</h1>
            </div>
          </Burst>

          {isCorrect ? (
            <Rise d={250} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span className="comic-badge" style={{ fontSize: '1.4rem' }}>+{answerResult.points}</span>
              {answerResult.badge && <span className="comic-badge light">★ {answerResult.badge}</span>}
            </Rise>
          ) : (
            <Rise d={250} as="p" className="comic-text" style={{ margin: 0, fontSize: '1.05rem' }}>
              {notAnswered ? "You didn't answer in time." : '0 points this time. Streak reset.'}
            </Rise>
          )}

          {lastCut && (
            <Rise d={380}><span className="comic-badge" style={{ fontSize: '1.1rem' }}>🎉 You made the cut! {lastCut.label}</span></Rise>
          )}

          <Rise d={480} className="comic-panel" style={{ width: '100%', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar id={playerInfo.avatar} size={52} />
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div className="eyebrow" style={{ color: '#555' }}>Your total</div>
              <div className="comic-text tabular" style={{ fontSize: '2rem', lineHeight: 1 }}>{playerInfo.score ?? 0}</div>
            </div>
            {standing && (
              <div style={{ textAlign: 'right' }}>
                <div className="eyebrow" style={{ color: '#555' }}>Rank</div>
                <div className="comic-text tabular" style={{ fontSize: '2rem', lineHeight: 1 }}>#{standing.rank}<span style={{ fontSize: '1rem', opacity: 0.6 }}>/{standing.of}</span></div>
              </div>
            )}
          </Rise>
          {safe !== null && (
            <Rise d={560}>
              <span className="comic-badge light" style={{ background: safe ? '#dcfce7' : '#fee2e2' }}>
                {safe ? `✓ Above the line — ${cutLabel}` : `⚠ Below the line — ${cutLabel}`}
              </span>
            </Rise>
          )}
        </main>
      </Screen>
    );
  }

  return null;
}
