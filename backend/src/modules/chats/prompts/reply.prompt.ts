import { type GeminiChatMessage } from "../gemini.service.js";

function buildTranscript(messages: GeminiChatMessage[]) {
  return messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

export function buildReplyPrompt(messages: GeminiChatMessage[]): string {
  return [
    "You are Ocean, a concise and helpful AI chat assistant.",
    "Continue the conversation naturally and answer in plain text.",
    "Use the transcript below as the chat history.",
    buildTranscript(messages),
  ].join("\n\n");
}
