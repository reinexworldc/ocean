import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SiweMessage } from 'siwe';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from 'wagmi';
import {
  getCurrentSession,
  getSiweNonce,
  signOut as signOutRequest,
  verifySiwe,
} from '../api/auth';
import { arcTestnet } from '../wallet/arcTestnet';

function normalizeAddress(address) {
  return address?.toLowerCase() ?? null;
}

function toError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}

export function useWalletSession() {
  const { address, chainId, isConnected } = useAccount();
  const { connectAsync, connectors, isPending: isConnectingWallet } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  const attemptedAutoAuthAddressRef = useRef(null);
  const isAuthenticatingRef = useRef(false);

  const injectedConnector = useMemo(
    () => connectors.find((connector) => connector.type === 'injected') ?? connectors[0] ?? null,
    [connectors]
  );

  const loadSession = useCallback(async () => {
    try {
      const session = await getCurrentSession();

      if (session?.authenticated && session.user) {
        setError(null);
        setUser(session.user);
        setStatus('authenticated');
        return session.user;
      }

      setError(null);
      setUser(null);
      setStatus('unauthenticated');
      return null;
    } catch (requestError) {
      const nextError = toError(requestError, 'Failed to load session.');
      setUser(null);
      setStatus('error');
      setError(nextError);
      throw nextError;
    }
  }, []);

  const ensureArcTestnet = useCallback(async () => {
    if (!isConnected || chainId === undefined || chainId === arcTestnet.id || !switchChainAsync) {
      return;
    }

    await switchChainAsync({
      chainId: arcTestnet.id,
    });
  }, [chainId, isConnected, switchChainAsync]);

  const authenticateWallet = useCallback(
    async (walletAddress) => {
      if (!walletAddress) {
        throw new Error('Connect a wallet before signing in.');
      }

      if (isAuthenticatingRef.current) {
        return user;
      }

      isAuthenticatingRef.current = true;
      setError(null);
      setStatus('authenticating');

      try {
        await ensureArcTestnet();

        const { nonce } = await getSiweNonce();
        const message = new SiweMessage({
          domain: window.location.host,
          address: walletAddress,
          statement: 'Sign in to Ocean Chat.',
          uri: window.location.origin,
          version: '1',
          chainId: arcTestnet.id,
          nonce,
        }).prepareMessage();

        const signature = await signMessageAsync({ message });
        const session = await verifySiwe({
          message,
          signature,
        });

        setUser(session.user);
        setStatus('authenticated');
        return session.user;
      } catch (requestError) {
        const nextError = toError(requestError, 'Wallet authentication failed.');
        setUser(null);
        setStatus('unauthenticated');

        const isUserRejection =
          nextError.message?.toLowerCase().includes('user rejected') ||
          nextError.name === 'UserRejectedRequestError';

        if (!isUserRejection) {
          setError(nextError);
          throw nextError;
        }
      } finally {
        isAuthenticatingRef.current = false;
      }
    },
    [ensureArcTestnet, signMessageAsync, user]
  );

  const connectWallet = useCallback(async () => {
    setError(null);

    if (!injectedConnector) {
      const nextError = new Error('No injected wallet was detected in this browser.');
      setError(nextError);
      throw nextError;
    }

    let nextWalletAddress = address;

    try {
      if (!isConnected) {
        const connection = await connectAsync({
          connector: injectedConnector,
          chainId: arcTestnet.id,
        });

        nextWalletAddress = connection.accounts[0] ?? null;
      }
    } catch (requestError) {
      const nextError = toError(requestError, 'Failed to connect the wallet.');
      const isUserRejection =
        nextError.message?.toLowerCase().includes('user rejected') ||
        nextError.name === 'UserRejectedRequestError';

      if (!isUserRejection) {
        setError(nextError);
        throw nextError;
      }

      return null;
    }

    if (
      status === 'authenticated' &&
      normalizeAddress(user?.walletAddress) === normalizeAddress(nextWalletAddress)
    ) {
      return user;
    }

    attemptedAutoAuthAddressRef.current = null;

    return authenticateWallet(nextWalletAddress);
  }, [address, authenticateWallet, connectAsync, injectedConnector, isConnected, status, user]);

  const retryAuthentication = useCallback(async () => {
    attemptedAutoAuthAddressRef.current = null;
    return authenticateWallet(address);
  }, [address, authenticateWallet]);

  const signOut = useCallback(async () => {
    setError(null);

    const results = await Promise.allSettled([
      signOutRequest(),
      isConnected ? disconnectAsync() : Promise.resolve(null),
    ]);

    if (results[0].status === 'rejected') {
      const nextError = toError(results[0].reason, 'Failed to sign out.');
      setError(nextError);
      throw nextError;
    }

    setUser(null);
    setStatus('unauthenticated');
    attemptedAutoAuthAddressRef.current = null;
  }, [disconnectAsync, isConnected]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadSession]);

  useEffect(() => {
    if (!isConnected) {
      attemptedAutoAuthAddressRef.current = null;
    }
  }, [isConnected]);

  const walletState = useMemo(() => {
    if (isConnectingWallet) {
      return 'connecting';
    }

    if (status === 'authenticating') {
      return 'authenticating';
    }

    if (isConnected && status === 'authenticated') {
      return 'connected';
    }

    if (isConnected) {
      return 'readyToSign';
    }

    return 'disconnected';
  }, [isConnected, isConnectingWallet, status]);

  return {
    user,
    status,
    error,
    walletAddress: address ?? null,
    walletState,
    isAuthenticated: status === 'authenticated',
    connectWallet,
    retryAuthentication,
    reloadSession: loadSession,
    signOut,
  };
}
