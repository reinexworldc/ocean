import { useMemo } from 'react';
import './ChatPanel.css';

function ChatPanel({
  chat,
  messages,
  messagesStatus,
  messagesError,
  isAuthenticated,
  isSendingMessage,
  walletState,
  walletError,
}) {
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
                <div className="message assistant-message chat-empty-state">
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
            ) : null}

            {isAuthenticated && !chat ? (
              <div className="message-row assistant-row">
                <div className="message assistant-message chat-empty-state">
                  <p>Create a new chat from the sidebar to start the conversation.</p>
                </div>
              </div>
            ) : null}

            {isAuthenticated && chat && messagesStatus === 'loading' && messages.length === 0 ? (
              <div className="message-row assistant-row">
                <div className="message assistant-message chat-empty-state">
                  <p>Loading messages...</p>
                </div>
              </div>
            ) : null}

            {isAuthenticated && chat && messagesStatus === 'error' && messages.length === 0 ? (
              <div className="message-row assistant-row">
                <div className="message assistant-message chat-empty-state">
                  <p>{messagesError?.message ?? 'Failed to load chat messages.'}</p>
                </div>
              </div>
            ) : null}

            {isAuthenticated &&
            chat &&
            messagesStatus !== 'loading' &&
            messagesStatus !== 'error' &&
            messages.length === 0 ? (
              <div className="message-row assistant-row">
                <div className="message assistant-message chat-empty-state">
                  <p>Send the first message to generate a Gemini response.</p>
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                className={`message-row ${
                  message.role === 'user' ? 'user-row' : 'assistant-row'
                }`}
                key={message.id}
              >
                <div
                  className={`message ${
                    message.role === 'user' ? 'user-message' : 'assistant-message'
                  } ${
                    message.status === 'failed'
                      ? 'message--failed'
                      : message.status === 'pending'
                        ? 'message--pending'
                        : ''
                  }`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
            ))}

            {isSendingMessage ? <div className="chat-status">Generating reply...</div> : null}

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
