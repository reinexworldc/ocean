import { useRef, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import './ChatPanel.css';
import AgentActionsPanel from './AgentActionsPanel';
import ThinkingStream from './ThinkingStream';

function getUserDisplayName(user) {
  if (user?.displayName?.trim()) {
    return user.displayName.trim();
  }
  if (user?.walletAddress) {
    const addr = user.walletAddress;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }
  return 'You';
}

function getMessageBubbleStatus(status) {
  if (status === 'failed') return 'message-bubble--failed';
  if (status === 'pending') return 'message-bubble--pending';
  return '';
}

function getPromptText(disabled, isSending, walletState) {
  if (isSending) return 'Sending...';
  if (!disabled) return 'Ask Ocean...';
  if (walletState === 'connecting') return 'Connecting wallet...';
  if (walletState === 'authenticating') return 'Check wallet and sign message...';
  if (walletState === 'readyToSign') return 'Finish wallet sign-in to chat...';
  return 'Connect wallet to chat...';
}

function ChatPanel({
  chat,
  messages,
  messagesStatus,
  messagesError,
  isAuthenticated,
  walletState,
  walletError,
  agentActionsByMessageId,
  streamingStateByMessageId,
  user,
  isActive,
  multiPane,
  onFocus,
  onAddPane,
  onClosePane,
  onSubmit,
  isSending,
  disabled,
}) {
  const userDisplayName = useMemo(() => getUserDisplayName(user), [user]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const textareaRef = useRef(null);

  const promptText = getPromptText(disabled, isSending, walletState);
  const displayError = inputError || (disabled ? (walletError?.message ?? '') : '');

  const lastAssistantMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.status === 'completed') ?? null,
    [messages]
  );

  async function handleCopyLastAnswer() {
    if (!lastAssistantMessage?.content) return;
    try {
      await navigator.clipboard.writeText(lastAssistantMessage.content);
    } catch {
      // Clipboard failures should not break the chat UI.
    }
  }

  function adjustInputHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleInputChange(e) {
    setInputValue(e.target.value);
    adjustInputHeight();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || disabled || isSending) return;

    setInputError('');
    setInputValue('');
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    });

    try {
      await onSubmit(trimmed);
    } catch (err) {
      setInputValue(trimmed);
      requestAnimationFrame(adjustInputHeight);
      setInputError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  }

  return (
    <div
      className={`chat-panel${multiPane && isActive ? ' chat-panel--active' : ''}`}
      onClick={onFocus}
    >
      {/* Top bar: title + actions */}
      <div className="pane-topbar">
        <span className="pane-title">{chat?.title ?? ''}</span>
        <div className="pane-topbar-actions">
          <button
            type="button"
            className="pane-action-btn"
            aria-label="Copy last answer"
            onClick={(e) => { e.stopPropagation(); void handleCopyLastAnswer(); }}
            disabled={!lastAssistantMessage}
            title="Copy last answer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          {onClosePane ? (
            <button
              type="button"
              className="pane-action-btn"
              onClick={(e) => { e.stopPropagation(); onClosePane(); }}
              title="Close pane"
              aria-label="Close pane"
            >
              ×
            </button>
          ) : null}
          {onAddPane ? (
            <button
              type="button"
              className="pane-action-btn"
              onClick={(e) => { e.stopPropagation(); onAddPane(); }}
              title="Split pane"
              aria-label="Split pane"
            >
              +
            </button>
          ) : null}
        </div>
      </div>

      {/* Scrollable messages area */}
      <div className="pane-messages">
        {!isAuthenticated ? (
          <div className="message-row assistant-row">
            <div className="message-bubble-group message-bubble-group--assistant">
              <span className="message-sender">Ocean</span>
              <div className="message-bubble message-bubble--assistant chat-empty-state">
                <p>
                  {walletState === 'readyToSign'
                    ? 'Wallet connected. Finish SIWE sign-in to load your chat history.'
                    : 'Connect your wallet and sign in to load your chat history.'}
                </p>
                {walletError?.message ? (
                  <p className="chat-empty-state__error">{walletError.message}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {isAuthenticated && !chat ? (
          <div className="message-row assistant-row">
            <div className="message-bubble-group message-bubble-group--assistant">
              <span className="message-sender">Ocean</span>
              <div className="message-bubble message-bubble--assistant chat-empty-state">
                <p>Hi! I'm here to help you with your questions.</p>
              </div>
            </div>
          </div>
        ) : null}

        {isAuthenticated && chat && messagesStatus === 'loading' && messages.length === 0 ? (
          <div className="message-row assistant-row">
            <div className="message-bubble-group message-bubble-group--assistant">
              <span className="message-sender">Ocean</span>
              <div className="message-bubble message-bubble--assistant chat-empty-state">
                <p>Loading messages...</p>
              </div>
            </div>
          </div>
        ) : null}

        {isAuthenticated && chat && messagesStatus === 'error' && messages.length === 0 ? (
          <div className="message-row assistant-row">
            <div className="message-bubble-group message-bubble-group--assistant">
              <span className="message-sender">Ocean</span>
              <div className="message-bubble message-bubble--assistant chat-empty-state">
                <p>{messagesError?.message ?? 'Failed to load chat messages.'}</p>
              </div>
            </div>
          </div>
        ) : null}

        {isAuthenticated &&
        chat &&
        messagesStatus !== 'loading' &&
        messagesStatus !== 'error' &&
        messages.length === 0 ? (
          <div className="message-row assistant-row">
            <div className="message-bubble-group message-bubble-group--assistant">
              <span className="message-sender">Ocean</span>
              <div className="message-bubble message-bubble--assistant chat-empty-state">
                <p>Hi! I'm here to help you with your questions.</p>
              </div>
            </div>
          </div>
        ) : null}

        {messages.map((message) => {
          const streamingState =
            message.role === 'assistant' ? streamingStateByMessageId?.[message.id] : null;
          const agentActions =
            message.role === 'assistant' ? agentActionsByMessageId?.[message.id] : null;
          const hideEmptyBubble = message.status === 'pending' && !message.content;

          return (
            <div key={message.id}>
              {streamingState ? <ThinkingStream streamingState={streamingState} /> : null}

              {!hideEmptyBubble ? (
                <div
                  className={`message-row ${
                    message.role === 'user' ? 'user-row' : 'assistant-row'
                  }`}
                >
                  <div className={`message-bubble-group message-bubble-group--${message.role}`}>
                    <span className="message-sender">
                      {message.role === 'user' ? userDisplayName : 'Ocean'}
                    </span>
                    <div
                      className={`message-bubble message-bubble--${message.role} ${getMessageBubbleStatus(message.status)}`}
                    >
                      {message.role === 'assistant' ? (
                        <div className="message-markdown">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {agentActions ? <AgentActionsPanel actions={agentActions} /> : null}
            </div>
          );
        })}
      </div>

      {/* Per-pane input footer */}
      <div
        className="pane-footer"
        onClick={(e) => e.stopPropagation()}
      >
        <form className="pane-footer__form" onSubmit={handleSubmit}>
          <div className="pane-footer__input-wrap">
            {inputValue.length === 0 && !isInputFocused && (
              <div className="pane-footer__cursor" aria-hidden="true" />
            )}
            <textarea
              ref={textareaRef}
              className="pane-footer__textarea"
              value={inputValue}
              rows={1}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={disabled || isSending}
              placeholder={promptText}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
          </div>
        </form>
        {displayError ? <div className="pane-footer__error">{displayError}</div> : null}
      </div>
    </div>
  );
}

export default ChatPanel;
