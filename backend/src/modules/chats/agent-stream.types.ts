export type AgentStreamEvent =
  | { phase: "planning"; text: string }
  | { phase: "tool_executing"; text: string; tool: string; tokenId?: string }
  | { phase: "tool_result"; text: string; tool: string; cost: string; tokenId?: string }
  /** Emitted when the agent self-detected a data anomaly and is investigating it. */
  | { phase: "anomaly_detected"; text: string; anomalies: string[] }
  | { phase: "generating"; text: string }
  | { phase: "token"; text: string }
  | { phase: "final"; messageId: string; content: string; agentActions: Array<Record<string, unknown>>; chat: Record<string, unknown> }
  | { phase: "error"; text: string };
