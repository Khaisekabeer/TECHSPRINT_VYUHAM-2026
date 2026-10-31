import { useEffect, useRef, type CSSProperties } from 'react';

export type VideoCommand = { action: 'play' | 'pause' | 'replay'; at: number };
export type VideoStatus = 'playing' | 'paused' | 'ended' | 'error';

// A question's video. The link comes from the game server and is only sent while it plays. The host
// plays, pauses and replays it from the console; only the host moves on to the question.
export default function QuestionVideo({ src, maxHeight, command, onStatus, style }: {
  src: string; maxHeight: string; command?: VideoCommand | null; onStatus?: (status: VideoStatus) => void; style?: CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const play = (video: HTMLVideoElement) => video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => { /* the controls are still there */ });
  });

  // Browsers can refuse to autoplay with sound. Then play muted, so the video still runs on time;
  // staff can unmute it with the controls.
  useEffect(() => {
    if (ref.current) play(ref.current);
  }, [src]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !command) return;
    if (command.action === 'pause') { video.pause(); return; }
    if (command.action === 'replay') video.currentTime = 0;
    play(video);
  }, [command]);

  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      onPlay={() => onStatus?.('playing')}
      onPause={e => { if (!e.currentTarget.ended) onStatus?.('paused'); }}
      onEnded={() => onStatus?.('ended')}
      onError={() => onStatus?.('error')}
      style={{ display: 'block', width: '100%', maxHeight, margin: '0 auto', background: '#000', borderRadius: 'var(--radius)', ...style }}
    />
  );
}
