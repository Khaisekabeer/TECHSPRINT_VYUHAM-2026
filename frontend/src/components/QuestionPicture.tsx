import type { CSSProperties } from 'react';
import { useSocket } from '../contexts/SocketContext';

// A question's picture, served by the game server while its question is live (see game.js liveImage).
export default function QuestionPicture({ path, maxHeight, style }: { path: string; maxHeight: string; style?: CSSProperties }) {
  const { serverUrl } = useSocket();
  return (
    <img
      src={`${serverUrl}${path}`}
      alt="Question picture"
      style={{ display: 'block', maxWidth: '100%', maxHeight, width: 'auto', margin: '0 auto', objectFit: 'contain', borderRadius: 'var(--radius)', ...style }}
    />
  );
}
