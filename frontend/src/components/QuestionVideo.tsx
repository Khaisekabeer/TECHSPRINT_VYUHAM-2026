import type { CSSProperties } from 'react';

// A question's video. The link comes from the game server and is only sent while the question is live.
export default function QuestionVideo({ src, maxHeight, style }: { src: string; maxHeight: string; style?: CSSProperties }) {
  return (
    <video
      src={src}
      controls
      autoPlay
      playsInline
      style={{ display: 'block', width: '100%', maxHeight, margin: '0 auto', background: '#000', borderRadius: 'var(--radius)', ...style }}
    />
  );
}
