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

function normalizeStepText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\s*\(cached\)\s*$/i, '');
}

function buildStepFromEvent(data) {
  switch (data.phase) {
    case 'planning':
      return { phase: 'planning', text: data.text ?? 'Analyzing your request' };
    case 'retrying':
      return {
        phase: 'retrying',
        text: data.text ?? `Retrying${data.attempt ? ` (attempt ${data.attempt})` : ''}...`,
        attempt: data.attempt ?? undefined,
        retryAfterMs: data.retryAfterMs ?? undefined,
      };
    case 'tool_executing':
      return {
        phase: 'tool_executing',
        text: normalizeStepText(data.text) ?? `Fetching ${(ACTION_LABELS[data.tool] ?? data.tool).toLowerCase()}`,
        cost: data.cost ?? undefined,
        tool: data.tool,
        tokenId: data.tokenId ?? null,
        key: toolStepKey(data.tool, data.tokenId),
      };
    case 'tool_result':
      return {
        phase: 'tool_result',
        text: normalizeStepText(data.text) ?? (ACTION_LABELS[data.tool] ?? data.tool),
        cost: data.cost,
        tool: data.tool,
        tokenId: data.tokenId ?? null,
        key: toolStepKey(data.tool, data.tokenId),
      };
    case 'anomaly_detected':
      return {
        phase: 'anomaly_detected',
        text: data.text ?? 'Anomaly detected — running diagnostic checks',
        anomalies: Array.isArray(data.anomalies) ? data.anomalies : [],
      };
    case 'model_swap':
      return {
        phase: 'model_swap',
        text: data.text ?? 'Primary model busy, switched to backup',
        fromModel: data.fromModel ?? '',
        toModel: data.toModel ?? '',
      };
    case 'generating':
      return { phase: 'generating', text: 'Generating response' };
    case 'trade_proposal':
      return {
        phase: 'trade_proposal',
        text: `${data.proposal?.direction === 'BUY' ? 'Buy' : 'Sell'} ${data.proposal?.tokenSymbol ?? ''} proposal ready`,
        proposal: data.proposal ?? null,
      };
    default:
      return { phase: data.phase, text: data.text ?? data.phase };
  }
}

const STEP_PHASES = new Set([
  'planning',
  'tool_executing',
  'tool_result',
  'anomaly_detected',
  'model_swap',
  'generating',
  'trade_proposal',
]);

const STREAM_RETRY_POLICY = {
  maxRetries: 15,
  maxTotalRetryMs: 180_000,
  defaultRetryMs: 1500,
};

function shouldAppendStep(existingSteps, nextStep) {
  if (!Array.isArray(existingSteps) || existingSteps.length === 0) return true;

  if (nextStep.phase === 'tool_executing') {
    const incomingKey = nextStep.key ?? nextStep.tool;
    if (!incomingKey) return true;

    // If this tool call was already announced (or already finished), don't add a duplicate
    // entry on reconnect/retry — keep the UI stable.
    const alreadyAnnounced = existingSteps.some(
      (s) =>
        (s.phase === 'tool_executing' || s.phase === 'tool_result') &&
        (s.key ?? s.tool) === incomingKey,
    );
    return !alreadyAnnounced;
  }

  if (nextStep.phase === 'model_swap') {
    // Model swap is informational; avoid duplicating identical swap messages on retries.
    return !existingSteps.some(
      (s) => s.phase === 'model_swap' && s.fromModel === nextStep.fromModel && s.toModel === nextStep.toModel,
    );
  }

  return true;
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
  const [agentActionsByMessageId, setAgentActionsByMessageId] = useState({});
  const [streamingStateByMessageId, setStreamingStateByMessageId] = useState({});
  const [tradeProposalsByMessageId, setTradeProposalsByMessageId] = useState({});

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
    async (content, { chatId: overrideChatId, onNewChatCreated } = {}) => {
      if (!enabled) {
        throw new Error('Authentication is required.');
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return null;
      }

      let activeChatId = overrideChatId !== undefined ? overrideChatId : selectedChatId;
      let tempAssistantId = null;

      try {
        if (!activeChatId) {
          const createdChat = await handleCreateChat();
          activeChatId = createdChat.id;
          onNewChatCreated?.(createdChat);
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
          const token = initResponse.streamToken;
          let retryCount = 0;
          let retryTimer = null;
          let es = null;
          let clearAssistantOnNextToken = false;
          const retryStartedAt = Date.now();

          const closeStream = () => {
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = null;
            }
            if (es) {
              es.close();
              es = null;
            }
          };

          const failWithMessage = (text) => {
            closeStream();
            setMessagesByChatId((current) => ({
              ...current,
              [activeChatId]: (current[activeChatId] ?? []).map((m) =>
                m.id === tempAssistantId
                  ? { ...m, status: 'failed', content: text || 'Something went wrong. Please try again.' }
                  : m
              ),
            }));
            setStreamingStateByMessageId((current) => {
              const next = { ...current };
              delete next[tempAssistantId];
              return next;
            });
            void loadChats();
            resolve(null);
          };

          const scheduleRetry = (ms) => {
            const elapsed = Date.now() - retryStartedAt;
            if (
              retryCount >= STREAM_RETRY_POLICY.maxRetries ||
              elapsed >= STREAM_RETRY_POLICY.maxTotalRetryMs
            ) {
              failWithMessage(
                'Upstream providers are temporarily unavailable. Please try again in a moment.',
              );
              return;
            }

            retryCount += 1;
            const delay = Math.max(
              250,
              Number.isFinite(ms) ? ms : STREAM_RETRY_POLICY.defaultRetryMs,
            );

            // Keep a single, stable assistant bubble in UI while retrying.
            // We only clear its content right before the next token arrives to
            // avoid duplicated tokens, without visually "resetting everything".
            setMessagesByChatId((current) => ({
              ...current,
              [activeChatId]: (current[activeChatId] ?? []).map((m) =>
                m.id === tempAssistantId ? { ...m, status: 'pending' } : m
              ),
            }));
            clearAssistantOnNextToken = true;

            // Retries happen silently in the background; don't add "Retrying…" noise
            // or any duplicate "(cached)" steps to the visible list.
            setStreamingStateByMessageId((current) => ({
              ...current,
              [tempAssistantId]: {
                ...(current[tempAssistantId] ?? { steps: [] }),
                phase: 'retrying',
              },
            }));

            retryTimer = setTimeout(() => {
              openStream();
            }, delay);
          };

          const openStream = () => {
            closeStream();
            const url = getChatMessageStreamUrl(activeChatId, token);
            es = new EventSource(url, { withCredentials: true });

            es.onmessage = (event) => {
              let data;
              try {
                data = JSON.parse(event.data);
              } catch {
                return;
              }

              if (data.phase === 'token') {
                setMessagesByChatId((current) => ({
                  ...current,
                  [activeChatId]: (current[activeChatId] ?? []).map((m) =>
                    m.id === tempAssistantId
                      ? {
                          ...m,
                          content: (clearAssistantOnNextToken ? '' : m.content) + data.text,
                        }
                      : m
                  ),
                }));
                clearAssistantOnNextToken = false;

                setStreamingStateByMessageId((current) => ({
                  ...current,
                  [tempAssistantId]: {
                    ...(current[tempAssistantId] ?? { steps: [] }),
                    phase: 'token',
                  },
                }));
              } else if (data.phase === 'final') {
                closeStream();

                setMessagesByChatId((current) => ({
                  ...current,
                  [activeChatId]: [
                    ...(current[activeChatId] ?? []).filter((m) => m.id !== tempAssistantId),
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

                if (data.tradeProposal) {
                  setTradeProposalsByMessageId((current) => ({
                    ...current,
                    [data.messageId]: data.tradeProposal,
                  }));
                }

                setStreamingStateByMessageId((current) => {
                  const next = { ...current };
                  delete next[tempAssistantId];
                  return next;
                });

                resolve(data);
              } else if (data.phase === 'error') {
                // Retryable stream errors come from backend with retry metadata.
                if (data.retryable) {
                  closeStream();
                  scheduleRetry(data.retryAfterMs);
                  return;
                }

                failWithMessage(data.text);
              } else if (STEP_PHASES.has(data.phase)) {
                setStreamingStateByMessageId((current) => {
                  const old = current[tempAssistantId] ?? { steps: [] };

                  if (data.phase === 'tool_result') {
                    const incomingKey = toolStepKey(data.tool, data.tokenId);
                    const normalizedText = normalizeStepText(data.text);

                    // If we already have a result for this tool, don't append a new step.
                    // This prevents reconnect retries from adding "(cached)" or duplicating.
                    const existingResultIndex = old.steps.findIndex(
                      (s) => s.phase === 'tool_result' && (s.key ?? s.tool) === incomingKey,
                    );
                    if (existingResultIndex !== -1) {
                      const updated = old.steps.map((s, i) =>
                        i === existingResultIndex
                          ? {
                              ...s,
                              cost: data.cost ?? s.cost,
                              text: normalizedText ?? s.text,
                            }
                          : s,
                      );
                      return {
                        ...current,
                        [tempAssistantId]: { phase: data.phase, steps: updated },
                      };
                    }

                    // Otherwise, upgrade the most recent executing step (if present).
                    const idx = [...old.steps].reverse().findIndex(
                      (s) => s.phase === 'tool_executing' && (s.key ?? s.tool) === incomingKey,
                    );
                    if (idx !== -1) {
                      const realIdx = old.steps.length - 1 - idx;
                      const updated = old.steps.map((s, i) =>
                        i === realIdx
                          ? {
                              ...s,
                              phase: 'tool_result',
                              text: normalizedText ?? s.text,
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

                  const nextStep = buildStepFromEvent(data);
                  if (!shouldAppendStep(old.steps, nextStep)) {
                    return {
                      ...current,
                      [tempAssistantId]: {
                        phase: data.phase,
                        steps: old.steps,
                      },
                    };
                  }

                  return {
                    ...current,
                    [tempAssistantId]: {
                      phase: data.phase,
                      steps: [...old.steps, nextStep],
                    },
                  };
                });
              }
            };

            es.onerror = () => {
              // Network hiccup: retry with backoff, but don't fail fast.
              closeStream();
              scheduleRetry(STREAM_RETRY_POLICY.defaultRetryMs);
            };
          };

          openStream();
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
      setAgentActionsByMessageId({});
      setStreamingStateByMessageId({});
      setTradeProposalsByMessageId({});
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
    messagesByChatId,
    messagesStatusByChatId,
    messagesErrorByChatId,
    isCreatingChat,
    agentActionsByMessageId,
    streamingStateByMessageId,
    tradeProposalsByMessageId,
    selectChat: handleSelectChat,
    createChat: handleCreateChat,
    deleteChat: handleDeleteChat,
    reloadChats: loadChats,
    reloadMessages: loadMessages,
    sendMessage,
  };
}
