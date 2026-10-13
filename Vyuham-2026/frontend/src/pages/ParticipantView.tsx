import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import confetti from 'canvas-confetti';

const LABELS = ['A', 'B', 'C', 'D'];

// Circular SVG countdown timer
function TimerRing({ value, max }: { value: number; max: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const progress = Math.max(0, value / max);
  const urgent = value <= 5;
  return (
    <div className={`timer-ring${urgent ? ' urgent' : ''}`}>
      <svg width="52" height="52" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="#e5e5e5" strokeWidth="3" />
        <circle
          cx="26" cy="26" r={r} fill="none"
          stroke={urgent ? '#dc2626' : '#0a0a0a'}
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
        />
      </svg>
      <span className="count">{value}</span>
    </div>
  );
}

export default function ParticipantView() {
  const { socket, isConnected } = useSocket();
  const [name, setName] = useState('');
  const [gameState, setGameState] = useState<any>(null);
  const [playerInfo, setPlayerInfo] = useState<any>(null);
  const [answerResult, setAnswerResult] = useState<any>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [maxTime, setMaxTime] = useState(20);

  useEffect(() => {
    socket.on('game_state', (state) => {
      setGameState(state);
      if (state.state === 'question') {
        setSelectedOption(null);
        setAnswerResult(null);
        const tl = state.currentQuestion?.timeLimit || 20;
        setTimeLeft(tl);
        setMaxTime(tl);
      }
    });
    socket.on('question_result', () => {
      setGameState((prev: any) => ({ ...prev, state: 'leaderboard' }));
    });
    return () => {
      socket.off('game_state');
      socket.off('question_result');
    };
  }, [socket]);

  // Countdown timer
  useEffect(() => {
    let interval: any;
    if (gameState?.state === 'question' && timeLeft > 0 && !selectedOption) {
      interval = setInterval(() => setTimeLeft(p => p - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [gameState?.state, timeLeft, selectedOption]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    socket.emit('join_game', { name: name.trim() }, (res: any) => {
      if (res.success) setPlayerInfo(res.player);
      else alert(res.error);
    });
  };

  const handleAnswer = (option: string) => {
    if (selectedOption || gameState?.state !== 'question') return;
    setSelectedOption(option);
    socket.emit('submit_answer', option, (res: any) => {
      if (res.success) {
        setAnswerResult(res);
        if (res.isCorrect) {
          confetti({ particleCount: 60, spread: 55, origin: { y: 0.75 }, colors: ['#0a0a0a', '#525252', '#d4d4d4'] });
          if (navigator.vibrate) navigator.vibrate(150);
        } else {
          if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        }
      }
    });
  };

  const useDrone = () => {
    if ((playerInfo?.droneAssists ?? 0) <= 0) return;
    socket.emit('use_drone', (res: any) => {
      if (res.success) {
        setPlayerInfo((prev: any) => ({ ...prev, droneAssists: prev.droneAssists - 1 }));
        alert(`Eliminated: ${res.removedOptions.join(' & ')}`);
      } else {
        alert(res.error);
      }
    });
  };

  // ─── Connecting ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #0a0a0a', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: '#737373', fontSize: '0.875rem' }}>Connecting…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─── Join Screen ───────────────────────────────────────────────────────────
  if (!playerInfo) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#fff' }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: '#737373', marginBottom: 12, textTransform: 'uppercase' }}>Vyuham '26</div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, letterSpacing: '-0.03em', lineHeight: 1.1 }}>TechQuiz</h1>
            <p style={{ color: '#737373', marginTop: 8, fontSize: '0.9rem' }}>Enter your name to join the game</p>
          </div>
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={15}
              placeholder="Your name"
              required
              style={{
                width: '100%', padding: '14px 16px', fontSize: '1rem', fontFamily: 'inherit',
                border: '1.5px solid #d4d4d4', borderRadius: 10, outline: 'none',
                color: '#0a0a0a', background: '#fff', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#0a0a0a'}
              onBlur={e => e.currentTarget.style.borderColor = '#d4d4d4'}
            />
            <button
              type="submit"
              style={{
                padding: '14px', background: '#0a0a0a', color: '#fff', border: 'none',
                borderRadius: 10, fontSize: '0.95rem', fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#262626'}
              onMouseLeave={e => e.currentTarget.style.background = '#0a0a0a'}
            >
              Join Game
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Lobby ─────────────────────────────────────────────────────────────────
  if (!gameState || gameState.state === 'lobby') {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#fff', textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', marginBottom: 20 }}>👋</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>You're in, {playerInfo.name}!</h2>
        <p style={{ color: '#737373', fontSize: '0.9rem', margin: 0 }}>Waiting for the host to start the game.<br />Watch the big screen.</p>
        <div style={{ marginTop: 32, padding: '10px 20px', background: '#f5f5f5', borderRadius: 8, fontSize: '0.8rem', color: '#737373' }}>
          Drone Assists left: <strong style={{ color: '#0a0a0a' }}>{playerInfo.droneAssists}</strong>
        </div>
      </div>
    );
  }

  // ─── Intro / Level card ────────────────────────────────────────────────────
  if (gameState.state === 'intro') {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: '#737373', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>Level {gameState.currentLevel}</div>
        <h2 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.04em' }}>{gameState.levelConfig?.name}</h2>
        <p style={{ color: '#737373', fontSize: '0.9rem', margin: 0 }}>Get ready…</p>
      </div>
    );
  }

  // ─── Question ──────────────────────────────────────────────────────────────
  if (gameState.state === 'question') {
    const q = gameState.currentQuestion;
    return (
      <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #e5e5e5' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase' }}>
              Question {gameState.currentQuestionIndex + 1} / {gameState.totalQuestions}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#737373', marginTop: 2 }}>Level {gameState.currentLevel}</div>
          </div>
          <TimerRing value={timeLeft} max={maxTime} />
        </div>

        {/* Question text — not shown on phone; player just sees options */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 20px 12px' }}>
          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            {q?.options?.map((opt: string, idx: number) => {
              const isSelected = selectedOption === opt;
              const isDisabled = selectedOption !== null;
              let cls = 'opt-btn no-select';
              if (isSelected) cls += ' selected';
              if (isDisabled && !isSelected) cls += ' faded';
              return (
                <button
                  key={idx}
                  className={cls}
                  onClick={() => handleAnswer(opt)}
                  disabled={isDisabled}
                >
                  <span className="opt-label">{LABELS[idx]}</span>
                  <span style={{ flex: 1, fontSize: '0.95rem' }}>{opt}</span>
                </button>
              );
            })}
          </div>

          {/* Drone Assist lifeline */}
          {!selectedOption && (
            <div style={{ textAlign: 'center', paddingTop: 20, paddingBottom: 8 }}>
              <button
                onClick={useDrone}
                disabled={(playerInfo?.droneAssists ?? 0) <= 0}
                className="chip chip-neutral"
                style={{ cursor: (playerInfo?.droneAssists ?? 0) > 0 ? 'pointer' : 'not-allowed', opacity: (playerInfo?.droneAssists ?? 0) > 0 ? 1 : 0.4 }}
              >
                ½ &nbsp; 50/50 Lifeline ({playerInfo?.droneAssists ?? 0} left)
              </button>
            </div>
          )}

          {selectedOption && (
            <div style={{ textAlign: 'center', paddingTop: 16, paddingBottom: 8 }}>
              <span style={{ fontSize: '0.8rem', color: '#a3a3a3' }}>Answer locked in — waiting for results…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Leaderboard / Podium result card ─────────────────────────────────────
  if (gameState.state === 'leaderboard' || gameState.state === 'podium') {
    const isCorrect = answerResult?.isCorrect;
    const notAnswered = !answerResult;
    return (
      <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
          {/* Result icon */}
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>
            {notAnswered ? '⏱️' : isCorrect ? '✓' : '✗'}
          </div>

          {notAnswered ? (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em' }}>Time's up!</h2>
              <p style={{ color: '#737373', fontSize: '0.9rem' }}>You didn't answer in time.</p>
            </>
          ) : isCorrect ? (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em', color: '#16a34a' }}>Correct!</h2>
              <p style={{ color: '#737373', fontSize: '0.9rem', marginBottom: 16 }}>+{answerResult.points} points</p>
              {answerResult.badge && (
                <span className="chip chip-yellow" style={{ fontSize: '0.8rem' }}>🏅 {answerResult.badge}</span>
              )}
            </>
          ) : (
            <>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.02em', color: '#dc2626' }}>Wrong</h2>
              <p style={{ color: '#737373', fontSize: '0.9rem' }}>0 points this round.</p>
            </>
          )}

          <div style={{ marginTop: 40, padding: '14px 20px', background: '#f5f5f5', borderRadius: 10 }}>
            <p style={{ color: '#737373', fontSize: '0.8rem', margin: 0 }}>Check the big screen for standings</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
