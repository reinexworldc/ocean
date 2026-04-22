import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPublicClient, formatUnits, getAddress, http, isAddress } from 'viem';
import { arcTestnet } from '../wallet/arcTestnet';

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(arcTestnet.rpcUrls.default.http[0]),
});

export function useArcWalletBalance({ walletAddress, enabled = true } = {}) {
  const [balance, setBalance] = useState(null);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const [error, setError] = useState(null);

  const normalizedWalletAddress = useMemo(() => {
    if (!walletAddress || !isAddress(walletAddress)) {
      return null;
    }

    return getAddress(walletAddress);
  }, [walletAddress]);

  const loadBalance = useCallback(async () => {
    if (!enabled || !normalizedWalletAddress) {
      setBalance(null);
      setError(null);
      setStatus(enabled ? 'idle' : 'idle');
      return null;
    }

    setStatus('loading');
    setError(null);

    try {
      const rawBalance = await publicClient.getBalance({
        address: normalizedWalletAddress,
      });
      const formattedBalance = formatUnits(rawBalance, arcTestnet.nativeCurrency.decimals);

      const nextBalance = {
        raw: rawBalance.toString(),
        formatted: formattedBalance,
        symbol: arcTestnet.nativeCurrency.symbol,
      };

      setBalance(nextBalance);
      setStatus('success');
      return nextBalance;
    } catch (requestError) {
      setBalance(null);
      setStatus('error');
      setError(
        requestError instanceof Error ? requestError : new Error('Failed to load ARC balance.')
      );
      return null;
    }
  }, [enabled, normalizedWalletAddress]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadBalance();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadBalance]);

  useEffect(() => {
    if (!enabled || !normalizedWalletAddress) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadBalance();
    }, 15000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, loadBalance, normalizedWalletAddress]);

  return {
    balance,
    status,
    error,
    reloadBalance: loadBalance,
  };
}
