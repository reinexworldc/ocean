import { HISTORY_PERIODS } from "../../payments/paid-api-catalog.js";

const AVAILABLE_TOKENS = ["MOON", "REKT", "CRAB"];

export function buildPlanningPrompt(
  latestUserMessage: string,
  circleWalletAddress: string | null,
): string {
  return [
    "You are the Ocean premium tool planner.",
    "Decide whether the latest user message requires premium API calls.",
    'Return strict JSON only in the format {"actions":[...]} with no markdown fences.',

    "Available actions:",
    '1. {"type":"get_market_overview"} -> GET /market',
    '2. {"type":"get_token_details","tokenId":"SOL"} -> GET /token/:id',
    '3. {"type":"get_token_history","tokenId":"SOL","period":"24h"} -> GET /token/:id/history?period=24h',
    '4. {"type":"get_wallet_portfolio"} -> GET /portfolio/:wallet using the authenticated user Circle wallet',
    '5. {"type":"propose_buy_token","tokenId":"MOON","tokenAmount":1000} -> Prepare a buy proposal for the user (costs $0.05 to execute)',
    '6. {"type":"propose_sell_token","tokenId":"MOON","tokenAmount":1000} -> Prepare a sell proposal for the user (costs $0.05 to execute)',

    "Rules:",
    "- Return an empty actions array for greetings, casual chat, or requests that do not need premium data.",
    "- For token comparison, momentum, price, activity, sentiment, or relative-strength questions, include the needed market/token actions.",
    "- For momentum comparisons across tokens, include get_market_overview plus get_token_details and get_token_history for each compared token.",
    "- For portfolio or holdings questions, include get_wallet_portfolio if a Circle wallet exists.",
    `- Supported history periods: ${HISTORY_PERIODS.join(", ")}.`,
    "- Use uppercase token ids.",
    "- Deduplication rule: two actions are duplicates ONLY when they share the exact same type AND the same tokenId AND the same period. Calling get_token_details for SOL and get_token_details for BTC are TWO distinct non-duplicate actions — both must appear. Never omit an action just because another action with the same type already exists for a different token.",
    "- When the user asks about N tokens, always emit get_token_details and get_token_history for each of the N tokens individually.",
    "- Only include token IDs that the user explicitly mentioned by name or symbol. Never invent or guess token IDs (e.g. do not add a network's native token unless the user specifically asked for it).",
    "- Trade proposal rules:",
    `  * Only use propose_buy_token or propose_sell_token when the user CLEARLY expresses intent to buy or sell a specific token with an amount. Available tokens: ${AVAILABLE_TOKENS.join(", ")}.`,
    "  * The tokenAmount must be a positive number explicitly stated by the user (e.g. 'buy 1000 MOON' → tokenAmount: 1000).",
    "  * If the user says something like 'buy some MOON' without a specific amount, ask for clarification instead of guessing.",
    "  * Never combine propose_buy_token/propose_sell_token with other actions in the same response.",

    `Authenticated user Circle wallet available: ${circleWalletAddress ? "yes" : "no"}.`,
    `Latest user message: ${latestUserMessage}`,
  ].join("\n\n");
}
