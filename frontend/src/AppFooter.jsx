import { useLayoutEffect, useRef, useState } from 'react';

import './AppFooter.css';

function getPromptText(disabled, isSending, walletState) {
  if (isSending) {
    return 'Sending message...';
  }

  if (!disabled) {
    return 'Ask Ocean...';
  }

  if (walletState === 'connecting') {
    return 'Connecting wallet...';
  }

  if (walletState === 'authenticating') {
    return 'Check wallet and sign message...';
  }

  if (walletState === 'readyToSign') {
    return 'Finish wallet sign-in to chat...';
  }

  return 'Connect wallet to chat...';
}

function AppFooter({ onSubmit, disabled, isSending, walletState, walletError }) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [caretOffset, setCaretOffset] = useState(0);
  const [submitError, setSubmitError] = useState('');
  const measureRef = useRef(null);
  const promptText = getPromptText(disabled, isSending, walletState);
  const displayError = submitError || (disabled ? walletError?.message ?? '' : '');

  useLayoutEffect(() => {
    if (!measureRef.current) {
      return;
    }

    const measureWidth = measureRef.current.getBoundingClientRect().width;

    setCaretOffset(value.length === 0 ? 0 : Math.max(0, measureWidth - 1));
  }, [value]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedValue = value.trim();
    if (!trimmedValue || disabled || isSending) {
      return;
    }

    setSubmitError('');

    try {
      await onSubmit(trimmedValue);
      setValue('');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to send message.');
    }
  }

  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <form className="app-footer__form" onSubmit={handleSubmit}>
          <div className="app-footer__inputContainer">
            {(isFocused || value.length === 0) && (
              <div
                className="app-footer__inputIcon"
                style={{ left: `${caretOffset}px` }}
                aria-hidden="true"
              />
            )}
            <input
              type="text"
              className="app-footer__input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return;
                }

                event.preventDefault();
                void handleSubmit(event);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={disabled || isSending}
            />
            {value.length === 0 && (
              <span className="app-footer__prompt" aria-hidden="true">
                {promptText}
              </span>
            )}
            <span ref={measureRef} className="app-footer__inputMeasure" aria-hidden="true">
              {value.replace(/ /g, '\u00A0')}
            </span>
          </div>
        </form>

        {displayError ? <div className="app-footer__error">{displayError}</div> : null}
      </div>
    </footer>
  );
}

export default AppFooter;
