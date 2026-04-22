import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createChat,
  createChatMessage,
  getChatMessages,
  getChats,
} from '../api/chats';

function createTemporaryMessage({ chatId, role, content, status }) {
  return {
    id: `temp-${role}-${crypto.randomUUID()}`,
    chatId,
    role,
    content,
    status,
    createdAt: new Date().toISOString(),
    isTemporary: true,
  };
}

function upsertChat(chats, nextChat) {
  const otherChats = chats.filter((chat) => chat.id !== nextChat.id);
  return [nextChat, ...otherChats];
}

export function useChats({ enabled = true } = {}) {
  const [chats, setChats] = useState([]);
  const [chatsStatus, setChatsStatus] = useState(enabled ? 'loading' : 'idle');
  const [chatsError, setChatsError] = useState(null);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [messagesByChatId, setMessagesByChatId] = useState({});
  const [messagesStatusByChatId, setMessagesStatusByChatId] = useState({});
  const [messagesErrorByChatId, setMessagesErrorByChatId] = useState({});
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [agentActionsByMessageId, setAgentActionsByMessageId] = useState({});

  const loadChats = useCallback(async () => {
    if (!enabled) {
      return [];
    }

    setChatsStatus('loading');
    setChatsError(null);

    try {
      const nextChats = await getChats();
      setChats(nextChats);
      setChatsStatus('success');
      return nextChats;
    } catch (requestError) {
      if (requestError.status === 401) {
        setChats([]);
        setSelectedChatId(null);
        setChatsStatus('unauthenticated');
        return [];
      }

      setChatsStatus('error');
      setChatsError(requestError);
      throw requestError;
    }
  }, [enabled]);

  const loadMessages = useCallback(
    async (chatId) => {
      if (!enabled || !chatId) {
        return [];
      }

      setMessagesStatusByChatId((currentState) => ({
        ...currentState,
        [chatId]: 'loading',
      }));
      setMessagesErrorByChatId((currentState) => ({
        ...currentState,
        [chatId]: null,
      }));

      try {
        const response = await getChatMessages(chatId);
        setMessagesByChatId((currentState) => ({
          ...currentState,
          [chatId]: response.messages,
        }));
        setMessagesStatusByChatId((currentState) => ({
          ...currentState,
          [chatId]: 'success',
        }));
        return response.messages;
      } catch (requestError) {
        if (requestError.status === 401) {
          setMessagesByChatId((currentState) => ({
            ...currentState,
            [chatId]: [],
          }));
          setMessagesStatusByChatId((currentState) => ({
            ...currentState,
            [chatId]: 'unauthenticated',
          }));
          return [];
        }

        setMessagesStatusByChatId((currentState) => ({
          ...currentState,
          [chatId]: 'error',
        }));
        setMessagesErrorByChatId((currentState) => ({
          ...currentState,
          [chatId]: requestError,
        }));
        throw requestError;
      }
    },
    [enabled]
  );

  const handleSelectChat = useCallback((chatId) => {
    setSelectedChatId(chatId);
  }, []);

  const handleCreateChat = useCallback(async () => {
    if (!enabled) {
      throw new Error('Authentication is required.');
    }

    setIsCreatingChat(true);
    setChatsError(null);

    try {
      const nextChat = await createChat();
      setChats((currentChats) => upsertChat(currentChats, nextChat));
      setSelectedChatId(nextChat.id);
      setMessagesByChatId((currentState) => ({
        ...currentState,
        [nextChat.id]: [],
      }));
      setMessagesStatusByChatId((currentState) => ({
        ...currentState,
        [nextChat.id]: 'success',
      }));
      return nextChat;
    } finally {
      setIsCreatingChat(false);
    }
  }, [enabled]);

  const sendMessage = useCallback(
    async (content) => {
      if (!enabled) {
        throw new Error('Authentication is required.');
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return null;
      }

      setIsSendingMessage(true);
      let activeChatId = selectedChatId;
      let optimisticUserMessageId = null;
      let optimisticAssistantMessageId = null;

      try {
        if (!activeChatId) {
          const createdChat = await handleCreateChat();
          activeChatId = createdChat.id;
        }

        const optimisticUserMessage = createTemporaryMessage({
          chatId: activeChatId,
          role: 'user',
          content: trimmedContent,
          status: 'completed',
        });
        const optimisticAssistantMessage = createTemporaryMessage({
          chatId: activeChatId,
          role: 'assistant',
          content: 'Thinking...',
          status: 'pending',
        });
        optimisticUserMessageId = optimisticUserMessage.id;
        optimisticAssistantMessageId = optimisticAssistantMessage.id;

        setMessagesByChatId((currentState) => ({
          ...currentState,
          [activeChatId]: [
            ...(currentState[activeChatId] ?? []),
            optimisticUserMessage,
            optimisticAssistantMessage,
          ],
        }));
        setMessagesStatusByChatId((currentState) => ({
          ...currentState,
          [activeChatId]: 'success',
        }));

        const response = await createChatMessage(activeChatId, {
          content: trimmedContent,
        });

        setChats((currentChats) => upsertChat(currentChats, response.chat));
        setMessagesByChatId((currentState) => ({
          ...currentState,
          [activeChatId]: [
            ...(currentState[activeChatId] ?? []).filter(
              (message) =>
                message.id !== optimisticUserMessage.id &&
                message.id !== optimisticAssistantMessage.id
            ),
            response.userMessage,
            response.assistantMessage,
          ],
        }));

        if (Array.isArray(response.agentActions) && response.agentActions.length > 0) {
          setAgentActionsByMessageId((currentState) => ({
            ...currentState,
            [response.assistantMessage.id]: response.agentActions,
          }));
        }

        return response;
      } catch (requestError) {
        if (activeChatId && optimisticUserMessageId && optimisticAssistantMessageId) {
          setMessagesByChatId((currentState) => ({
            ...currentState,
            [activeChatId]: (currentState[activeChatId] ?? []).filter(
              (message) =>
                message.id !== optimisticUserMessageId &&
                message.id !== optimisticAssistantMessageId
            ),
          }));
        }

        if (activeChatId) {
          await Promise.allSettled([loadChats(), loadMessages(activeChatId)]);
        } else {
          await Promise.allSettled([loadChats()]);
        }

        throw requestError;
      } finally {
        setIsSendingMessage(false);
      }
    },
    [enabled, handleCreateChat, loadChats, loadMessages, selectedChatId]
  );

  useEffect(() => {
    if (!enabled) {
      setChats([]);
      setSelectedChatId(null);
      setChatsError(null);
      setChatsStatus('idle');
      setMessagesByChatId({});
      setMessagesStatusByChatId({});
      setMessagesErrorByChatId({});
      setIsCreatingChat(false);
      setIsSendingMessage(false);
      setAgentActionsByMessageId({});
      return;
    }

    void Promise.resolve().then(loadChats);
  }, [enabled, loadChats]);

  useEffect(() => {
    if (!enabled || chats.length === 0) {
      setSelectedChatId(null);
      return;
    }

    const hasSelectedChat = chats.some((chat) => chat.id === selectedChatId);

    if (!selectedChatId || !hasSelectedChat) {
      setSelectedChatId(chats[0].id);
    }
  }, [chats, enabled, selectedChatId]);

  useEffect(() => {
    if (!enabled || !selectedChatId) {
      return;
    }

    if (messagesStatusByChatId[selectedChatId] !== undefined) {
      return;
    }

    void Promise.resolve().then(() => loadMessages(selectedChatId));
  }, [enabled, loadMessages, messagesStatusByChatId, selectedChatId]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId]
  );

  const messages = selectedChatId ? messagesByChatId[selectedChatId] ?? [] : [];
  const messagesStatus = selectedChatId
    ? messagesStatusByChatId[selectedChatId] ?? 'idle'
    : 'idle';
  const messagesError = selectedChatId ? messagesErrorByChatId[selectedChatId] ?? null : null;

  return {
    chats,
    chatsStatus,
    chatsError,
    selectedChatId,
    selectedChat,
    messages,
    messagesStatus,
    messagesError,
    isCreatingChat,
    isSendingMessage,
    agentActionsByMessageId,
    selectChat: handleSelectChat,
    createChat: handleCreateChat,
    reloadChats: loadChats,
    reloadMessages: loadMessages,
    sendMessage,
  };
}
