import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useCountdown } from '../hooks/useCountdown';
import { Avatar, Burst, ComicBg, QrCode, Rise, TimerRing, VyuhamLogo, OPTION_LABELS } from '../components/ui';
import { Standings } from '../components/Standings';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Join now',
  intro: 'Get ready',
  question: 'Question live',
  leaderboard: 'Reveal',
  podium: 'Final results',
};

// The projector. Lobby and podium use the event theme; each level brings its own theme
// (set by the quiz master), so every round looks different.
export default function BigScreen() {
  const { socket, isConnected, serverUrl } = useSocket();
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

  const active = players.filter(p => (p.status ?? 'active') === 'active');
  const online = active.filter(p => p.connected).length;
  const phase = gameState?.state ?? 'lobby';
  const inLevel = phase === 'intro' || phase === 'question' || phase === 'leaderboard';
  const theme = inLevel ? gameState?.levelConfig?.theme ?? 'blast' : 'blast';
  // Question pictures come from the live game server, only once the question is live.
  const imageUrl = (index: number) => `${serverUrl}/live-image/${index}?t=${gameState?.questionStartTime ?? 0}`;

  return (
    <div className="stage" data-theme={theme} style={{ height: '100vh', minHeight: 0 }}>
      <ComicBg slashes={theme === 'pop'} />

      <header style={{ display: 'flex', alignItems: 'center', gap: '1.4vw', padding: '1.8vh 2.4vw' }}>
        <div className="comic-panel" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0.8vh 1.4vw 0.8vh 0.9vw', boxShadow: '4px 4px 0 var(--t-ink)' }}>
          <VyuhamLogo height="5.2vh" />
          <span className="comic-text" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.2rem)', lineHeight: 1 }}>TechSprint</span>
          <span className="eyebrow" style={{ fontSize: '0.75rem', color: '#555' }}>Vyuham '26</span>
        </div>
        <span style={{ flex: 1 }} />
        {inLevel && gameState?.levelConfig && (
          <span className="comic-badge light" style={{ fontSize: 'clamp(0.9rem, 1.3vw, 1.4rem)' }}>
            Round {gameState.currentLevel}/{gameState.totalLevels} · {gameState.levelConfig.name}
          </span>
        )}
        <span className="comic-badge" style={{ fontSize: 'clamp(0.9rem, 1.3vw, 1.4rem)' }}>{PHASE_LABEL[phase]}</span>
        <span className="comic-badge light" style={{ fontSize: 'clamp(0.9rem, 1.3vw, 1.4rem)' }}>
          <span className={`dot ${isConnected ? 'dot-live' : 'dot-off'}`} />
          <span className="tabular">{online}</span> online
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {!gameState && (
          <Centered>
            <Burst style={{ padding: '6vh 7vw' }}>
              <h1 className="comic-title" style={{ fontSize: '9vh' }}>{isConnected ? 'Get ready!' : 'Connecting…'}</h1>
            </Burst>
          </Centered>
        )}

        {phase === 'lobby' && gameState && <Lobby joinAddress={joinAddress} players={active} />}
        {phase === 'intro' && <Intro gameState={gameState} />}
        {phase === 'question' && (
          <Question gameState={gameState} timeLeft={timeLeft} maxTime={maxTime} answerCount={answerCount} imageUrl={imageUrl} />
        )}
        {phase === 'leaderboard' && <Reveal result={questionResult} players={active} gameState={gameState} imageUrl={imageUrl} />}
        {phase === 'podium' && <Podium board={(gameState.finalLeaderboard || players).filter((p: any) => p.status !== 'disqualified')} />}
      </div>
    </div>
  );
}

function Centered({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', position: 'relative', ...style }}>
      {children}
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function Lobby({ joinAddress, players }: { joinAddress: string; players: any[] }) {
  // Smaller chips as the room fills up, so 80+ players still fit.
  const chipSize = players.length > 60 ? 'sm' : players.length > 24 ? 'md' : 'lg';
  const avatar = chipSize === 'sm' ? 22 : chipSize === 'md' ? 30 : 40;
  return (
    <>
      <section style={{ flex: '1.1', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', padding: '0 3vw 4vh 4vw', gap: '4vh' }}>
        <Rise>
          <Burst style={{ padding: '7vh 6vw 8vh' }}>
            <div style={{ textAlign: 'center' }}>
              <h1 className="comic-title slam" style={{ fontSize: 'clamp(4rem, 9vw, 11rem)' }}>Tech<br />Sprint</h1>
            </div>
          </Burst>
        </Rise>

        <Rise d={260} className="comic-panel window" style={{ display: 'flex', alignItems: 'center', gap: '2vw', padding: '2.4vh 2.4vw' }}>
          <QrCode value={`${window.location.protocol}//${joinAddress}`} size="22vh" />
          <div>
            <div className="comic-text" style={{ fontSize: 'clamp(1.1rem, 1.6vw, 1.8rem)', marginBottom: '1vh' }}>Scan to play!</div>
            <span className="mono" style={{ fontSize: 'clamp(1.2rem, 2.2vw, 2.8rem)', fontWeight: 600, letterSpacing: '-0.02em' }}>{joinAddress}</span>
            <div className="dim" style={{ fontSize: 'clamp(0.85rem, 1.1vw, 1.15rem)', marginTop: '1.4vh', color: '#444' }}>
              Enter the ticket ID on your pass · pick your character
            </div>
          </div>
        </Rise>
      </section>

      <section style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '3vh 3.5vw 4vh 1vw', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: '2.4vh' }}>
          <span className="comic-title tabular" style={{ fontSize: 'clamp(5rem, 10vw, 10rem)' }}>{players.length}</span>
          <span className="comic-text" style={{ fontSize: 'clamp(1.6rem, 2.6vw, 3rem)' }}>{players.length === 1 ? 'player in!' : 'players in!'}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: chipSize === 'sm' ? 6 : 10 }}>
          {players.length === 0 && <p className="comic-text" style={{ fontSize: '1.6rem' }}>Waiting for the first challenger…</p>}
          {[...players].reverse().map(p => (
            <span key={p.id} className="pop" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: chipSize === 'sm' ? '3px 10px 3px 3px' : '4px 14px 4px 4px',
              background: '#fff', border: '2px solid var(--t-ink)', borderRadius: 999, boxShadow: '2px 2px 0 var(--t-ink)',
              fontWeight: 700, fontSize: chipSize === 'sm' ? '0.8rem' : chipSize === 'md' ? '0.95rem' : '1.1rem', opacity: p.connected ? 1 : 0.45,
            }}>
              <Avatar id={p.avatar} size={avatar} />
              {p.name}
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Level intro ──────────────────────────────────────────────────────────────
function Intro({ gameState }: { gameState: any }) {
  const config = gameState.levelConfig || {};
  return (
    <Centered style={{ gap: '3vh' }}>
      <Rise><span className="comic-badge light" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.2rem)' }}>Round {gameState.currentLevel} of {gameState.totalLevels}</span></Rise>
      <Burst style={{ padding: '9vh 9vw 10vh' }}>
        <h1 className="comic-title slam" style={{ fontSize: 'clamp(4rem, 10vw, 12rem)', maxWidth: '62vw', textAlign: 'center' }}>{config.name}</h1>
      </Burst>
      <Rise d={450} style={{ display: 'flex', gap: '1.4vw', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span className="comic-badge" style={{ fontSize: 'clamp(1.1rem, 1.8vw, 2rem)' }}>× {config.multiplier} points</span>
        {config.cutAfter && (
          <span className="comic-badge light" style={{ fontSize: 'clamp(1.1rem, 1.8vw, 2rem)' }}>✂ Top {config.cutAfter} go through</span>
        )}
        <span className="comic-badge light" style={{ fontSize: 'clamp(1.1rem, 1.8vw, 2rem)' }}>{gameState.playersLeft} players</span>
      </Rise>
    </Centered>
  );
}

// ─── Question ─────────────────────────────────────────────────────────────────
function Question({ gameState, timeLeft, maxTime, answerCount, imageUrl }: {
  gameState: any; timeLeft: number; maxTime: number; answerCount: { answered: number; total: number }; imageUrl: (i: number) => string;
}) {
  const q = gameState.currentQuestion;
  const pct = answerCount.total ? (answerCount.answered / answerCount.total) * 100 : 0;
  const withImage = !!q?.hasImage;

  const options = (
    <div style={{ display: 'grid', gridTemplateColumns: withImage ? '1fr' : '1fr 1fr', gap: '1.6vh 1.4vw' }}>
      {q?.options?.map((opt: string, idx: number) => (
        <div key={idx} data-opt={idx} className="opt-tile pop" style={{
          ['--d' as string]: `${200 + idx * 90}ms`, display: 'flex', alignItems: 'stretch', minHeight: withImage ? '9vh' : '11vh', overflow: 'hidden',
        }}>
          <span className="comic-text" style={{
            width: '5.2vw', minWidth: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '3px solid var(--t-ink)',
            background: 'var(--opt)', color: 'var(--on-opt)', fontSize: 'clamp(2.2rem, 3.2vw, 3.8rem)',
          }}>{OPTION_LABELS[idx]}</span>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 1.6vw', fontSize: withImage ? 'clamp(1.2rem, 1.8vw, 2.1rem)' : 'clamp(1.3rem, 2vw, 2.4rem)', fontWeight: 700, color: '#111' }}>{opt}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 3vw 3.5vh', minWidth: 0, gap: '2.4vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2vw' }}>
        <span className="comic-badge light" style={{ fontSize: 'clamp(1.3rem, 2.2vw, 2.6rem)' }}>
          Q{gameState.currentQuestionIndex + 1}<span style={{ opacity: 0.5 }}>/{gameState.totalQuestions}</span>
        </span>
        <div className="comic-panel" style={{ flex: 1, maxWidth: 460, marginLeft: 'auto', padding: '1.2vh 1.2vw', boxShadow: '4px 4px 0 var(--t-ink)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="comic-text" style={{ fontSize: '1rem' }}>Answers in</span>
            <span className="comic-text tabular" style={{ fontSize: '1.2rem' }}>{answerCount.answered} / {answerCount.total}</span>
          </div>
          <div className="meter" style={{ height: 10, border: '2px solid var(--t-ink)', background: '#fff' }}><span style={{ width: `${pct}%`, background: 'var(--t-accent)' }} /></div>
        </div>
        <div className="timer-disc"><TimerRing value={timeLeft} max={maxTime} size={120} stroke={7} /></div>
      </div>

      {withImage ? (
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '2.4vw' }}>
          <div className="pop" style={{ minHeight: 0 }}>
            <img key={q.id ?? gameState.currentQuestionIndex} className="q-image" src={imageUrl(gameState.currentQuestionIndex)} alt="Question picture" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3vh', minWidth: 0 }}>
            <h2 className="comic-panel window rise" style={{ margin: 0, padding: '2.2vh 1.8vw', fontWeight: 700, fontSize: 'clamp(1.6rem, 2.6vw, 3.2rem)', lineHeight: 1.2, textWrap: 'balance' }}>{q?.text}</h2>
            {options}
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1vh 2vw' }}>
            <h2 key={q?.id} className="comic-panel window rise" style={{
              margin: 0, maxWidth: 1500, padding: '3.4vh 3vw', textAlign: 'center', fontWeight: 700,
              fontSize: 'clamp(2rem, 3.6vw, 4.4rem)', lineHeight: 1.16, letterSpacing: '-0.01em', textWrap: 'balance',
            }}>
              {q?.text}
            </h2>
          </div>
          {options}
        </>
      )}
    </div>
  );
}

// ─── Reveal: the answer, how people voted, and everyone's standing ────────────
function Reveal({ result, players, gameState, imageUrl }: { result: any; players: any[]; gameState: any; imageUrl: (i: number) => string }) {
  const stats: [string, number][] = result ? Object.entries(result.stats || {}) as [string, number][] : [];
  const maxCount = Math.max(1, ...stats.map(([, n]) => n));
  const totalAnswers = stats.reduce((sum, [, n]) => sum + n, 0);
  const board: any[] = result?.leaderboard || players;
  const cut = result?.elimination;
  // Before this level's cut, show who is at risk; once it has happened, only survivors remain.
  const atRiskAfter = cut ? null : gameState?.levelConfig?.cutAfter ?? null;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '0 2.4vw 2.6vh', gap: '2vh' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '1.6vw' }}>
        {result?.hasImage && (
          <img className="q-image pop" src={imageUrl(result.questionIndex)} alt="" style={{ width: '14vh', height: '14vh', flexShrink: 0 }} />
        )}
        <Burst style={{ padding: '2.6vh 3.4vw', flexShrink: 0, maxWidth: '40vw' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="comic-text" style={{ fontSize: 'clamp(0.9rem, 1.2vw, 1.3rem)', color: '#333' }}>The answer</div>
            <div className="comic-title" style={{ fontSize: 'clamp(1.8rem, 3.6vw, 4.2rem)', color: '#22c55e', overflowWrap: 'anywhere' }}>{result?.correctAnswer ?? '—'}</div>
          </div>
        </Burst>

        <div className="comic-panel" style={{ flex: 1, minWidth: 0, padding: '1.4vh 1.4vw', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.9vh' }}>
          {stats.map(([option, count], idx) => {
            const correct = option === result.correctAnswer;
            return (
              <div key={option} data-opt={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: correct ? 1 : 0.5 }}>
                <span className="comic-text" style={{ width: 34, height: 34, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'var(--opt)', border: '2px solid #111', borderRadius: 8, fontSize: '1.2rem' }}>
                  {correct ? '✓' : OPTION_LABELS[idx]}
                </span>
                <span style={{ width: '24%', minWidth: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option}</span>
                <div style={{ flex: 1, height: 14, background: '#eee', border: '2px solid #111', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / maxCount) * 100}%`, height: '100%', background: 'var(--opt)', transformOrigin: 'left', animation: `grow-x 0.9s var(--ease-out) ${300 + idx * 100}ms backwards` }} />
                </div>
                <span className="comic-text tabular" style={{ width: 40, textAlign: 'right' }}>{count}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '1vh', flexShrink: 0 }}>
          <span className="comic-badge light">{totalAnswers} answered</span>
          {result?.speedStar && <span className="comic-badge">⚡ {result.speedStar}</span>}
          {atRiskAfter && <span className="comic-badge light">✂ Top {atRiskAfter} go through</span>}
        </div>
      </div>

      {cut && (
        <Rise className="comic-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2vw', padding: '1.2vh 2vw', background: 'var(--t-accent)', color: '#fff' }}>
          <span className="comic-title" style={{ fontSize: 'clamp(1.6rem, 2.8vw, 3.2rem)', color: '#fff' }}>End of {cut.levelName}!</span>
          <span className="comic-text" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.2rem)' }}>
            Top {cut.qualifyTop} advance{cut.eliminated.length > 0 ? ` · ${cut.eliminated.length} eliminated` : ''}
          </span>
        </Rise>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <Standings players={board} cutAfter={atRiskAfter} />
      </div>
    </div>
  );
}

// ─── Podium ───────────────────────────────────────────────────────────────────
function Podium({ board }: { board: any[] }) {
  // Classic podium order: 2nd, 1st, 3rd
  const slots = [
    { p: board[1], place: 2, height: '22vh', delay: 500, color: '#e5e7eb' },
    { p: board[0], place: 1, height: '32vh', delay: 900, color: 'var(--t-title)' },
    { p: board[2], place: 3, height: '15vh', delay: 200, color: '#fdba74' },
  ];
  const rest = board.slice(3, 10);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', padding: '0 4vw' }}>
      <Burst style={{ padding: '2.6vh 5vw 3.4vh', marginBottom: '3vh' }}>
        <h1 className="comic-title slam" style={{ fontSize: 'clamp(3rem, 6vw, 7rem)' }}>Champions!</h1>
      </Burst>

      <div style={{ flex: 1, width: '100%', maxWidth: 1300, display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: '2vw', alignItems: 'end' }}>
        {slots.map(({ p, place, height, delay, color }) => (
          <div key={place} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
            {p && (
              <div className="pop" style={{ ['--d' as string]: `${delay + 500}ms`, display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1.6vh', maxWidth: '100%' }}>
                <Avatar id={p.avatar} size={place === 1 ? '15vh' : '12vh'} style={{ border: '4px solid var(--t-ink)', boxShadow: '5px 5px 0 var(--t-ink)' }} />
                <div className="comic-text" style={{ marginTop: '1.2vh', fontSize: place === 1 ? 'clamp(2rem, 3.2vw, 3.6rem)' : 'clamp(1.4rem, 2.2vw, 2.6rem)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <span className="comic-badge light" style={{ fontSize: '1.1rem', marginTop: 6 }}>{p.score} pts</span>
              </div>
            )}
            <div className="comic-panel" style={{
              width: '100%', height, background: color, borderRadius: '16px 16px 0 0', borderBottom: 0,
              display: 'flex', justifyContent: 'center', paddingTop: '1.6vh',
              transformOrigin: 'bottom', animation: `grow-y 0.9s var(--ease-out) ${delay}ms backwards`,
            }}>
              <span className="comic-title" style={{ fontSize: place === 1 ? '10vh' : '7vh' }}>{place}</span>
            </div>
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <Rise d={1600} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', padding: '2vh 0' }}>
          {rest.map((p: any, i: number) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 14px 4px 4px', background: '#fff', border: '2px solid var(--t-ink)', borderRadius: 999, boxShadow: '2px 2px 0 var(--t-ink)', fontWeight: 700 }}>
              <Avatar id={p.avatar} size={30} /> {i + 4}. {p.name} · {p.score}
            </span>
          ))}
        </Rise>
      )}
      <div style={{ position: 'absolute', right: '2vw', bottom: '2vh' }}><VyuhamLogo height="10vh" /></div>
    </div>
  );
}
