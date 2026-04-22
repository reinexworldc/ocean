import './OceanSidebar.css';

function ShortcutCommandIcon() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 0.75C1.30964 0.75 0.75 1.30964 0.75 2V2.5C0.75 3.19036 1.30964 3.75 2 3.75H2.5V4.25H2C1.30964 4.25 0.75 4.80964 0.75 5.5V6C0.75 6.69036 1.30964 7.25 2 7.25H2.5C3.19036 7.25 3.75 6.69036 3.75 6V5.5H4.25V6C4.25 6.69036 4.80964 7.25 5.5 7.25H6C6.69036 7.25 7.25 6.69036 7.25 6V5.5C7.25 4.80964 6.69036 4.25 6 4.25H5.5V3.75H6C6.69036 3.75 7.25 3.19036 7.25 2.5V2C7.25 1.30964 6.69036 0.75 6 0.75H5.5C4.80964 0.75 4.25 1.30964 4.25 2V2.5H3.75V2C3.75 1.30964 3.19036 0.75 2.5 0.75H2ZM2 1.75H2.5C2.63807 1.75 2.75 1.86193 2.75 2V2.5C2.75 2.63807 2.63807 2.75 2.5 2.75H2C1.86193 2.75 1.75 2.63807 1.75 2.5V2C1.75 1.86193 1.86193 1.75 2 1.75ZM5.5 1.75H6C6.13807 1.75 6.25 1.86193 6.25 2V2.5C6.25 2.63807 6.13807 2.75 6 2.75H5.5C5.36193 2.75 5.25 2.63807 5.25 2.5V2C5.25 1.86193 5.36193 1.75 5.5 1.75ZM3.75 3.75H4.25V4.25H3.75V3.75ZM2 5.25H2.5C2.63807 5.25 2.75 5.36193 2.75 5.5V6C2.75 6.13807 2.63807 6.25 2.5 6.25H2C1.86193 6.25 1.75 6.13807 1.75 6V5.5C1.75 5.36193 1.86193 5.25 2 5.25ZM5.5 5.25H6C6.13807 5.25 6.25 5.36193 6.25 5.5V6C6.25 6.13807 6.13807 6.25 6 6.25H5.5C5.36193 6.25 5.25 6.13807 5.25 6V5.5C5.25 5.36193 5.36193 5.25 5.5 5.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }

  const elapsedMs = Date.now() - new Date(timestamp).getTime();
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));

  if (elapsedMinutes < 1) {
    return 'just now';
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) {
    return `${elapsedDays}d ago`;
  }

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  return `${elapsedWeeks}w ago`;
}

function OceanSidebar({
  chats,
  chatsStatus,
  chatsError,
  selectedChatId,
  onSelectChat,
  onCreateChat,
  isAuthenticated,
  isCreatingChat,
}) {
  return (
    <aside className="ocean-sidebar" aria-label="Recent chats">
      <div className="ocean-sidebar__header">
        <button
          type="button"
          className="ocean-sidebar__newChatButton"
          onClick={() => {
            void onCreateChat();
          }}
          disabled={!isAuthenticated || isCreatingChat}
        >
          {isCreatingChat ? 'CREATING...' : 'NEW CHAT'}
        </button>

        <div className="ocean-sidebar__shortcuts" aria-hidden="true">
          <span className="ocean-sidebar__shortcutBox">
            <ShortcutCommandIcon />
          </span>
          <span className="ocean-sidebar__shortcutBox ocean-sidebar__shortcutBox--text">
            N
          </span>
        </div>
      </div>

      <div className="ocean-sidebar__divider" />

      <div className="ocean-sidebar__list">
        {!isAuthenticated ? (
          <div className="ocean-sidebar__emptyState">Connect your wallet to load chats.</div>
        ) : null}

        {isAuthenticated && chatsStatus === 'loading' ? (
          <div className="ocean-sidebar__emptyState">Loading chats...</div>
        ) : null}

        {isAuthenticated && chatsStatus === 'error' ? (
          <div className="ocean-sidebar__emptyState">
            {chatsError?.message ?? 'Failed to load chats.'}
          </div>
        ) : null}

        {isAuthenticated && chatsStatus !== 'loading' && chatsStatus !== 'error' && chats.length === 0 ? (
          <div className="ocean-sidebar__emptyState">No chats yet. Start a new conversation.</div>
        ) : null}

        {chats.map((chat) => (
          <button
            type="button"
            className={`ocean-sidebar__item${
              chat.id === selectedChatId ? ' ocean-sidebar__item--active' : ''
            }`}
            key={chat.id}
            onClick={() => onSelectChat(chat.id)}
            aria-pressed={chat.id === selectedChatId}
          >
            <span className="ocean-sidebar__itemTitle">{chat.title}</span>
            <span className="ocean-sidebar__itemTime">{formatRelativeTime(chat.updatedAt)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export default OceanSidebar;
