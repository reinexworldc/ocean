import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createChat,
  createChatMessage,
  deleteChat as apiDeleteChat,
  getChatMessages,
  getChatMessageStreamUrl,
  getChats,
  initChatMessageStream,
} from '../api/chats';

const ACTION_LABELS = {
  get_market_overview: 'Market Overview',
  get_token_details: 'Token Details',
  get_token_history: 'Token History',
  get_wallet_portfolio: 'Wallet Portfolio',
};

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

function toolStepKey(tool, tokenId) {
  return tokenId ? `${tool}:${tokenId}` : tool;
}

function buildStepFromEvent(data) {
  switch (data.phase) {
    case 'planning':
      return { phase: 'planning', text: 'Analyzing your request' };
    case 'tool_executing':
      return {
        phase: 'tool_executing',
        text: data.text ?? `Fetching ${(ACTION_LABELS[data.tool] ?? data.tool).toLowerCase()}`,
        tool: data.tool,
        tokenId: data.tokenId ?? null,
        key: toolStepKey(data.tool, data.tokenId),
      };
    case 'tool_result':
      return {
        phase: 'tool_result',
        text: data.text ?? (ACTION_LABELS[data.tool] ?? data.tool),
        cost: data.cost,
        tool: data.tool,
        tokenId: data.tokenId ?? null,
        key: toolStepKey(data.tool, data.tokenId),
      };
    case 'generating':
      return { phase: 'generating', text: 'Generating response' };
    default:
      return { phase: data.phase, text: data.text ?? data.phase };
  }
}

const STEP_PHASES = new Set(['planning', 'tool_executing', 'tool_result', 'generating']);

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
  const [streamingStateByMessageId, setStreamingStateByMessageId] = useState({});

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

  const handleDeleteChat = useCallback(
    async (chatId) => {
      if (!enabled) return;

      setChats((current) => current.filter((c) => c.id !== chatId));
      setSelectedChatId((sel) => (sel === chatId ? null : sel));

      try {
        await apiDeleteChat(chatId);
      } catch {
        await loadChats();
      }
    },
    [enabled, loadChats],
  );

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
      let tempAssistantId = null;

      try {
        if (!activeChatId) {
          const createdChat = await handleCreateChat();
          activeChatId = createdChat.id;
        }

        // Step 1: create user message on server, get stream token
        const initResponse = await initChatMessageStream(activeChatId, {
          content: trimmedContent,
        });

        // Add the real user message + empty optimistic assistant message
        const optimisticAssistant = createTemporaryMessage({
          chatId: activeChatId,
          role: 'assistant',
          content: '',
          status: 'pending',
        });
        tempAssistantId = optimisticAssistant.id;

        setMessagesByChatId((current) => ({
          ...current,
          [activeChatId]: [
            ...(current[activeChatId] ?? []).filter(
              (m) => m.id !== initResponse.userMessage.id
            ),
            initResponse.userMessage,
            optimisticAssistant,
          ],
        }));
        setMessagesStatusByChatId((current) => ({
          ...current,
          [activeChatId]: 'success',
        }));

        // Initialise streaming state
        setStreamingStateByMessageId((current) => ({
          ...current,
          [tempAssistantId]: { phase: 'init', steps: [] },
        }));

        // Step 2: open SSE stream and wait for it to complete
        const finalData = await new Promise((resolve, reject) => {
          const url = getChatMessageStreamUrl(activeChatId, initResponse.streamToken);
          const es = new EventSource(url, { withCredentials: true });

          es.onmessage = (event) => {
            let data;
            try {
              data = JSON.parse(event.data);
            } catch {
              return;
            }

            if (data.phase === 'token') {
              // Append token to the message bubble
              setMessagesByChatId((current) => ({
                ...current,
                [activeChatId]: (current[activeChatId] ?? []).map((m) =>
                  m.id === tempAssistantId
                    ? { ...m, content: m.content + data.text }
                    : m
                ),
              }));

              // Keep the last generating step active during token streaming
              setStreamingStateByMessageId((current) => ({
                ...current,
                [tempAssistantId]: {
                  ...(current[tempAssistantId] ?? { steps: [] }),
                  phase: 'token',
                },
              }));
            } else if (data.phase === 'final') {
              es.close();

              // Replace temp message with the persisted assistant message
              setMessagesByChatId((current) => ({
                ...current,
                [activeChatId]: [
                  ...(current[activeChatId] ?? []).filter(
                    (m) => m.id !== tempAssistantId
                  ),
                  {
                    id: data.messageId,
                    chatId: activeChatId,
                    role: 'assistant',
                    content: data.content,
                    status: 'completed',
                    createdAt: new Date().toISOString(),
                  },
                ],
              }));

              setChats((current) => upsertChat(current, data.chat));

              if (Array.isArray(data.agentActions) && data.agentActions.length > 0) {
                setAgentActionsByMessageId((current) => ({
                  ...current,
                  [data.messageId]: data.agentActions,
                }));
              }

              // Clean up streaming state
              setStreamingStateByMessageId((current) => {
                const next = { ...current };
                delete next[tempAssistantId];
                return next;
              });

              resolve(data);
            } else if (data.phase === 'error') {
              es.close();

              setMessagesByChatId((current) => ({
                ...current,
                [activeChatId]: (current[activeChatId] ?? []).map((m) =>
                  m.id === tempAssistantId
                    ? {
                        ...m,
                        status: 'failed',
                        content: data.text || 'Failed to generate a response.',
                      }
                    : m
                ),
              }));

              setStreamingStateByMessageId((current) => {
                const next = { ...current };
                delete next[tempAssistantId];
                return next;
              });

              reject(new Error(data.text || 'Stream error'));
            } else if (STEP_PHASES.has(data.phase)) {
              setStreamingStateByMessageId((current) => {
                const old = current[tempAssistantId] ?? { steps: [] };

                // When a tool result arrives, patch the matching tool_executing
                // step (same tool + tokenId key) with the cost and final text
                // instead of adding a redundant second row.
                if (data.phase === 'tool_result') {
                  const incomingKey = toolStepKey(data.tool, data.tokenId);
                  const idx = [...old.steps]
                    .reverse()
                    .findIndex(
                      (s) =>
                        s.phase === 'tool_executing' &&
                        (s.key ?? s.tool) === incomingKey,
                    );
                  if (idx !== -1) {
                    const realIdx = old.steps.length - 1 - idx;
                    const updated = old.steps.map((s, i) =>
                      i === realIdx
                        ? {
                            ...s,
                            phase: 'tool_result',
                            text: data.text ?? s.text,
                            cost: data.cost,
                          }
                        : s,
                    );
                    return {
                      ...current,
                      [tempAssistantId]: { phase: data.phase, steps: updated },
                    };
                  }
                }

                return {
                  ...current,
                  [tempAssistantId]: {
                    phase: data.phase,
                    steps: [...old.steps, buildStepFromEvent(data)],
                  },
                };
              });
            }
          };

          es.onerror = () => {
            es.close();
            reject(new Error('Stream connection failed.'));
          };
        });

        return finalData;
      } catch (requestError) {
        if (activeChatId && tempAssistantId) {
          setMessagesByChatId((current) => ({
            ...current,
            [activeChatId]: (current[activeChatId] ?? []).filter(
              (m) => m.id !== tempAssistantId
            ),
          }));
          setStreamingStateByMessageId((current) => {
            const next = { ...current };
            delete next[tempAssistantId];
            return next;
          });
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
      setStreamingStateByMessageId({});
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
    streamingStateByMessageId,
    selectChat: handleSelectChat,
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat,
    reloadChats: loadChats,
    reloadMessages: loadMessages,
    sendMessage,
  };
}
