import { apiRequest } from './client';

export function getCircleWallet() {
  return apiRequest('/circle-wallet/me');
}
