import { useEffect, useState } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { useCountdown } from '../../hooks/useCountdown';
import { session } from '../../lib/api';
import { Panel, TimerRing } from '../../components/ui';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby — players joining',
  intro: 'Level briefing',
  question: 'Question live',
  leaderboard: 'Answer reveal',
  podium: 'Final results',
};

// Read-only view of the live event for volunteers (and admins/coordinators): who is
// connected, how many have answered, what's on screen. No controls.
export default function LiveMonitor() {
  const { socket, isConnected } = useSocket();
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [loaded, setLoaded] = useState<{ count: number; by?: string } | null>(null);
  const [error, setError] = useState('');

  const timeLeft = useCountdown(gameState?.state === 'question' ? gameState.questionEndsAt : null, gameState?.serverNow);

  useEffect(() => {
    if (!isConnected) return;
    socket.on('game_state', setGameState);
    socket.on('players_list', setPlayers);
    socket.on('answer_count', setAnswerCount);
    socket.on('questions_loaded', setLoaded);
    socket.emit('join_role', 'monitor', session.get()?.token, (res: any) => setError(res?.error || ''));
    return () => {
      socket.off('game_state', setGameState);
      socket.off('players_list', setPlayers);
      socket.off('answer_count', setAnswerCount);
      socket.off('questions_loaded', setLoaded);
    };
  }, [socket, isConnected]);

  const phase = gameState?.state;
  const online = players.filter(p => p.connected).length;
  const offline = players.filter(p => !p.connected);
  const pct = answerCount.total ? (answerCount.answered / answerCount.total) * 100 : 0;
  const roster = [...offline, ...players.filter(p => p.connected)];

  return (
    <>
      {error && <p role="alert" className="error-text" style={{ textAlign: 'left' }}>{error}</p>}
      <div className="grid-stats">
        <Panel>
          <div className="eyebrow">Phase</div>
          <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 10 }}>{PHASE_LABEL[phase] ?? (isConnected ? '—' : 'Connecting…')}</div>
          {gameState && (
            <div className="dim" style={{ fontSize: '0.85rem', marginTop: 6 }}>
              Level {gameState.currentLevel} · {gameState.levelConfig?.name}
            </div>
          )}
        </Panel>
        <Panel>
          <div className="eyebrow">Players online</div>
          <div className="stat-value">{online}<span className="faint" style={{ fontSize: '1.4rem' }}> / {players.length}</span></div>
        </Panel>
        <Panel>
          <div className="eyebrow">Disconnected</div>
          <div className="stat-value" style={{ color: offline.length ? 'var(--bad)' : undefined }}>{offline.length}</div>
        </Panel>
        <Panel>
          <div className="eyebrow">Questions loaded</div>
          <div className="stat-value">{loaded?.count ?? 0}</div>
          {loaded?.by && <div className="dim" style={{ fontSize: '0.8rem', marginTop: 6 }}>by {loaded.by}</div>}
        </Panel>
      </div>

      {phase === 'question' && (
        <Panel bracketed>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <TimerRing value={timeLeft} max={gameState.currentQuestion?.timeLimit || 20} size={84} stroke={5} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow">Question {gameState.currentQuestionIndex + 1} of {gameState.totalQuestions}</div>
              <p style={{ fontWeight: 600, fontSize: '1.05rem', margin: '8px 0 12px' }}>{gameState.currentQuestion?.text}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="eyebrow">Answers in</span>
                <span className="mono" style={{ fontSize: '0.85rem' }}><strong>{answerCount.answered}</strong><span className="faint"> / {answerCount.total}</span></span>
              </div>
              <div className="meter"><span style={{ width: `${pct}%` }} /></div>
            </div>
          </div>
        </Panel>
      )}

      <Panel style={{ padding: 0 }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow">Players</span>
          {offline.length > 0 && <span className="pill pill-bad">{offline.length} need help reconnecting</span>}
        </div>
        {roster.length === 0 ? (
          <p className="dim" style={{ padding: '28px 20px', margin: 0, textAlign: 'center' }}>No players have joined yet</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Player</th><th>Status</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
              <tbody>
                {roster.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{p.connected ? <span className="pill pill-good">Online</span> : <span className="pill pill-bad">Disconnected</span>}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dim" style={{ fontSize: '0.8rem', margin: 0, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
          A disconnected player can reopen the quiz page on their phone — they rejoin automatically with their score,
          or re-enter their ticket ID on a new phone.
        </p>
      </Panel>
    </>
  );
}
