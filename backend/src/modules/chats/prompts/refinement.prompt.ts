import { HISTORY_PERIODS } from "../../payments/paid-api-catalog.js";

export type ExecutedActionSummary = {
  type: string;
  tokenId?: string;
  period?: string;
};

function safeJsonStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

/**
 * After the initial tool execution we may have market overview data that
 * reveals specific token IDs the user was vaguely referring to ("top tokens",
 * "most active tokens", etc.).  This prompt asks the planner to inspect those
 * results and decide whether additional token-specific calls are needed.
 */
export function buildRefinementPrompt(params: {
  latestUserMessage: string;
  alreadyExecuted: ExecutedActionSummary[];
  toolResults: Array<Record<string, unknown>>;
}): string {
  const alreadyExecutedKeys = params.alreadyExecuted.map((a) => {
    const parts = [a.type];
    if (a.tokenId) parts.push(a.tokenId.toUpperCase());
    if (a.period) parts.push(a.period);
    return parts.join(":");
  });

  return [
    "You are the Ocean premium tool refinement planner.",
    "You have already executed an initial set of premium API calls and received their results.",
    "Your job: decide whether additional token lookups are needed to fully answer the user's request.",

    "A common case: the user asked for 'top tokens' or 'most active tokens' without naming them.",
    "The market overview result below may list specific token IDs (e.g. topByVolume, topGainers).",
    "If the user wants details on those tokens and they have NOT been fetched yet, plan those calls now.",

    'Return strict JSON only in the format {"actions":[...]} with no markdown fences.',
    "Return an empty actions array if no additional calls are needed.",

    "Available actions:",
    '1. {"type":"get_token_details","tokenId":"SOL"} -> GET /token/:id',
    '2. {"type":"get_token_history","tokenId":"SOL","period":"24h"} -> GET /token/:id/history?period=24h',

    "Rules:",
    "- Only return actions NOT already in the executed list below.",
    "- Use uppercase token ids.",
    `- Supported history periods: ${HISTORY_PERIODS.join(", ")}.`,
    "- Do not add get_market_overview again (already executed).",
    "- Deduplication rule: two actions are duplicates ONLY when type + tokenId + period all match.",
    "- Limit additional actions to what is genuinely needed; do not over-fetch.",
    "- CRITICAL: Only use token IDs that appear explicitly in the tool results below (e.g. in topByVolume, topGainers, topLosers arrays). Never invent or guess token IDs — if a token ID does not appear in the result data, do not include it.",

    `Already executed actions (do NOT repeat these):\n${safeJsonStringify(alreadyExecutedKeys)}`,
    `Initial tool results:\n${safeJsonStringify(params.toolResults)}`,
    `User message: ${params.latestUserMessage}`,
  ].join("\n\n");
}
