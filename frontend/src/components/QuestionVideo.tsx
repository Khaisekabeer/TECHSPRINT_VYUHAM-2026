import { useEffect, useRef, type CSSProperties } from 'react';

// A question's video. The link comes from the game server and is only sent while the question is live.
export default function QuestionVideo({ src, maxHeight, onDone, style }: { src: string; maxHeight: string; onDone?: () => void; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);

  // Browsers can refuse to autoplay with sound. Then play muted, so the video still runs on time;
  // staff can unmute it with the controls.
  useEffect(() => {
    const video = ref.current;
    video?.play().catch(() => {
      video.muted = true;
      video.play().catch(() => { /* the controls are still there */ });
    });
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      onEnded={onDone}
      onError={onDone}
      style={{ display: 'block', width: '100%', maxHeight, margin: '0 auto', background: '#000', borderRadius: 'var(--radius)', ...style }}
    />
  );
}
