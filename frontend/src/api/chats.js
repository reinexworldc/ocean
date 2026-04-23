import { apiRequest, getApiBaseUrl } from './client';

export function getChats() {
  return apiRequest('/chats');
}

export function createChat(payload = {}) {
  return apiRequest('/chats', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getChatMessages(chatId) {
  return apiRequest(`/chats/${chatId}/messages`);
}

export function createChatMessage(chatId, payload) {
  return apiRequest(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function initChatMessageStream(chatId, payload) {
  return apiRequest(`/chats/${chatId}/messages/stream-init`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteChat(chatId) {
  return apiRequest(`/chats/${chatId}`, {
    method: 'DELETE',
  });
}

export function getChatMessageStreamUrl(chatId, token) {
  return `${getApiBaseUrl()}/chats/${chatId}/messages/stream?token=${encodeURIComponent(token)}`;
}
