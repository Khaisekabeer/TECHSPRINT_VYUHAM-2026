import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Brand, QrCode, Rings, Rise, TimerRing, OPTION_LABELS } from '../components/ui';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby — join now',
  intro: 'Level briefing',
  question: 'Question live',
  leaderboard: 'Reveal',
  podium: 'Final results',
};

export default function BigScreen() {
  const { socket, isConnected } = useSocket();
  const [gameState, setGameState] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [questionResult, setQuestionResult] = useState<any>(null);
  const [answerCount, setAnswerCount] = useState({ answered: 0, total: 0 });
  const [serverInfo, setServerInfo] = useState<{ lanAddresses: string[] } | null>(null);

  const timeLeft = useCountdown(
    gameState?.state === 'question' ? gameState.questionEndsAt : null,
    gameState?.serverNow,
  );
  const maxTime = gameState?.currentQuestion?.timeLimit || 20;

  useEffect(() => {
    if (!isConnected) return;

    socket.on('game_state', (state) => {
      setGameState(state);
      if (state.state === 'question') setQuestionResult(null);
    });
    socket.on('players_list', setPlayers);
    socket.on('answer_count', setAnswerCount);
    socket.on('server_info', setServerInfo);
    socket.on('question_result', setQuestionResult);
    socket.emit('join_role', 'bigscreen');

    return () => {
      socket.off('game_state');
      socket.off('players_list');
      socket.off('answer_count');
      socket.off('server_info');
      socket.off('question_result');
    };
  }, [socket, isConnected]);

  // The address players should type: this page's own address, unless it was opened via localhost.
  const joinAddress = (() => {
    const { hostname, port } = window.location;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    const host = isLocal ? (serverInfo?.lanAddresses[0] ?? hostname) : hostname;
    return port && port !== '80' && port !== '443' ? `${host}:${port}` : host;
  })();

  const online = players.filter(p => p.connected).length;
  const level = gameState?.currentLevel ?? 1;
  const phase = gameState?.state ?? 'lobby';

  return (
    <div className="stage stage-grid" data-level={level} style={{ height: '100vh', minHeight: 0 }}>
      {/* Top bar */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 4vw', borderBottom: '1px solid var(--line)' }}>
        <Brand size="1.5rem" />
        <span className="eyebrow eyebrow-heat" style={{ fontSize: '0.8rem' }}>{PHASE_LABEL[phase]}</span>
        <span className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem' }}>
          <span className={`dot ${isConnected ? 'dot-live' : 'dot-off'}`} />
          <span className="tabular">{online}</span> online
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {!gameState && (
          <Centered>
            <Rings size="70vh" style={centerRings} />
            <p className="eyebrow">{isConnected ? 'Waiting for the host…' : 'Connecting to server…'}</p>
          </Centered>
        )}

        {phase === 'lobby' && gameState && <Lobby joinAddress={joinAddress} players={players} />}
        {phase === 'intro' && <Intro level={level} config={gameState.levelConfig} />}
        {phase === 'question' && (
          <Question gameState={gameState} timeLeft={timeLeft} maxTime={maxTime} answerCount={answerCount} level={level} />
        )}
        {phase === 'leaderboard' && <Reveal result={questionResult} players={players} />}
        {phase === 'podium' && <Podium board={(gameState.finalLeaderboard || players).filter((p: any) => p.status !== 'disqualified')} />}
      </div>
    </div>
  );
}

const centerRings: CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', position: 'relative' }}>
      {children}
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function Lobby({ joinAddress, players }: { joinAddress: string; players: any[] }) {
  return (
    <>
      <section style={{ flex: '1.15', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 4vw', position: 'relative', borderRight: '1px solid var(--line)' }}>
        <Rings size="120vh" style={{ top: '50%', left: '-78vh', transform: 'translateY(-50%)', opacity: 0.55 }} />
        <Rise className="eyebrow eyebrow-heat" style={{ fontSize: '0.85rem' }}>Vyuham '26 · Live tech quiz</Rise>
        <Rise d={100} as="h1" className="display" style={{ fontSize: 'clamp(4rem, 9vw, 11rem)', margin: '2vh 0 4vh' }}>
          TechSprint
        </Rise>

        <Rise d={260} className="panel panel-lg bracketed" style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '2.4vw', padding: '2.6vh 2.6vw 2.6vh 2.6vh' }}>
          <QrCode value={`${window.location.protocol}//${joinAddress}`} size="24vh" />
          <div>
            <div className="eyebrow" style={{ fontSize: '0.8rem', marginBottom: '1.4vh' }}>Scan, or open on your phone</div>
            <span className="mono heat" style={{ fontSize: 'clamp(1.6rem, 2.8vw, 3.4rem)', fontWeight: 600, letterSpacing: '-0.02em' }}>
              {joinAddress}
            </span>
          </div>
        </Rise>

        <Rise d={380} style={{ display: 'flex', gap: '3vw', marginTop: '5vh' }}>
          {['Connect to the venue Wi-Fi', 'Scan the code or type the address', 'Enter your name'].map((step, i) => (
            <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span className="display heat" style={{ fontSize: '2.2rem' }}>{i + 1}</span>
              <span className="dim" style={{ fontSize: '1.05rem', maxWidth: 160, lineHeight: 1.3 }}>{step}</span>
            </div>
          ))}
        </Rise>
      </section>

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '5vh 3.5vw', minWidth: 0 }}>
        <div style={{ marginBottom: '3vh' }}>
          <div className="eyebrow" style={{ fontSize: '0.8rem' }}>On the starting line</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
            <span className="display tabular heat" style={{ fontSize: 'clamp(5rem, 9vw, 9rem)', lineHeight: 0.9 }}>{players.length}</span>
            <span className="display display-700 dim" style={{ fontSize: '2rem' }}>{players.length === 1 ? 'player' : 'players'}</span>
          </div>
        </div>
        <div style={{
          flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 10,
          maskImage: 'linear-gradient(to bottom, black 80%, transparent)',
        }}>
          {players.length === 0 && <p className="dim" style={{ fontSize: '1.1rem' }}>Waiting for the first challenger…</p>}
          {[...players].reverse().map(p => (
            <span key={p.id} className="chip pop" style={{ fontSize: '0.95rem', letterSpacing: '0.02em', textTransform: 'none', fontFamily: 'var(--font-body)', fontWeight: 600, padding: '9px 16px', opacity: p.connected ? 1 : 0.4 }}>
              {p.name}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Level intro ──────────────────────────────────────────────────────────────
function Intro({ level, config }: { level: number; config: any }) {
  return (
    <Centered>
      <Rings size="95vh" style={centerRings} />
      <Rise className="eyebrow" style={{ fontSize: '1rem' }}>Level</Rise>
      <div className="display heat slam" style={{ fontSize: '42vh', lineHeight: 0.8, margin: '1vh 0 2vh' }}>
        {String(level).padStart(2, '0')}
      </div>
      <Rise d={300} as="h2" className="display" style={{ fontSize: 'clamp(3rem, 7vw, 7rem)' }}>{config?.name}</Rise>
      <Rise d={450} style={{ marginTop: '3vh' }}>
        <span className="chip chip-heat" style={{ fontSize: '0.9rem', padding: '10px 18px' }}>× {config?.multiplier} points per answer</span>
      </Rise>
    </Centered>
  );
}

// ─── Question ─────────────────────────────────────────────────────────────────
function Question({ gameState, timeLeft, maxTime, answerCount, level }: {
  gameState: any; timeLeft: number; maxTime: number; answerCount: { answered: number; total: number }; level: number;
}) {
  const q = gameState.currentQuestion;
  const pct = answerCount.total ? (answerCount.answered / answerCount.total) * 100 : 0;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '3.5vh 4vw 4vh', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2.5vw' }}>
        <div>
          <div className="eyebrow" style={{ fontSize: '0.8rem' }}>Question</div>
          <div className="display tabular" style={{ fontSize: '4.5rem' }}>
            {gameState.currentQuestionIndex + 1}<span className="faint" style={{ fontSize: '2.4rem' }}> / {gameState.totalQuestions}</span>
          </div>
        </div>
        <span className="chip chip-heat" style={{ fontSize: '0.8rem', padding: '9px 16px' }}>Level {level} · {gameState.levelConfig?.name}</span>

        <div style={{ flex: 1, maxWidth: 420, marginLeft: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="eyebrow" style={{ fontSize: '0.75rem' }}>Answers in</span>
            <span className="mono tabular" style={{ fontSize: '1.1rem' }}>
              <strong className="heat">{answerCount.answered}</strong><span className="faint"> / {answerCount.total}</span>
            </span>
          </div>
          <div className="meter" style={{ height: 6 }}><span style={{ width: `${pct}%` }} /></div>
        </div>
        <TimerRing value={timeLeft} max={maxTime} size={128} stroke={6} />
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3vh 2vw' }}>
        <h2 key={q?.id} className="rise" style={{
          margin: 0, maxWidth: 1400, textAlign: 'center', fontWeight: 600,
          fontSize: 'clamp(2rem, 3.6vw, 4.4rem)', lineHeight: 1.18, letterSpacing: '-0.02em', textWrap: 'balance',
        }}>
          {q?.text}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.6vh 1.4vw' }}>
        {q?.options?.map((opt: string, idx: number) => (
          <div key={idx} data-opt={idx} className="pop" style={{
            ['--d' as string]: `${200 + idx * 90}ms`,
            display: 'flex', alignItems: 'stretch', minHeight: '11vh', overflow: 'hidden',
            background: 'var(--ink-0)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)',
            borderLeft: '0',
          }}>
            <span className="display" style={{
              width: '5.5vw', minWidth: 72, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--opt)', color: 'var(--on-opt)', fontSize: 'clamp(2.4rem, 3.4vw, 4rem)',
            }}>{OPTION_LABELS[idx]}</span>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 1.8vw', fontSize: 'clamp(1.3rem, 2vw, 2.4rem)', fontWeight: 600 }}>{opt}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Reveal: answer distribution + standings ──────────────────────────────────
function Reveal({ result, players }: { result: any; players: any[] }) {
  const stats: [string, number][] = result ? Object.entries(result.stats || {}) as [string, number][] : [];
  const maxCount = Math.max(1, ...stats.map(([, n]) => n));
  const totalAnswers = stats.reduce((sum, [, n]) => sum + n, 0);
  const board: any[] = (result?.leaderboard || players.filter(p => (p.status ?? 'active') === 'active')).slice(0, 8);
  const cut = result?.elimination;

  return (
    <>
      <section style={{ flex: 1.1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4vh 4vw', borderRight: '1px solid var(--line)', minWidth: 0 }}>
        <Rise className="eyebrow" style={{ fontSize: '0.8rem' }}>The answer</Rise>
        <Rise d={80} as="h2" className="display slam" style={{ fontSize: 'clamp(3rem, 5.5vw, 6.5rem)', color: 'var(--good)', margin: '1.5vh 0 4vh', overflowWrap: 'anywhere' }}>
          {result?.correctAnswer ?? '—'}
        </Rise>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6vh' }}>
          {stats.map(([option, count], idx) => {
            const correct = option === result.correctAnswer;
            return (
              <div key={option} data-opt={idx} className="rise" style={{ ['--d' as string]: `${200 + idx * 100}ms`, display: 'flex', alignItems: 'center', gap: 16, opacity: correct ? 1 : 0.45 }}>
                <span className="display" style={{
                  width: 52, height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--opt)', color: 'var(--on-opt)', fontSize: '2rem', borderRadius: 4,
                }}>{correct ? '✓' : OPTION_LABELS[idx]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 8, fontSize: '1.15rem', fontWeight: 600 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option}</span>
                    <span className="mono tabular">{count}</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(count / maxCount) * 100}%`, height: '100%', background: 'var(--opt)',
                      transformOrigin: 'left', animation: `grow-x 0.9s var(--ease-out) ${300 + idx * 100}ms backwards`,
                    }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: '4vh', flexWrap: 'wrap' }}>
          {result && <Rise d={700}><span className="chip" style={{ fontSize: '0.8rem', padding: '10px 16px' }}>{totalAnswers} answered</span></Rise>}
          {result?.speedStar && (
            <Rise d={800}><span className="chip chip-gold" style={{ fontSize: '0.8rem', padding: '10px 16px' }}>⚡ Fastest correct · {result.speedStar}</span></Rise>
          )}
        </div>
        {cut && (
          <Rise d={900} className="panel bracketed" style={{ marginTop: '3vh', padding: '2vh 1.6vw' }}>
            <div className="eyebrow eyebrow-heat" style={{ fontSize: '0.8rem' }}>End of {cut.levelName}</div>
            <div className="display" style={{ fontSize: 'clamp(1.8rem, 2.6vw, 3rem)', marginTop: 6 }}>
              Top {cut.qualifyTop} advance{cut.eliminated.length > 0 ? ` · ${cut.eliminated.length} eliminated` : ''}
            </div>
          </Rise>
        )}
      </section>

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4vh 4vw', minWidth: 0 }}>
        <Rise className="eyebrow" style={{ fontSize: '0.8rem', marginBottom: '3vh' }}>Standings</Rise>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1vh' }}>
          {board.map((p: any, idx: number) => (
            <div key={p.id} className="rise" style={{
              ['--d' as string]: `${150 + idx * 70}ms`,
              display: 'flex', alignItems: 'center', gap: 20, padding: '1.4vh 1.4vw',
              background: idx === 0 ? 'var(--heat)' : 'var(--ink-0)',
              boxShadow: idx === 0 ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
              color: idx === 0 ? 'var(--ink-0)' : 'var(--bone)',
              border: '1px solid', borderColor: idx === 0 ? 'var(--heat)' : 'var(--line)', borderRadius: 'var(--radius)',
            }}>
              <span className="display tabular" style={{ width: 48, fontSize: '2.2rem', opacity: idx === 0 ? 1 : 0.55 }}>{idx + 1}</span>
              <span style={{ flex: 1, fontSize: '1.35rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {p.streak >= 3 && <span className="mono" style={{ fontSize: '0.8rem' }}>🔥{p.streak}</span>}
              <span className="display tabular" style={{ fontSize: '1.9rem' }}>{p.score}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Podium ───────────────────────────────────────────────────────────────────
function Podium({ board }: { board: any[] }) {
  // Classic podium order: 2nd, 1st, 3rd
  const slots = [
    { p: board[1], place: 2, height: '26vh', delay: 500 },
    { p: board[0], place: 1, height: '38vh', delay: 900 },
    { p: board[2], place: 3, height: '18vh', delay: 200 },
  ];
  const rest = board.slice(3, 10);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '4vh 4vw 0' }}>
      <Rings size="150vh" style={{ top: '100%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5 }} />
      <Rise className="eyebrow eyebrow-heat" style={{ fontSize: '0.9rem' }}>TechSprint · Vyuham '26 · Final results</Rise>
      <Rise d={100} as="h1" className="display" style={{ fontSize: 'clamp(3.5rem, 6vw, 7rem)', margin: '1vh 0 0' }}>Sprint champions</Rise>

      <div style={{ flex: 1, width: '100%', maxWidth: 1300, display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: '1.5vw', alignItems: 'end' }}>
        {slots.map(({ p, place, height, delay }) => (
          <div key={place} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
            {p && (
              <div className="pop" style={{ ['--d' as string]: `${delay + 500}ms`, textAlign: 'center', marginBottom: '2vh', maxWidth: '100%' }}>
                <div style={{ fontSize: place === 1 ? 'clamp(2rem, 3.2vw, 3.6rem)' : 'clamp(1.5rem, 2.3vw, 2.6rem)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div className="mono tabular dim" style={{ fontSize: '1.1rem', marginTop: 6 }}>{p.score} pts</div>
              </div>
            )}
            <div style={{
              width: '100%', height,
              background: place === 1
                ? 'linear-gradient(180deg, var(--heat), color-mix(in srgb, var(--heat) 55%, var(--ink-0)))'
                : 'linear-gradient(180deg, var(--ink-3), var(--ink-1))',
              border: '1px solid', borderColor: place === 1 ? 'var(--heat)' : 'var(--line-strong)', borderBottom: 0,
              borderRadius: 'var(--radius) var(--radius) 0 0',
              display: 'flex', justifyContent: 'center', paddingTop: '2vh',
              transformOrigin: 'bottom', animation: `grow-y 0.9s var(--ease-out) ${delay}ms backwards`,
            }}>
              <span className="display" style={{ fontSize: place === 1 ? '9vh' : '7vh', color: place === 1 ? 'var(--ink-0)' : 'var(--bone-dim)' }}>{place}</span>
            </div>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <Rise d={1600} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', padding: '2.5vh 0' }}>
          {rest.map((p: any, i: number) => (
            <span key={p.id} className="chip" style={{ fontSize: '0.8rem' }}>{i + 4}. {p.name} · {p.score}</span>
          ))}
        </Rise>
      )}
    </div>
  );
}
