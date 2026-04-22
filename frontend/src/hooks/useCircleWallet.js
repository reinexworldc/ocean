import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCircleWallet } from '../api/circleWallet';

/**
 * Fetches the Circle wallet summary from the backend, including the USDC
 * balance held in the Circle Gateway contract for the user's wallet address.
 *
 * The backend endpoint is GET /api/circle-wallet/me and returns:
 *   gateway.gateway.formattedAvailable — spendable USDC in the gateway
 */
export function useCircleWallet({ enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setStatus('loading');
    setError(null);

    try {
      const wallet = await getCircleWallet();
      setData(wallet);
      setStatus('success');
    } catch (requestError) {
      if (requestError.status === 401) {
        setData(null);
        setStatus('unauthenticated');
        return;
      }

      setError(requestError instanceof Error ? requestError : new Error('Failed to load wallet.'));
      setStatus('error');
    }
  }, [enabled]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  /**
   * Normalized USDC balance shaped like { formatted, symbol } so it can be
   * used directly as arcWalletBalance in AppHeader without changing its API.
   *
   * Uses gateway.gateway.formattedAvailable — the spendable USDC amount
   * that was deposited into the Circle Gateway via depositFor.
   */
  const usdcBalance = useMemo(() => {
    const formattedAvailable = data?.gateway?.gateway?.formattedAvailable;

    if (!formattedAvailable) {
      return null;
    }

    return {
      formatted: formattedAvailable,
      symbol: 'USDC',
      raw: data?.gateway?.gateway?.available ?? null,
    };
  }, [data]);

  return {
    data,
    usdcBalance,
    status: enabled ? status : 'idle',
    error: enabled ? error : null,
    reload: load,
  };
}
