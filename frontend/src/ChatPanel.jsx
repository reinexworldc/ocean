import { useMemo } from 'react';
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

function ChatPanel({
  chat,
  messages,
  messagesStatus,
  messagesError,
  isAuthenticated,
  isSendingMessage,
  walletState,
  walletError,
  agentActionsByMessageId,
  streamingStateByMessageId,
  user,
}) {
  const userDisplayName = useMemo(() => getUserDisplayName(user), [user]);

  const lastAssistantMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.status === 'completed') ?? null,
    [messages]
  );

  async function handleCopyLastAnswer() {
    if (!lastAssistantMessage?.content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(lastAssistantMessage.content);
    } catch {
      // Clipboard failures should not break the chat UI.
    }
  }

  return (
    <div className="chat-panel">
      {chat?.title ? (
        <div className="chat-panel-heading">
          <h2 className="chat-title">{chat.title}</h2>
        </div>
      ) : null}

      <main className="main-content">
        <div className="chat-wrapper">
          <div className="chat-container">
            <div className="chat-header-actions" />

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
                    <p>Create a new chat from the sidebar to start the conversation.</p>
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
                message.role === 'assistant'
                  ? streamingStateByMessageId?.[message.id]
                  : null;
              const agentActions =
                message.role === 'assistant'
                  ? agentActionsByMessageId?.[message.id]
                  : null;

              // Hide the bubble while it's pending and still empty — the
              // ThinkingStream rendered above it acts as the placeholder.
              const hideEmptyBubble =
                message.status === 'pending' && !message.content;

              return (
                <div key={message.id}>
                  {streamingState ? (
                    <ThinkingStream streamingState={streamingState} />
                  ) : null}

                  {!hideEmptyBubble ? (
                    <div
                      className={`message-row ${
                        message.role === 'user' ? 'user-row' : 'assistant-row'
                      }`}
                    >
                      <div
                        className={`message-bubble-group message-bubble-group--${message.role}`}
                      >
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

                  {agentActions ? (
                    <AgentActionsPanel actions={agentActions} />
                  ) : null}
                </div>
              );
            })}

            <div className="chat-actions">
              <button
                type="button"
                className="copy-btn"
                aria-label="Copy"
                onClick={() => {
                  void handleCopyLastAnswer();
                }}
                disabled={!lastAssistantMessage}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default ChatPanel;
