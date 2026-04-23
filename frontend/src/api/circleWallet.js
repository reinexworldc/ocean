import { apiRequest } from './client';

export function getCircleWallet() {
  return apiRequest('/circle-wallet/me');
}

export function replenishCircleWallet() {
  return apiRequest('/circle-wallet/replenish', { method: 'POST' });
}
