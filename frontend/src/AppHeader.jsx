import { useMemo, useState } from 'react';
import arrowUpIcon from './assets/arrow-up-1-svgrepo-com.svg';
import connectIcon from './assets/connect-svgrepo-com.svg';
import logoutIcon from './assets/logout-svgrepo-com.svg';
import './AppHeader.css';

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

  if (walletState === 'connected') {
    return 'Wallet ready for chat.';
  }

  return 'Connect a wallet to start chatting.';
}

function AppHeader({
  user,
  userStatus,
  onSaveProfile,
  onSignOut,
  onConnectWallet,
  onRetryAuthentication,
  isAuthenticated,
  walletAddress: connectedWalletAddress,
  walletState,
  walletError,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [formState, setFormState] = useState({
    displayName: '',
    email: '',
  });

  const displayName = useMemo(() => getDisplayName(user), [user]);
  const email = user?.email?.trim() ? user.email : 'NO EMAIL SET';
  const walletAddress = formatWalletAddress(connectedWalletAddress);
  const walletStatusMessage = getWalletStatusMessage(walletState, walletError);
  const isWalletActionPending = walletState === 'connecting' || walletState === 'authenticating';
  const canTriggerWalletAction = walletState !== 'connected' && !isWalletActionPending;
  const isProfileReady = isAuthenticated && userStatus !== 'loading';

  async function handleSubmit(event) {
    event.preventDefault();

    if (!isAuthenticated) {
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      await onSaveProfile({
        displayName: formState.displayName,
        email: formState.email,
      });
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save profile.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleInputChange(event) {
    const { name, value } = event.target;

    setFormState((currentState) => ({
      ...currentState,
      [name]: value,
    }));
  }

  async function handleSignOut() {
    if (!isAuthenticated) {
      return;
    }

    try {
      await onSignOut();
      setIsEditing(false);
    } catch {
      // Wallet/session errors are surfaced through shared auth state.
    }
  }

  function handleToggleEditing() {
    if (isEditing) {
      setIsEditing(false);
      setSaveError('');
      return;
    }

    setFormState({
      displayName: user?.displayName ?? '',
      email: user?.email ?? '',
    });
    setSaveError('');
    setIsEditing(true);
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
    <header className="header">
      <div className="logo-container">
        <span className="logo-ocean">OCEAN</span>
        <span className="logo-chat">CHAT</span>
      </div>

      <div className="header-right">
        <div className={`account-panel ${isEditing ? 'account-panel--editing' : ''}`}>
          <div className="account-panel__header">
            <div className="account-panel__identity">
              <div className="greeting">HI, {displayName.toUpperCase()}!</div>
              <div className="email">{email.toUpperCase()}</div>
            </div>
            <button
              type="button"
              className="settings-btn"
              disabled={!isProfileReady}
              onClick={handleToggleEditing}
            >
              {isEditing ? 'CANCEL' : 'SETTINGS'}
            </button>
          </div>

          {isEditing ? (
            <form className="account-panel__form" onSubmit={handleSubmit}>
              <label className="profile-field">
                <span className="profile-field__label">DISPLAY NAME</span>
                <input
                  className="profile-field__input"
                  name="displayName"
                  type="text"
                  value={formState.displayName}
                  onChange={handleInputChange}
                  placeholder="Enter your display name"
                  maxLength={80}
                />
              </label>

              <label className="profile-field">
                <span className="profile-field__label">EMAIL</span>
                <input
                  className="profile-field__input"
                  name="email"
                  type="email"
                  value={formState.email}
                  onChange={handleInputChange}
                  placeholder="Enter your email"
                  maxLength={120}
                />
              </label>

              {saveError ? <div className="profile-form__error">{saveError}</div> : null}

              <button type="submit" className="profile-form__submit" disabled={isSaving}>
                {isSaving ? 'SAVING...' : 'SAVE PROFILE'}
              </button>
            </form>
          ) : null}

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
              <div className="section-primary credits-value">74</div>
              <div className="credits-title">CREDITS LEFT</div>
            </div>
            <img src={arrowUpIcon} alt="" aria-hidden="true" className="section-action-icon" />
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
  );
}

export default AppHeader;
