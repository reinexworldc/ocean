import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import arrowUpIcon from './assets/arrow-up-1-svgrepo-com.svg';
import connectIcon from './assets/connect-svgrepo-com.svg';
import logoutIcon from './assets/logout-svgrepo-com.svg';
import './AppHeader.css';

const POPUP_DURATION_MS = 5000;

function formatWalletAddress(walletAddress) {
  if (!walletAddress) {
    return 'NOT CONNECTED';
  }

  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

function getDisplayName(user) {
  if (user?.displayName?.trim()) {
    return user.displayName.trim();
  }

  if (user?.walletAddress) {
    return formatWalletAddress(user.walletAddress);
  }

  return 'GUEST';
}

function getWalletActionLabel(walletState) {
  if (walletState === 'connecting') {
    return 'CONNECTING...';
  }

  if (walletState === 'authenticating') {
    return 'SIGNING...';
  }

  if (walletState === 'readyToSign') {
    return 'RETRY SIGN-IN';
  }

  if (walletState === 'connected') {
    return 'CONNECTED';
  }

  return 'CONNECT WALLET';
}

function getWalletStatusMessage(walletState, walletError) {
  if (walletError?.message) {
    return walletError.message;
  }

  if (walletState === 'connecting') {
    return 'Connecting wallet...';
  }

  if (walletState === 'authenticating') {
    return 'Check your wallet and sign the SIWE message.';
  }

  if (walletState === 'readyToSign') {
    return 'Wallet connected. Finish sign-in to unlock chat.';
  }
}

function formatUsdcBalance(balance, status) {
  if (status === 'loading') {
    return null;
  }

  if (!balance?.formatted) {
    return '0.00';
  }

  const numericBalance = Number.parseFloat(balance.formatted);
  if (!Number.isFinite(numericBalance)) {
    return '0.00';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(numericBalance);
}

function AppHeader({
  user,
  onSignOut,
  onConnectWallet,
  onRetryAuthentication,
  isAuthenticated,
  walletAddress: connectedWalletAddress,
  walletState,
  walletError,
  arcWalletBalance,
  arcWalletBalanceStatus,
  onReplenish,
  isReplenishing,
  replenishCooldown,
  replenishError,
}) {
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const walletAddress = formatWalletAddress(connectedWalletAddress);
  const walletStatusMessage = getWalletStatusMessage(walletState, walletError);
  const formattedUsdcBalance = formatUsdcBalance(arcWalletBalance, arcWalletBalanceStatus);
  const isBalanceLoading = arcWalletBalanceStatus === 'loading';
  const isWalletActionPending = walletState === 'connecting' || walletState === 'authenticating';
  const canTriggerWalletAction = walletState !== 'connected' && !isWalletActionPending;

  const [showPopup, setShowPopup] = useState(false);
  const popupTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (popupTimerRef.current) {
        clearTimeout(popupTimerRef.current);
      }
    };
  }, []);

  const isReplenishDisabled = !isAuthenticated || isReplenishing || replenishCooldown > 0;

  function handleReplenish() {
    if (isReplenishDisabled) {
      return;
    }

    setShowPopup(true);

    if (popupTimerRef.current) {
      clearTimeout(popupTimerRef.current);
    }

    popupTimerRef.current = setTimeout(() => {
      setShowPopup(false);
    }, POPUP_DURATION_MS);

    void onReplenish();
  }

  async function handleSignOut() {
    if (!isAuthenticated) {
      return;
    }

    try {
      await onSignOut();
    } catch {
      // Wallet/session errors are surfaced through shared auth state.
    }
  }

  async function handleWalletAction() {
    if (!canTriggerWalletAction) {
      return;
    }

    try {
      if (walletState === 'readyToSign') {
        await onRetryAuthentication();
        return;
      }

      await onConnectWallet();
    } catch {
      // Wallet/session errors are surfaced through shared auth state.
    }
  }

  return (
    <>
    <header className="header">
      <div className="logo-container">
        <span className="logo-ocean">OCEAN</span>
        <span className="logo-chat">CHAT</span>
      </div>

      <div className="header-right">
        <div className="account-panel">
          <div className="account-panel__header">
            <div className="account-panel__identity">
              <div className="greeting">HI, {displayName.toUpperCase()}!</div>
            </div>
          </div>

          <div className="account-panel__section account-panel__section--wallet">
            <div className="account-panel__section-copy">
              <div className="section-title">EXTERNAL WALLET</div>
              <div className="section-secondary wallet-address">
                <span className="wallet-address__value">{walletAddress}</span>
              </div>
              <div
                className={`section-secondary wallet-status${
                  walletError ? ' wallet-status--error' : ''
                }`}
              >
                {walletStatusMessage}
              </div>
            </div>
            <button
              type="button"
              className="section-action-button"
              disabled={!canTriggerWalletAction}
              onClick={handleWalletAction}
              aria-label={getWalletActionLabel(walletState)}
            >
              <img src={connectIcon} alt="" aria-hidden="true" className="section-action-icon" />
            </button>
          </div>

          <div className="account-panel__section account-panel__section--credits">
            <div className="account-panel__section-copy account-panel__section-copy--credits">
              {isBalanceLoading ? (
                <div className="credits-value credits-value--skeleton" aria-label="Loading balance" />
              ) : (
                <div className="section-primary credits-value">
                  ${formattedUsdcBalance}
                </div>
              )}
              <div className="credits-title">USDC ON ARC</div>
            </div>
            <button
              type="button"
              className={`section-action-button replenish-btn${isReplenishDisabled ? ' replenish-btn--disabled' : ''}`}
              disabled={isReplenishDisabled}
              onClick={handleReplenish}
              aria-label={
                isReplenishing
                  ? 'Replenishing...'
                  : replenishCooldown > 0
                    ? `Wait ${replenishCooldown}s`
                    : 'Replenish 0.5 USDC'
              }
              title={
                replenishError
                  ? replenishError.message
                  : replenishCooldown > 0
                    ? `Available in ${replenishCooldown}s`
                    : 'Top up 0.5 USDC from your external wallet'
              }
            >
              <img
                src={arrowUpIcon}
                alt=""
                aria-hidden="true"
                className={`section-action-icon${isReplenishing ? ' replenish-btn__icon--spinning' : ''}`}
              />
            </button>

          </div>

          <div className="account-panel__footer">
            <button
              type="button"
              className="sign-out-btn"
              disabled={!isAuthenticated}
              onClick={handleSignOut}
            >
              <span>SIGN OUT</span>
              <img src={logoutIcon} alt="" aria-hidden="true" className="section-action-icon" />
            </button>
          </div>
        </div>
      </div>
    </header>

    {showPopup
      ? createPortal(
          <div className="replenish-toast" role="status" aria-live="polite">
            Your wallet will be replenished via 5 sec...
          </div>,
          document.body,
        )
      : null}

    {replenishError && !showPopup
      ? createPortal(
          <div className="replenish-toast replenish-toast--error" role="alert">
            {replenishError.message}
          </div>,
          document.body,
        )
      : null}
  </>
  );
}

export default AppHeader;
