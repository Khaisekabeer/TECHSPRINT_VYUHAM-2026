import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Avatar } from './ui';

export interface StandingPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  score: number;
  streak?: number;
  connected?: boolean;
  prevRank?: number | null;  // rank before this question (for the animation)
  prevScore?: number | null; // score before this question
  time?: number;             // total answer time in ms (the tie-break)
}

const seconds = (ms?: number) => (ms == null ? null : <span className="st-time">{(ms / 1000).toFixed(1)}s</span>);

const SETTLE_MS = 1400; // how long the old order stays on screen before moving
const MOVE_MS = 900;

// Score that counts up from `from` to `to` once `run` turns true.
function CountUp({ from, to, run }: { from: number; to: number; run: boolean }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!run || from === to) { setValue(run ? to : from); return; }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MOVE_MS);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (to - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, run]);
  return <>{value}</>;
}

// Everyone still in the game, on one screen. The layout follows the size of the field:
//   crowd (31+)      dense tiles, ~10 rows, as many columns as needed (80 players → 8 × 10)
//   pack (11–30)     rows in 2–3 columns
//   finalists (≤10)  big character cards
// Each reveal first shows the previous order and scores, then every row slides to its new rank
// while the score counts up (▲/▼ shows the change). atRisk: players below the level's cut line.
export function Standings({ players, atRisk, style }: { players: StandingPlayer[]; atRisk?: string[] | null; style?: CSSProperties }) {
  const n = players.length;
  const tier = n <= 10 ? 'finalists' : n <= 30 ? 'pack' : 'crowd';
  const cols = tier === 'finalists' ? (n <= 5 ? 1 : 2) : tier === 'pack' ? (n <= 20 ? 2 : 3) : Math.min(12, Math.ceil(n / 10));
  const rows = Math.max(1, Math.ceil(n / cols));
  const avatarSize = tier === 'finalists' ? 'clamp(44px, 8vh, 96px)' : tier === 'pack' ? 'clamp(28px, 4.4vh, 52px)' : 'clamp(18px, 2.8vh, 32px)';

  // Old order first, then the new one.
  const changed = players.some((p, i) => p.prevRank != null && (p.prevRank !== i + 1 || (p.prevScore ?? p.score) !== p.score));
  const signature = players.map(p => `${p.id}:${p.score}:${p.prevRank ?? ''}`).join('|');
  const [settled, setSettled] = useState(!changed);
  useEffect(() => {
    if (!changed) { setSettled(true); return; }
    setSettled(false);
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const rankOf = new Map(players.map((p, i) => [p.id, i + 1]));
  const shown = settled
    ? players
    : [...players].sort((a, b) => (a.prevRank ?? 1e6) - (b.prevRank ?? 1e6) || (rankOf.get(a.id)! - rankOf.get(b.id)!));
  const risk = new Set(settled ? atRisk ?? [] : []);

  // FLIP: rows that moved slide from where they were to where they are now.
  const els = useRef(new Map<string, HTMLDivElement>());
  const lastRects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const rects = new Map<string, DOMRect>();
    els.current.forEach((el, id) => rects.set(id, el.getBoundingClientRect()));
    rects.forEach((rect, id) => {
      const old = lastRects.current.get(id);
      const el = els.current.get(id);
      if (!old || !el) return;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: MOVE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    });
    lastRects.current = rects;
  });

  return (
    <div
      className={`standings ${tier}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, ...style }}
    >
      {shown.map((p, i) => {
        const rank = settled ? i + 1 : p.prevRank ?? i + 1;
        const delta = settled && p.prevRank != null ? p.prevRank - (i + 1) : 0;
        const cls = [
          'st-row',
          rank === 1 ? 'first' : rank <= 3 ? 'podium' : '',
          risk.has(p.id) ? 'danger' : '',
          p.connected === false ? 'offline' : '',
        ].join(' ');
        const score = <CountUp from={p.prevScore ?? p.score} to={p.score} run={settled} />;
        return (
          <div key={p.id} ref={el => { if (el) els.current.set(p.id, el); else els.current.delete(p.id); }} className={cls}>
            <span className="st-rank">{rank}</span>
            <Avatar id={p.avatar} size={avatarSize} />
            {tier === 'crowd' ? (
              // Narrow tiles: score under the name so the name gets the full width.
              <span className="st-stack">
                <span className="st-name">{p.name}</span>
                <span className="st-score">{score} {seconds(p.time)}{delta !== 0 && <span className={`st-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>}</span>
              </span>
            ) : (
              <>
                <span className="st-name">{p.name}</span>
                {delta !== 0 && <span className={`st-delta ${delta > 0 ? 'up' : 'down'}`} aria-label={`${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}`}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</span>}
                {(p.streak ?? 0) >= 3 && <span aria-label={`${p.streak} correct in a row`}>🔥</span>}
                {seconds(p.time)}
                <span className="st-score">{score}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
