import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';

export default function HostConsole() {
  const { socket, isConnected } = useSocket();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (isAuthenticated && isConnected) {
      socket.emit('join_role', 'host');
      socket.on('game_state', setGameState);
      socket.on('players_list', setPlayers);
      socket.on('player_joined', (p) => setPlayers(prev => [...prev, p]));
      socket.on('player_left', (id) => setPlayers(prev => prev.filter(p => p.id !== id)));
    }
    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('player_joined');
      socket.off('player_left');
    };
  }, [socket, isAuthenticated, isConnected]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = import.meta.env.DEV ? `http://${window.location.hostname}:3001/api/admin/login` : '/api/admin/login';
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (data.success) setIsAuthenticated(true);
      else showToast('Invalid password');
    } catch {
      showToast('Login failed — check your connection');
    }
  };

  const loadQuestions = () => {
    const url = import.meta.env.DEV ? `http://${window.location.hostname}:3001/api/admin/questions/seed` : '/api/admin/questions/seed';
    fetch(url, { method: 'POST' }).then(() => {
      socket.emit('host_action', 'load_questions', null, (res: any) => {
        showToast(`✓ Loaded ${res.count} question${res.count !== 1 ? 's' : ''}`);
      });
    });
  };

  const startGame = () => socket.emit('host_action', 'start_game');
  const startQuestion = () => socket.emit('host_action', 'start_question');
  const endQuestion = () => socket.emit('host_action', 'end_question');
  const kickPlayer = (id: string) => socket.emit('host_action', 'kick_player', { socketId: id });
  const resetGame = () => {
    if (confirm('Reset the entire game? All players and scores will be cleared.')) {
      socket.emit('host_action', 'reset_game');
      showToast('Game reset');
    }
  };

  const stateLabel: Record<string, string> = {
    lobby: 'Lobby',
    intro: 'Level Intro',
    question: 'Question Live',
    leaderboard: 'Leaderboard',
    podium: 'Podium',
  };

  // ─── Login ─────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', fontFamily: 'Inter, system-ui, sans-serif' }}>
        {toast && <Toast msg={toast} />}
        <div style={{ width: 360, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 16, padding: '36px 32px' }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', color: '#737373', textTransform: 'uppercase', marginBottom: 8 }}>Vyuham '26</div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Host Login</h1>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Admin password"
              required
              style={{
                padding: '12px 14px', fontSize: '0.95rem', fontFamily: 'inherit',
                border: '1.5px solid #d4d4d4', borderRadius: 8, outline: 'none',
                color: '#0a0a0a', background: '#fff',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#0a0a0a'}
              onBlur={e => e.currentTarget.style.borderColor = '#d4d4d4'}
            />
            <button
              type="submit"
              style={{
                padding: '12px', background: '#0a0a0a', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: '0.9rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Console ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'Inter, system-ui, sans-serif', padding: '0 0 48px' }}>
      {toast && <Toast msg={toast} />}

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e5e5', padding: '0 40px', display: 'flex', alignItems: 'center', height: 56, gap: 16 }}>
        <span style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>Vyuham '26 — Host Console</span>
        <span style={{ flex: 1 }} />
        <StatusBadge online={isConnected} label={isConnected ? 'Connected' : 'Disconnected'} />
        <button
          onClick={resetGame}
          style={{
            padding: '6px 14px', background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5',
            borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ maxWidth: 1140, margin: '32px auto', padding: '0 40px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* State card */}
          <Card>
            <Row>
              <div>
                <Label>Current State</Label>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, letterSpacing: '-0.02em', marginTop: 4 }}>
                  {stateLabel[gameState?.state] ?? 'Unknown'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: '0.8rem', color: '#737373' }}>
                  Q {(gameState?.currentQuestionIndex ?? 0) + (gameState?.state === 'lobby' ? 0 : 0)} / {gameState?.totalQuestions ?? '—'}
                </div>
              </div>
            </Row>
          </Card>

          {/* Controls card */}
          <Card>
            <Label style={{ marginBottom: 16 }}>Game Controls</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <ActionBtn onClick={loadQuestions} variant="secondary">Load Questions</ActionBtn>

              {gameState?.state === 'lobby' && (
                <ActionBtn onClick={startGame} variant="primary">Start Game</ActionBtn>
              )}
              {(gameState?.state === 'intro' || gameState?.state === 'leaderboard') && (
                <ActionBtn onClick={startQuestion} variant="primary">Next Question →</ActionBtn>
              )}
              {gameState?.state === 'question' && (
                <ActionBtn onClick={endQuestion} variant="warn">End Question & Show Answer</ActionBtn>
              )}
            </div>
          </Card>

          {/* Quick stats if in question */}
          {gameState?.state === 'question' && (
            <Card>
              <Label>Live Question</Label>
              <div style={{ marginTop: 12, padding: '14px', background: '#f5f5f5', borderRadius: 8, fontSize: '0.9rem', color: '#404040', fontWeight: 500 }}>
                {gameState.currentQuestion?.text}
              </div>
            </Card>
          )}
        </div>

        {/* Right column: Players */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label style={{ marginBottom: 0 }}>Players</Label>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{players.length}</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 520 }}>
            {players.length === 0 ? (
              <p style={{ color: '#a3a3a3', fontSize: '0.85rem', textAlign: 'center', padding: '32px 20px', margin: 0 }}>
                No players yet
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <th style={{ padding: '10px 20px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: '#a3a3a3', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Name</th>
                    <th style={{ padding: '10px 8px', textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, color: '#a3a3a3', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Score</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {players.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '10px 20px', fontSize: '0.875rem', fontWeight: 500 }}>{p.name}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.875rem', color: '#404040' }}>{p.score}</td>
                      <td style={{ padding: '10px 12px 10px 4px', textAlign: 'right' }}>
                        <button
                          onClick={() => kickPlayer(p.id)}
                          style={{ padding: '3px 10px', background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                        >
                          Kick
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toast({ msg }: { msg: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, background: '#0a0a0a', color: '#fff',
      padding: '12px 20px', borderRadius: 10, fontSize: '0.875rem', fontWeight: 500,
      zIndex: 9999, boxShadow: '0 4px 24px rgba(0,0,0,0.18)', fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {msg}
    </div>
  );
}

function StatusBadge({ online, label }: { online: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 12px', borderRadius: 999,
      background: online ? '#f0fdf4' : '#fef2f2',
      border: `1px solid ${online ? '#86efac' : '#fca5a5'}`,
      fontSize: '0.75rem', fontWeight: 600,
      color: online ? '#15803d' : '#b91c1c',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: online ? '#16a34a' : '#dc2626' }} />
      {label}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: '20px 22px', ...style }}>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{children}</div>;
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: '#737373', textTransform: 'uppercase', marginBottom: 4, ...style }}>
      {children}
    </div>
  );
}

function ActionBtn({ children, onClick, variant }: { children: React.ReactNode; onClick: () => void; variant: 'primary' | 'secondary' | 'warn' }) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: '#0a0a0a', color: '#fff', borderColor: '#0a0a0a' },
    secondary: { background: '#fff', color: '#0a0a0a', borderColor: '#d4d4d4' },
    warn: { background: '#fff', color: '#92400e', borderColor: '#fcd34d' },
  };
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 18px', border: '1.5px solid', borderRadius: 8,
        fontSize: '0.875rem', fontWeight: 600, fontFamily: 'Inter, system-ui, sans-serif',
        cursor: 'pointer', transition: 'opacity 0.1s',
        ...styles[variant],
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      {children}
    </button>
  );
}
