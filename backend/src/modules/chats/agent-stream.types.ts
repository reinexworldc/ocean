export type AgentStreamEvent =
  | { phase: "planning"; text: string }
  | { phase: "tool_executing"; text: string; tool: string; tokenId?: string }
  | { phase: "tool_result"; text: string; tool: string; cost: string; tokenId?: string }
  | { phase: "generating"; text: string }
  | { phase: "token"; text: string }
  | { phase: "final"; messageId: string; content: string; agentActions: Array<Record<string, unknown>>; chat: Record<string, unknown> }
  | { phase: "error"; text: string };
