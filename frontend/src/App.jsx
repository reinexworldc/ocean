import { useCallback, useMemo } from 'react';
import AppFooter from './AppFooter';
import AppHeader from './AppHeader';
import ChatPanel from './ChatPanel';
import OceanSidebar from './OceanSidebar';
import './App.css';
import { useCircleWallet } from './hooks/useCircleWallet';
import { useChats } from './hooks/useChats';
import { useCurrentUserProfile } from './hooks/useCurrentUserProfile';
import { useReplenishWallet } from './hooks/useReplenishWallet';
import { useWalletSession } from './hooks/useWalletSession';

function App() {
  const walletSession = useWalletSession();
  const {
    user,
    status: userStatus,
    saveUserProfile,
  } = useCurrentUserProfile({
    enabled: walletSession.isAuthenticated,
    userId: walletSession.user?.id ?? null,
  });
  const chats = useChats({
    enabled: walletSession.isAuthenticated,
  });

  const currentUser = useMemo(() => {
    if (!walletSession.user && !user) {
      return null;
    }

    return {
      ...(walletSession.user ?? {}),
      ...(user ?? {}),
    };
  }, [user, walletSession.user]);
  const circleWallet = useCircleWallet({
    enabled: walletSession.isAuthenticated,
  });

  const replenishWallet = useReplenishWallet({
    onSuccess: circleWallet.reload,
  });

  const sendMessage = useCallback(
    async (content) => {
      const response = await chats.sendMessage(content);
      if (Array.isArray(response?.agentActions) && response.agentActions.length > 0) {
        void circleWallet.reload();
      }
      return response;
    },
    [chats, circleWallet],
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
            selectedChatId={chats.selectedChatId}
            onSelectChat={chats.selectChat}
            onCreateChat={chats.createChat}
            onDeleteChat={chats.deleteChat}
            isAuthenticated={walletSession.isAuthenticated}
            isCreatingChat={chats.isCreatingChat}
          />
          <ChatPanel
            chat={chats.selectedChat}
            messages={chats.messages}
            messagesStatus={chats.messagesStatus}
            messagesError={chats.messagesError}
            isAuthenticated={walletSession.isAuthenticated}
            isSendingMessage={chats.isSendingMessage}
            walletState={walletSession.walletState}
            walletError={walletSession.error}
            agentActionsByMessageId={chats.agentActionsByMessageId}
            streamingStateByMessageId={chats.streamingStateByMessageId}
            user={currentUser}
          />
        </div>
      </div>

      <AppFooter
        onSubmit={sendMessage}
        disabled={!walletSession.isAuthenticated}
        isSending={chats.isSendingMessage}
        walletState={walletSession.walletState}
        walletError={walletSession.error}
      />
    </div>
  );
}

export default App;
