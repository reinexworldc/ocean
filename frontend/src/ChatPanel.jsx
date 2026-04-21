import './ChatPanel.css';

function ChatPanel({ arrowDownIcon, title }) {
  return (
    <div className="chat-panel">
      <main className="main-content">
        <div className="chat-wrapper">
          <div className="chat-panel-heading">
            <h2 className="chat-title">{title}</h2>
          </div>

          <div className="chat-container">
            <div className="chat-header-actions">
            </div>

            <div className="message-row user-row">
              <div className="message user-message">
                That's perfect! Give me summary for this
              </div>
            </div>

            <div className="message-row assistant-row">
              <div className="message assistant-message">
                <p>Sure! Here a few options:</p>
              </div>
            </div>

            <div className="chat-actions">
              <button type="button" className="copy-btn" aria-label="Copy">
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
