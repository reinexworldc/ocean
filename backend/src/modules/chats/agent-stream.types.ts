export type TradeProposal = {
  tokenId: string;
  tokenSymbol: string;
  tokenAddress: string;
  direction: "BUY" | "SELL";
  tokenAmount: number;
  priceUsdEach: number;
  totalValueUsd: number;
  serviceFeeUsd: string;
  walletAddress: string;
};

export type AgentStreamEvent =
  | { phase: "planning"; text: string }
  | { phase: "tool_executing"; text: string; tool: string; tokenId?: string }
  | { phase: "tool_result"; text: string; tool: string; cost: string; tokenId?: string }
  /** Emitted when the agent self-detected a data anomaly and is investigating it. */
  | { phase: "anomaly_detected"; text: string; anomalies: string[] }
  /** Emitted when a model is unavailable and the agent transparently swaps to a fallback. */
  | { phase: "model_swap"; text: string; fromModel: string; toModel: string }
  | { phase: "generating"; text: string }
  | { phase: "token"; text: string }
  | { phase: "trade_proposal"; proposal: TradeProposal }
  | { phase: "final"; messageId: string; content: string; agentActions: Array<Record<string, unknown>>; tradeProposal: TradeProposal | null; chat: Record<string, unknown> }
  | { phase: "error"; text: string };
