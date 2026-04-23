import { apiRequest } from './client.js';

/**
 * Confirms a trade proposal. Charges $0.05 via x402 from the user's Circle wallet,
 * executes the on-chain token transfer (buy) or records a pending sell,
 * and writes a Trade record to the database.
 *
 * @param {{ direction: 'BUY'|'SELL', tokenId: string, tokenAmount: number, chatId?: string }} params
 */
export async function confirmTrade({ direction, tokenId, tokenAmount, chatId }) {
  return apiRequest('/trade/confirm', {
    method: 'POST',
    body: JSON.stringify({ direction, tokenId, tokenAmount, chatId }),
  });
}
