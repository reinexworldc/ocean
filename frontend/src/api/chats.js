import { apiRequest } from './client';

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
