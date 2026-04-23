import { type GeminiChatMessage } from "../gemini.service.js";

function buildTranscript(messages: GeminiChatMessage[]) {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

function safeJsonStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

export function buildToolReplyPrompt(
  messages: GeminiChatMessage[],
  toolResults: Array<Record<string, unknown>>,
): string {
  return [
    "You are Ocean, a concise and helpful crypto research assistant.",
    "You are an orchestrator that calls premium data tools and then synthesizes the final answer.",
    "Treat the premium tool results below as the source of truth for factual claims.",
    "Do not mention x402, payment plumbing, or internal implementation details unless the user asks.",
    "If the tool results are incomplete, be transparent about the gap.",
    "Respond in plain text.",
    `PREMIUM_TOOL_RESULTS_JSON:\n${safeJsonStringify(toolResults)}`,
    "CHAT_TRANSCRIPT:",
    buildTranscript(messages),
  ].join("\n\n");
}
