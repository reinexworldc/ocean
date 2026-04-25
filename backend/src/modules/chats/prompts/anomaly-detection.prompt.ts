import { HISTORY_PERIODS } from "../../payments/paid-api-catalog.js";

function safeJsonStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

/**
 * Anomaly thresholds used to guide the prompt.
 * Centralised here so they are easy to tune.
 */
export const ANOMALY_THRESHOLDS = {
  /** Absolute price change % that triggers a history deep-dive. */
  sharpPriceChangePct: 15,
  /** Sentiment score (0-100) below which bearish anomaly is flagged. */
  extremeBearishScore: 25,
  /** Sentiment score (0-100) above which euphoric anomaly is flagged. */
  extremeBullishScore: 75,
} as const;

/**
 * After initial + refinement phases we have real data.
 * This prompt asks Gemini to:
 *   1. Scan all tool results for anomalies (sharp price moves, extreme sentiment, etc.)
 *   2. Decide whether additional diagnostic actions are warranted.
 *   3. Return only genuinely new calls — NOT duplicates of already-executed ones.
 *
 * This step is intentionally conservative: max 3 additional actions to keep
 * micropayment costs predictable.
 */
export function buildAnomalyDetectionPrompt(params: {
  latestUserMessage: string;
  alreadyExecuted: Array<{ type: string; tokenId?: string; period?: string }>;
  toolResults: Array<Record<string, unknown>>;
}): string {
  const alreadyExecutedKeys = params.alreadyExecuted.map((a) => {
    const parts = [a.type];
    if (a.tokenId) parts.push(a.tokenId.toUpperCase());
    if (a.period) parts.push(a.period);
    return parts.join(":");
  });

  return [
    "You are the Ocean anomaly-detection planner.",
    "Your sole job is to scan the tool results below for data anomalies and decide whether",
    "additional premium API calls are needed to explain or confirm those anomalies.",
    "Each additional call triggers a real micropayment — be conservative.",

    "## Anomaly signals to look for",
    `- Price history where |priceChangePct| >= ${ANOMALY_THRESHOLDS.sharpPriceChangePct}%`,
    "  (sharp pump or dump that needs broader context, e.g. a different time period).",
    `- Market sentiment score <= ${ANOMALY_THRESHOLDS.extremeBearishScore} (extreme fear) or`,
    `  >= ${ANOMALY_THRESHOLDS.extremeBullishScore} (extreme greed) — warrant a token deep-dive.`,
    "- Token price or volume data that conflicts with what the user expected based on their message.",

    "## Available investigation actions",
    '1. {"type":"get_token_details","tokenId":"SOL"}   — fetch current metrics, holders, transfers',
    '2. {"type":"get_token_history","tokenId":"SOL","period":"7d"} — broader context for a price move',
    '   (useful when the anomaly was detected in a shorter period like 24h)',
    '3. {"type":"get_signal","tokenId":"SOL"} — buy/sell/hold verdict from the autonomous Signal Agent ($0.005)',
    '   The Signal Agent itself pays $0.01 to fetch fresh token data and synthesizes a directional signal.',
    '   Use this when you detect extreme sentiment or a sharp price move and want a synthesized verdict.',

    "## Rules",
    "- Return strict JSON only: {\"actions\":[...], \"anomalies\":[...]} — no markdown fences.",
    "- anomalies: array of short strings describing what was detected (for the UI). Empty array if none.",
    "- actions: ONLY actions NOT already in the executed list. Return [] if nothing is needed.",
    "- Do NOT re-fetch get_market_overview or get_wallet_portfolio.",
    "- Only act on REAL anomalies visible in the data. If everything looks normal, return empty arrays.",
    "- Maximum 3 additional actions total.",
    "- Use uppercase token ids.",
    `- Supported history periods: ${HISTORY_PERIODS.join(", ")}.`,
    "- Deduplication: two actions are duplicates only when type + tokenId + period all match.",
    "- CRITICAL: Only investigate anomalies for tokens the user explicitly requested in their message. Do NOT flag or fetch additional data for tokens that only appeared incidentally (e.g. in a market overview top-losers/gainers list). If the user asked about MOON, only run diagnostic checks on MOON.",
    "- CRITICAL: Do NOT emit get_signal if the already-executed actions include compare_arc_token. Token comparison is a data query — not a buy/sell decision. Only emit get_signal when the user explicitly asked for a trading signal, buy/sell recommendation, or momentum verdict.",
    "- CRITICAL: Do NOT emit get_signal if the user's message is a comparison request (contains words like 'compare', 'vs', 'versus', 'contrast', 'benchmark', 'compare 2 tokens', 'how does X compare to Y'). Comparison requests are data queries, not signal requests. get_signal is only appropriate when the user explicitly asks for a signal, recommendation, buy/sell advice, or directional verdict.",
    "- CRITICAL: If the only executed action is get_market_overview AND the user's message is about Arc economics, Arc vs Ethereum, Arc margins, or why Arc is better than ETH — return empty arrays. This is an educational/conceptual query, not a trading investigation.",

    `Already executed actions (do NOT repeat):\n${safeJsonStringify(alreadyExecutedKeys)}`,
    `Tool results:\n${safeJsonStringify(params.toolResults)}`,
    `User message: ${params.latestUserMessage}`,
  ].join("\n\n");
}
