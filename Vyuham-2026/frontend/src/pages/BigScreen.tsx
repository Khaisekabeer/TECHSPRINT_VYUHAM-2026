import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';

const LABELS = ['A', 'B', 'C', 'D'];
const RANK_MEDALS: Record<number, string> = { 0: '🥇', 1: '🥈', 2: '🥉' };

// Simple circular timer for big screen
function TimerRing({ value, max }: { value: number; max: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const progress = Math.max(0, value / max);
  const urgent = value <= 5;
  return (
    <div style={{ position: 'relative', width: 88, height: 88, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="#e5e5e5" strokeWidth="4" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={urgent ? '#dc2626' : '#0a0a0a'}
          strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
        />
      </svg>
      <span style={{ fontSize: '1.8rem', fontWeight: 800, color: urgent ? '#dc2626' : '#0a0a0a', zIndex: 1 }}>{value}</span>
    </div>
  );
}

export default function BigScreen() {
  const { socket, isConnected } = useSocket();
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [questionResult, setQuestionResult] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [maxTime, setMaxTime] = useState(20);

  useEffect(() => {
    document.body.classList.add('big-screen-mode');
    return () => document.body.classList.remove('big-screen-mode');
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    socket.emit('join_role', 'bigscreen');

    socket.on('game_state', (state) => {
      setGameState(state);
      if (state.state === 'question') {
        setQuestionResult(null);
        const tl = state.currentQuestion?.timeLimit || 20;
        setTimeLeft(tl);
        setMaxTime(tl);
      }
    });
    socket.on('players_list', setPlayers);
    socket.on('player_joined', (p) => setPlayers(prev => [...prev, p]));
    socket.on('player_left', (id) => setPlayers(prev => prev.filter(p => p.id !== id)));
    socket.on('question_result', (result) => {
      setGameState((prev: any) => ({ ...prev, state: 'leaderboard' }));
      setQuestionResult(result);
    });

    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('player_joined');
      socket.off('player_left');
      socket.off('question_result');
    };
  }, [socket, isConnected]);

  // Countdown
  useEffect(() => {
    let interval: any;
    if (gameState?.state === 'question' && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(p => p - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [gameState?.state, timeLeft]);

  const s = {
    page: {
      minHeight: '100vh', width: '100%', background: '#fafafa', fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex', flexDirection: 'column' as const,
    },
    topBar: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '20px 48px', borderBottom: '1px solid #e5e5e5', background: '#fff',
    },
    brand: { fontSize: '1rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#0a0a0a' },
    status: { fontSize: '0.75rem', color: '#737373', display: 'flex', alignItems: 'center', gap: 6 },
    dot: (online: boolean) => ({ width: 6, height: 6, borderRadius: '50%', background: online ? '#16a34a' : '#dc2626' }),
  };

  if (!gameState) {
    return (
      <div style={{ ...s.page, alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <p style={{ color: '#a3a3a3', fontSize: '0.9rem' }}>Waiting for host to start…</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Top bar */}
      <div style={s.topBar}>
        <span style={s.brand}>Vyuham '26 — TechQuiz</span>
        <div style={s.status}>
          <span style={s.dot(isConnected)} />
          {players.length} player{players.length !== 1 ? 's' : ''} connected
        </div>
      </div>

      {/* ── LOBBY ── */}
      {gameState.state === 'lobby' && (
        <div style={{ flex: 1, display: 'flex', gap: 0 }}>
          {/* Left: join info */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px 64px', borderRight: '1px solid #e5e5e5' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: '#737373', textTransform: 'uppercase', marginBottom: 12 }}>Join the Quiz</div>
            <h1 style={{ fontSize: '4rem', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.05em', lineHeight: 1 }}>TechQuiz Championship</h1>
            <p style={{ color: '#737373', fontSize: '1.1rem', margin: '16px 0 40px' }}>Open your browser and go to:</p>
            <div style={{ display: 'inline-block', background: '#0a0a0a', color: '#fff', borderRadius: 12, padding: '18px 28px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.02em' }}>{window.location.hostname}:3001</span>
            </div>
            <p style={{ color: '#a3a3a3', fontSize: '0.85rem', marginTop: 12 }}>No app required — works on any mobile browser</p>
          </div>

          {/* Right: player list */}
          <div style={{ flex: 1, padding: '48px 64px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Players</h2>
              <span style={{ fontSize: '1.8rem', fontWeight: 800 }}>{players.length}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {players.map(p => (
                <div key={p.id} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 999, fontSize: '0.9rem', fontWeight: 500 }}>
                  {p.name}
                </div>
              ))}
              {players.length === 0 && <p style={{ color: '#a3a3a3', fontSize: '0.875rem' }}>Waiting for players to join…</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── INTRO ── */}
      {gameState.state === 'intro' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: '#737373', textTransform: 'uppercase', marginBottom: 16 }}>Coming Up</div>
          <h2 style={{ fontSize: '5rem', fontWeight: 800, margin: '0 0 12px', letterSpacing: '-0.06em', lineHeight: 1 }}>Level {gameState.currentLevel}</h2>
          <p style={{ fontSize: '1.4rem', color: '#404040', fontWeight: 500 }}>{gameState.levelConfig?.name}</p>
          <p style={{ color: '#a3a3a3', marginTop: 32, fontSize: '0.875rem' }}>Host will start the first question shortly</p>
        </div>
      )}

      {/* ── QUESTION ── */}
      {gameState.state === 'question' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 64px' }}>
          {/* Question header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase' }}>
                Q {gameState.currentQuestionIndex + 1} / {gameState.totalQuestions}
              </span>
              <span style={{ width: 1, height: 14, background: '#e5e5e5' }} />
              <span style={{ fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase' }}>
                Level {gameState.currentLevel} · {gameState.levelConfig?.name}
              </span>
            </div>
            <TimerRing value={timeLeft} max={maxTime} />
          </div>

          {/* Question text */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: '3rem', fontWeight: 700, textAlign: 'center', lineHeight: 1.25, letterSpacing: '-0.03em', maxWidth: 900, margin: 0 }}>
              {gameState.currentQuestion?.text}
            </h2>
          </div>

          {/* Options grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {gameState.currentQuestion?.options?.map((opt: string, idx: number) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px',
                background: '#fff', border: '1.5px solid #e5e5e5', borderRadius: 12,
              }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 8, background: '#f5f5f5',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', fontWeight: 700, color: '#404040', flexShrink: 0,
                }}>
                  {LABELS[idx]}
                </span>
                <span style={{ fontSize: '1.4rem', fontWeight: 600, color: '#0a0a0a' }}>{opt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LEADERBOARD ── */}
      {gameState.state === 'leaderboard' && (
        <div style={{ flex: 1, display: 'flex', gap: 0 }}>
          {/* Answer reveal */}
          <div style={{ flex: 1, padding: '48px 56px', borderRight: '1px solid #e5e5e5', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase', margin: '0 0 24px' }}>Answer Reveal</h2>
            <div style={{ padding: '28px', background: '#fff', border: '1.5px solid #e5e5e5', borderRadius: 14, marginBottom: 28 }}>
              <p style={{ color: '#737373', fontSize: '0.8rem', marginBottom: 8, fontWeight: 500 }}>Correct Answer</p>
              <h3 style={{ fontSize: '2.2rem', fontWeight: 800, margin: 0, color: '#16a34a', letterSpacing: '-0.03em' }}>
                {questionResult?.correctAnswer}
              </h3>
            </div>
            {questionResult?.speedStar && (
              <div style={{ padding: '20px 24px', background: '#fefce8', border: '1px solid #fde047', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: '1.5rem' }}>⚡</span>
                <div>
                  <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: '#a16207', textTransform: 'uppercase', margin: '0 0 4px' }}>Fastest Answer</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: '#0a0a0a' }}>{questionResult.speedStar}</p>
                </div>
              </div>
            )}
          </div>

          {/* Leaderboard */}
          <div style={{ flex: '1.2', padding: '48px 56px', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase', margin: '0 0 24px' }}>Standings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(questionResult?.leaderboard || players).slice(0, 10).map((p: any, idx: number) => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                  background: idx === 0 ? '#0a0a0a' : '#fff',
                  border: '1.5px solid',
                  borderColor: idx === 0 ? '#0a0a0a' : '#e5e5e5',
                  borderRadius: 10,
                  color: idx === 0 ? '#fff' : '#0a0a0a',
                }}>
                  <span style={{ width: 28, textAlign: 'center', fontSize: '1rem', fontWeight: 800, flexShrink: 0 }}>
                    {RANK_MEDALS[idx] ?? `${idx + 1}`}
                  </span>
                  <span style={{ flex: 1, fontSize: '1.1rem', fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem', opacity: idx === 0 ? 0.9 : 0.7 }}>{p.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PODIUM ── */}
      {gameState.state === 'podium' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: '#737373', textTransform: 'uppercase', marginBottom: 16 }}>Final Results</div>
          <h2 style={{ fontSize: '3.5rem', fontWeight: 800, margin: '0 0 48px', letterSpacing: '-0.05em' }}>Game Over</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 560 }}>
            {players.slice(0, 3).map((p, idx) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px',
                background: idx === 0 ? '#0a0a0a' : '#fff',
                border: '1.5px solid',
                borderColor: idx === 0 ? '#0a0a0a' : '#e5e5e5',
                borderRadius: 12,
                color: idx === 0 ? '#fff' : '#0a0a0a',
              }}>
                <span style={{ fontSize: '1.5rem' }}>{RANK_MEDALS[idx]}</span>
                <span style={{ flex: 1, fontSize: '1.2rem', fontWeight: 700 }}>{p.name}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem' }}>{p.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
