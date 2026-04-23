import { useCallback, useEffect, useRef, useState } from 'react';
import { replenishCircleWallet } from '../api/circleWallet';

const COOLDOWN_SECONDS = 30;

export function useReplenishWallet({ onSuccess } = {}) {
  const [isPending, setIsPending] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [error, setError] = useState(null);
  const cooldownIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, []);

  const startCooldown = useCallback((seconds = COOLDOWN_SECONDS) => {
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    setCooldownSeconds(seconds);

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownIntervalRef.current);
          cooldownIntervalRef.current = null;
          return 0;
        }

        return prev - 1;
      });
    }, 1000);
  }, []);

  const replenish = useCallback(async () => {
    if (isPending || cooldownSeconds > 0) {
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      await replenishCircleWallet();
      startCooldown();

      if (onSuccess) {
        void onSuccess();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Replenishment failed.';

      // If the server returned a rate-limit with remaining seconds, parse and use it.
      const secondsMatch = message.match(/wait\s+(\d+)s/i);
      if (secondsMatch) {
        startCooldown(Number(secondsMatch[1]));
      }

      setError(err instanceof Error ? err : new Error(message));
    } finally {
      setIsPending(false);
    }
  }, [cooldownSeconds, isPending, onSuccess, startCooldown]);

  return {
    replenish,
    isPending,
    cooldownSeconds,
    error,
  };
}
