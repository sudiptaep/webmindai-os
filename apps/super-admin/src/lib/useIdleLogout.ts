import { useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

export function useIdleLogout(onIdle: () => void, enabled: boolean) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    function reset() {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), IDLE_TIMEOUT_MS);
    }

    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset));

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [enabled]);
}
