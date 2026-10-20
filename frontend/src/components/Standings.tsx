import type { CSSProperties } from 'react';
import { Avatar } from './ui';

export interface StandingPlayer {
  id: string;
  name: string;
  avatar?: string | null;
  score: number;
  streak?: number;
  connected?: boolean;
}

// Everyone still in the game, on one screen. The layout follows the size of the field:
//   crowd (31+)      dense tiles, ~10 rows, as many columns as needed (80 players → 8 × 10)
//   pack (11–30)     rows in 2–3 columns
//   finalists (≤10)  big character cards
// cutAfter: when this level ends with a cut, players below the top N are shown at risk.
export function Standings({ players, cutAfter, style }: { players: StandingPlayer[]; cutAfter?: number | null; style?: CSSProperties }) {
  const n = players.length;
  const tier = n <= 10 ? 'finalists' : n <= 30 ? 'pack' : 'crowd';
  const cols = tier === 'finalists' ? (n <= 5 ? 1 : 2) : tier === 'pack' ? (n <= 20 ? 2 : 3) : Math.min(12, Math.ceil(n / 10));
  const rows = Math.max(1, Math.ceil(n / cols));
  const avatarSize = tier === 'finalists' ? 'clamp(44px, 8vh, 96px)' : tier === 'pack' ? 'clamp(28px, 4.4vh, 52px)' : 'clamp(18px, 2.8vh, 32px)';

  return (
    <div
      className={`standings ${tier}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, ...style }}
    >
      {players.map((p, i) => {
        const rank = i + 1;
        const cls = [
          'st-row', 'rise',
          rank === 1 ? 'first' : rank <= 3 ? 'podium' : '',
          cutAfter && rank > cutAfter ? 'danger' : '',
          p.connected === false ? 'offline' : '',
        ].join(' ');
        return (
          <div key={p.id} className={cls} style={{ ['--d' as string]: `${Math.min(i * (tier === 'crowd' ? 12 : 45), 900)}ms` }}>
            <span className="st-rank">{rank}</span>
            <Avatar id={p.avatar} size={avatarSize} />
            {tier === 'crowd' ? (
              // Narrow tiles: score under the name so the name gets the full width.
              <span className="st-stack">
                <span className="st-name">{p.name}</span>
                <span className="st-score">{p.score}</span>
              </span>
            ) : (
              <>
                <span className="st-name">{p.name}</span>
                {(p.streak ?? 0) >= 3 && <span aria-label={`${p.streak} correct in a row`}>🔥</span>}
                <span className="st-score">{p.score}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
