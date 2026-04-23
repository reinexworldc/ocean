import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from './AppHeader';
import ChatPanel from './ChatPanel';
import OceanSidebar from './OceanSidebar';
import './App.css';
import { useCircleWallet } from './hooks/useCircleWallet';
import { useChats } from './hooks/useChats';
import { useCurrentUserProfile } from './hooks/useCurrentUserProfile';
import { useReplenishWallet } from './hooks/useReplenishWallet';
import { useWalletSession } from './hooks/useWalletSession';

const MAX_PANES = 3;

function createPane() {
  return { id: crypto.randomUUID(), chatId: null };
}

function App() {
  const walletSession = useWalletSession();
  const { user } = useCurrentUserProfile({
    enabled: walletSession.isAuthenticated,
    userId: walletSession.user?.id ?? null,
  });
  const chats = useChats({ enabled: walletSession.isAuthenticated });

  const currentUser = useMemo(() => {
    if (!walletSession.user && !user) return null;
    return { ...(walletSession.user ?? {}), ...(user ?? {}) };
  }, [user, walletSession.user]);

  const circleWallet = useCircleWallet({ enabled: walletSession.isAuthenticated });
  const replenishWallet = useReplenishWallet({ onSuccess: circleWallet.reload });

  // ── Panes state ──────────────────────────────────────────────────────────
  const [panes, setPanes] = useState(() => [createPane()]);
  const [focusedPaneId, setFocusedPaneId] = useState(() => panes[0].id);
  const panesInitializedRef = useRef(false);

  // Track per-pane sending state
  const [isSendingByPaneId, setIsSendingByPaneId] = useState({});

  // Initialise pane 0 with the first loaded chat (one-time).
  useEffect(() => {
    if (panesInitializedRef.current) return;
    if (!chats.selectedChatId) return;
    panesInitializedRef.current = true;
    setPanes((prev) =>
      prev.map((p, i) => (i === 0 ? { ...p, chatId: chats.selectedChatId } : p))
    );
  }, [chats.selectedChatId]);

  // Returns the effective chatId shown in a given pane.
  // Pane 0 mirrors the hook's selectedChatId so its auto-load logic still works.
  const getPaneChatId = useCallback(
    (pane, index) => (index === 0 ? chats.selectedChatId : pane.chatId),
    [chats.selectedChatId]
  );

  const focusedPaneIndex = panes.findIndex((p) => p.id === focusedPaneId);
  const focusedPane = panes[focusedPaneIndex >= 0 ? focusedPaneIndex : 0];
  const focusedPaneChatId = getPaneChatId(focusedPane, focusedPaneIndex >= 0 ? focusedPaneIndex : 0);

  const ensureMessagesLoaded = useCallback(
    (chatId) => {
      if (chatId && !chats.messagesStatusByChatId[chatId]) {
        void chats.reloadMessages(chatId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chats.messagesStatusByChatId, chats.reloadMessages]
  );

  // ── Sidebar handlers ─────────────────────────────────────────────────────
  const handleSidebarSelectChat = useCallback(
    (chatId) => {
      if (focusedPaneIndex === 0) {
        chats.selectChat(chatId);
      } else {
        setPanes((prev) =>
          prev.map((p) => (p.id === focusedPaneId ? { ...p, chatId } : p))
        );
        ensureMessagesLoaded(chatId);
      }
    },
    [chats, ensureMessagesLoaded, focusedPaneId, focusedPaneIndex]
  );

  const handleSidebarCreateChat = useCallback(async () => {
    const newChat = await chats.createChat();
    if (focusedPaneIndex !== 0) {
      setPanes((prev) =>
        prev.map((p) => (p.id === focusedPaneId ? { ...p, chatId: newChat.id } : p))
      );
    }
    return newChat;
  }, [chats, focusedPaneId, focusedPaneIndex]);

  // ── Pane management ──────────────────────────────────────────────────────
  const addPane = useCallback(() => {
    if (panes.length >= MAX_PANES) return;
    const newPane = createPane();
    setPanes((prev) => [...prev, newPane]);
    setFocusedPaneId(newPane.id);
  }, [panes.length]);

  const removePane = useCallback(
    (paneId) => {
      if (panes.length <= 1) return;
      const remaining = panes.filter((p) => p.id !== paneId);
      setPanes(remaining);
      if (focusedPaneId === paneId) {
        setFocusedPaneId(remaining[0].id);
      }
      setIsSendingByPaneId((prev) => {
        const next = { ...prev };
        delete next[paneId];
        return next;
      });
    },
    [focusedPaneId, panes]
  );

  // ── Per-pane send message ────────────────────────────────────────────────
  const sendMessageForPane = useCallback(
    async (content, pane, paneIndex) => {
      const paneChatId = getPaneChatId(pane, paneIndex);
      setIsSendingByPaneId((prev) => ({ ...prev, [pane.id]: true }));
      try {
        const response = await chats.sendMessage(content, {
          chatId: paneChatId,
          onNewChatCreated:
            paneIndex !== 0
              ? (newChat) =>
                  setPanes((prev) =>
                    prev.map((p) =>
                      p.id === pane.id ? { ...p, chatId: newChat.id } : p
                    )
                  )
              : undefined,
        });
        if (Array.isArray(response?.agentActions) && response.agentActions.length > 0) {
          void circleWallet.reload();
        }
        return response;
      } finally {
        setIsSendingByPaneId((prev) => ({ ...prev, [pane.id]: false }));
      }
    },
    [chats, circleWallet, getPaneChatId]
  );

  return (
    <div className="app-container">
      <AppHeader
        user={currentUser}
        onSignOut={walletSession.signOut}
        onConnectWallet={walletSession.connectWallet}
        onRetryAuthentication={walletSession.retryAuthentication}
        isAuthenticated={walletSession.isAuthenticated}
        walletAddress={walletSession.walletAddress}
        walletState={walletSession.walletState}
        walletError={walletSession.error}
        arcWalletBalance={circleWallet.usdcBalance}
        arcWalletBalanceStatus={circleWallet.status}
        onReplenish={replenishWallet.replenish}
        isReplenishing={replenishWallet.isPending}
        replenishCooldown={replenishWallet.cooldownSeconds}
        replenishError={replenishWallet.error}
      />

      <div className="content-shell">
        <div className="content-layout">
          <OceanSidebar
            chats={chats.chats}
            chatsStatus={chats.chatsStatus}
            chatsError={chats.chatsError}
            selectedChatId={focusedPaneChatId}
            onSelectChat={handleSidebarSelectChat}
            onCreateChat={handleSidebarCreateChat}
            onDeleteChat={chats.deleteChat}
            isAuthenticated={walletSession.isAuthenticated}
            isCreatingChat={chats.isCreatingChat}
          />

          <div className="panes-container">
            {panes.map((pane, index) => {
              const paneChatId = getPaneChatId(pane, index);
              const paneChat = chats.chats.find((c) => c.id === paneChatId) ?? null;
              const paneMessages = chats.messagesByChatId[paneChatId] ?? [];
              const paneMessagesStatus = chats.messagesStatusByChatId[paneChatId] ?? 'idle';
              const paneMessagesError = chats.messagesErrorByChatId[paneChatId] ?? null;
              const isActive = pane.id === focusedPaneId;

              return (
                <ChatPanel
                  key={pane.id}
                  chat={paneChat}
                  messages={paneMessages}
                  messagesStatus={paneMessagesStatus}
                  messagesError={paneMessagesError}
                  isAuthenticated={walletSession.isAuthenticated}
                  walletState={walletSession.walletState}
                  walletError={walletSession.error}
                  agentActionsByMessageId={chats.agentActionsByMessageId}
                  streamingStateByMessageId={chats.streamingStateByMessageId}
                  user={currentUser}
                  isActive={isActive}
                  multiPane={panes.length > 1}
                  onFocus={() => setFocusedPaneId(pane.id)}
                  onAddPane={panes.length < MAX_PANES ? addPane : null}
                  onClosePane={panes.length > 1 ? () => removePane(pane.id) : null}
                  onSubmit={(content) => sendMessageForPane(content, pane, index)}
                  isSending={isSendingByPaneId[pane.id] ?? false}
                  disabled={!walletSession.isAuthenticated}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
