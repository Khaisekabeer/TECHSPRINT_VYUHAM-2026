import { useEffect, useState } from 'react';

// Seconds left until `endsAt` (a server timestamp). `serverNow` from the same
// game_state message corrects for the device's clock being off.
export function useCountdown(endsAt: number | null | undefined, serverNow: number | null | undefined) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!endsAt) {
      setSecondsLeft(0);
      return;
    }
    const offset = serverNow ? serverNow - Date.now() : 0;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, serverNow]);

  return secondsLeft;
}
