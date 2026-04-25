import { Inject, Injectable } from "@nestjs/common";
import { type GeminiChatMessage, GeminiService, type PlannedPremiumAction } from "./gemini.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { TradeService } from "../trade/trade.service.js";
import { type HistoryPeriod, paidApiCatalog } from "../payments/paid-api-catalog.js";
import { type AgentStreamEvent, type TradeProposal } from "./agent-stream.types.js";

const ACTION_LABELS: Record<string, string> = {
  get_market_overview: "Market Overview",
  get_token_profile: "Token Profile",
  get_token_erc20: "Token Contract",
  get_token_transfers: "Token Transfers",
  get_token_holders: "Token Holders",
  get_token_history: "Token History",
  get_wallet_portfolio: "Wallet Portfolio",
  get_signal: "Signal Agent",
  compare_arc_token: "Token Comparison",
};

export type ExecutedAgentAction = {
  type: PlannedPremiumAction["type"];
  /** Optional identifiers used to de-duplicate tool calls across stream retries. */
  tokenId?: string;
  period?: HistoryPeriod;
  /** Used by compare_arc_token to track the external coin for dedup. */
  externalCoin?: string;
  endpoint: string;
  amountUsd: string;
  transactionId: string;
  settlementTransaction: string;
  paymentNetwork: string;
  summary: Record<string, unknown>;
};

export type ChatAgentResult = {
  content: string;
  executedActions: ExecutedAgentAction[];
  tradeProposal: TradeProposal | null;
};

@Injectable()
export class ChatAgentService {
  private readonly maxToolConcurrency = Math.max(
    1,
    Number(process.env.AGENT_TOOL_MAX_CONCURRENCY ?? 2),
  );

  private txUrlForArcTestnet(txHash: string) {
    // GatewayWalletBatched returns a UUID as the settlement "transaction" — not an on-chain hash.
    // Skip the explorer link for these until the facilitator exposes the real tx hash.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txHash)) {
      return undefined;
    }
    return `https://testnet.arcscan.app/tx/${txHash}`;
  }

  constructor(
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
    @Inject(TradeService) private readonly tradeService: TradeService,
  ) {}

  async generateReply(params: {
    userId: string;
    chatId: string;
    history: GeminiChatMessage[];
    latestUserMessage: string;
    circleWalletAddress: string | null;
  }): Promise<ChatAgentResult> {
    const plannedActions = await this.geminiService.planPremiumActions({
      latestUserMessage: params.latestUserMessage,
      circleWalletAddress: params.circleWalletAddress,
    });

    if (plannedActions.length === 0) {
      return {
        content: await this.geminiService.generateReply(params.history),
        executedActions: [],
        tradeProposal: null,
      };
    }

    // Check if the plan is a trade proposal (handled separately — no x402 needed).
    const tradeAction = plannedActions.find(
      (a) => a.type === "propose_buy_token" || a.type === "propose_sell_token",
    );

    if (tradeAction && (tradeAction.type === "propose_buy_token" || tradeAction.type === "propose_sell_token")) {
      const proposal = await this.buildTradeProposal(tradeAction, params.circleWalletAddress);
      const tokens = this.geminiService.generateReplyForTradeProposalStream(params.history, proposal);
      let content = "";
      for await (const token of tokens) content += token;
      return {
        content,
        executedActions: [],
        tradeProposal: proposal,
      };
    }

    const executedActions = await this.runActionsParallel(
      params.userId,
      params.chatId,
      params.circleWalletAddress,
      plannedActions,
    );

    // Phase 2 — resolve implicit token IDs from market data.
    const refinedActions = await this.geminiService.planRefinedActions({
      latestUserMessage: params.latestUserMessage,
      alreadyExecuted: this.toExecutedSummaries(plannedActions),
      toolResults: this.toToolResults(executedActions),
    });

    if (refinedActions.length > 0) {
      const refinedResults = await this.runActionsParallel(
        params.userId,
        params.chatId,
        params.circleWalletAddress,
        refinedActions,
      );
      executedActions.push(...refinedResults);
    }

    // Phase 3 — anomaly self-check: agent decides if data warrants investigation.
    const allExecutedSoFar = [...plannedActions, ...refinedActions];
    const { actions: anomalyActions } = await this.geminiService.planAnomalyInvestigation({
      latestUserMessage: params.latestUserMessage,
      alreadyExecuted: this.toExecutedSummaries(allExecutedSoFar),
      toolResults: this.toToolResults(executedActions),
    });

    if (anomalyActions.length > 0) {
      const anomalyResults = await this.runActionsParallel(
        params.userId,
        params.chatId,
        params.circleWalletAddress,
        anomalyActions,
      );
      executedActions.push(...anomalyResults);
    }

    return {
      content: await this.geminiService.generateReplyWithToolResults({
        messages: params.history,
        toolResults: this.toToolResults(executedActions),
      }),
      executedActions,
      tradeProposal: null,
    };
  }

  async *generateReplyStream(
    params: {
      userId: string;
      chatId: string;
      history: GeminiChatMessage[];
      latestUserMessage: string;
      circleWalletAddress: string | null;
    },
    out: { executedActions: ExecutedAgentAction[]; tradeProposal: TradeProposal | null },
    options?: {
      attempt?: number;
      planState?: {
        plannedActions: PlannedPremiumAction[] | null;
        refinedActions: PlannedPremiumAction[] | null;
        anomalyActions: PlannedPremiumAction[] | null;
        anomalies: string[] | null;
      };
    },
  ): AsyncGenerator<AgentStreamEvent> {
    const attempt = Math.max(1, options?.attempt ?? 1);
    const planState = options?.planState;

    const shouldAnnounceTopPlanning = !planState?.plannedActions && attempt === 1;
    if (shouldAnnounceTopPlanning) {
      yield { phase: "planning", text: "Analyzing your request..." };
    }

    const swapQueue: Array<{ from: string; to: string }> = [];
    const onModelSwap = (from: string, to: string) => swapQueue.push({ from, to });

    const ranPremiumPlanner = planState ? planState.plannedActions === null : true;
    const plannedActions =
      planState?.plannedActions ??
      (await this.geminiService.planPremiumActions(
        {
          latestUserMessage: params.latestUserMessage,
          circleWalletAddress: params.circleWalletAddress,
        },
        onModelSwap,
      ));
    if (planState && planState.plannedActions === null) {
      planState.plannedActions = plannedActions;
    }
    // Only drain model swaps when we actually ran the planner (otherwise we'd repeat them).
    if (ranPremiumPlanner) {
      yield* this.drainModelSwapEvents(swapQueue);
    }

    if (plannedActions.length === 0) {
      yield { phase: "generating", text: "Generating response..." };

      // Await the first token so the onModelSwap callback fires before we yield any tokens.
      const tokenStream = this.geminiService.generateReplyStream(params.history, onModelSwap);
      const first = await tokenStream.next();
      yield* this.drainModelSwapEvents(swapQueue);
      if (!first.done && first.value) yield { phase: "token", text: first.value };
      for await (const token of tokenStream) yield { phase: "token", text: token };

      return;
    }

    // Check if the plan is a trade proposal — handle without x402 payment.
    const tradeAction = plannedActions.find(
      (a) => a.type === "propose_buy_token" || a.type === "propose_sell_token",
    );

    if (tradeAction && (tradeAction.type === "propose_buy_token" || tradeAction.type === "propose_sell_token")) {
      yield { phase: "planning", text: "Preparing trade proposal..." };
      const proposal = await this.buildTradeProposal(tradeAction, params.circleWalletAddress);
      out.tradeProposal = proposal;
      yield { phase: "trade_proposal", proposal };
      yield { phase: "generating", text: "Generating response..." };

      const tokenStream = this.geminiService.generateReplyForTradeProposalStream(params.history, proposal, onModelSwap);
      const first = await tokenStream.next();
      yield* this.drainModelSwapEvents(swapQueue);
      if (!first.done && first.value) yield { phase: "token", text: first.value };
      for await (const token of tokenStream) yield { phase: "token", text: token };

      return;
    }

    // Phase 1 — announce & execute initial actions.
    yield* this.streamActions(
      params.userId,
      params.chatId,
      params.circleWalletAddress,
      plannedActions,
      out.executedActions,
    );

    // Phase 2 — refinement: discover implicit tokens (e.g. "top tokens")
    // Yield a visible spinner step so the UI never goes silent during the Gemini call.
    if (planState ? planState.refinedActions === null : true) {
      yield { phase: "planning", text: "Refining analysis..." };
    }

    const ranRefiner = planState ? planState.refinedActions === null : true;
    const refinedActions =
      planState?.refinedActions ??
      (await this.geminiService.planRefinedActions(
        {
          latestUserMessage: params.latestUserMessage,
          alreadyExecuted: this.toExecutedSummaries(plannedActions),
          toolResults: this.toToolResults(out.executedActions),
        },
        onModelSwap,
      ));
    if (planState && planState.refinedActions === null) {
      planState.refinedActions = refinedActions;
    }
    if (ranRefiner) {
      yield* this.drainModelSwapEvents(swapQueue);
    }

    if (refinedActions.length > 0) {
      yield* this.streamActions(
        params.userId,
        params.chatId,
        params.circleWalletAddress,
        refinedActions,
        out.executedActions,
      );
    }

    // Phase 3 — anomaly self-check.
    if (planState ? planState.anomalyActions === null : true) {
      yield { phase: "planning", text: "Scanning for anomalies..." };
    }
    const allExecutedSoFar = [...plannedActions, ...refinedActions];
    const ranAnomalyPlanner = planState ? planState.anomalyActions === null : true;
    const anomalyPlan =
      planState?.anomalyActions
        ? { actions: planState.anomalyActions, anomalies: planState.anomalies ?? [] }
        : await this.geminiService.planAnomalyInvestigation(
            {
              latestUserMessage: params.latestUserMessage,
              alreadyExecuted: this.toExecutedSummaries(allExecutedSoFar),
              toolResults: this.toToolResults(out.executedActions),
            },
            onModelSwap,
          );

    const anomalyActions = anomalyPlan.actions;
    const anomalies = anomalyPlan.anomalies;
    if (planState && planState.anomalyActions === null) {
      planState.anomalyActions = anomalyActions;
      planState.anomalies = anomalies;
    }
    if (ranAnomalyPlanner) {
      yield* this.drainModelSwapEvents(swapQueue);
    }

    if (anomalyActions.length > 0) {
      yield {
        phase: "anomaly_detected",
        text: `Anomaly detected — running ${anomalyActions.length} diagnostic check${anomalyActions.length > 1 ? "s" : ""}...`,
        anomalies,
      };

      yield* this.streamActions(
        params.userId,
        params.chatId,
        params.circleWalletAddress,
        anomalyActions,
        out.executedActions,
      );
    }

    yield { phase: "generating", text: "Generating response..." };

    // Await the first token so the onModelSwap callback fires before we yield any tokens.
    const tokenStream = this.geminiService.generateReplyWithToolResultsStream(
      {
        messages: params.history,
        toolResults: this.toToolResults(out.executedActions),
      },
      onModelSwap,
    );
    const first = await tokenStream.next();
    yield* this.drainModelSwapEvents(swapQueue);
    if (!first.done && first.value) yield { phase: "token", text: first.value };
    for await (const token of tokenStream) yield { phase: "token", text: token };
  }

  /** Yields model_swap events for each queued swap and clears the queue. */
  private *drainModelSwapEvents(
    swapQueue: Array<{ from: string; to: string }>,
  ): Generator<AgentStreamEvent> {
    while (swapQueue.length > 0) {
      const ev = swapQueue.shift()!;
      yield {
        phase: "model_swap",
        text: `${ev.from} is busy — switched to ${ev.to}`,
        fromModel: ev.from,
        toModel: ev.to,
      };
    }
  }

  private toToolResults(executed: ExecutedAgentAction[]) {
    return executed.map(({ summary, ...metadata }) => ({ ...metadata, result: summary }));
  }

  private toExecutedSummaries(actions: PlannedPremiumAction[]) {
    return actions.map((a) => ({
      type: a.type,
      tokenId: "tokenId" in a ? a.tokenId : undefined,
      period: "period" in a ? a.period : undefined,
    }));
  }

  /** Announce + execute a batch of actions, yielding stream events as they complete. */
  private async *streamActions(
    userId: string,
    chatId: string,
    circleWalletAddress: string | null,
    actions: PlannedPremiumAction[],
    collector: ExecutedAgentAction[],
  ): AsyncGenerator<AgentStreamEvent> {
    const executedByKey = new Map<string, ExecutedAgentAction>();
    for (const executed of collector) {
      executedByKey.set(this.executedKey(executed), executed);
    }

    const actionsToExecute: PlannedPremiumAction[] = [];

    // Announce tool calls immediately so the UI shows the full list at once.
    // If an action already succeeded in a previous attempt, emit it as cached
    // and do NOT execute again (prevents double-charging).
    for (const action of actions) {
      const { label, tokenId, tokenSuffix } = this.actionMeta(action);
      const cached = executedByKey.get(this.actionKey(action));

      if (cached) {
        const txHash = cached.settlementTransaction?.trim?.() || "";
        const txUrl = txHash ? this.txUrlForArcTestnet(txHash) : undefined;
        yield {
          phase: "tool_result",
          text: `${label}${tokenSuffix} (cached)`,
          tool: action.type,
          cost: cached.amountUsd,
          ...(tokenId ? { tokenId } : {}),
          ...(txHash ? { txHash, txUrl } : {}),
        };
        continue;
      }

      const estimatedCost = this.estimateActionCost(action);
      yield {
        phase: "tool_executing",
        text: `Fetching${tokenSuffix} ${label.toLowerCase()}`,
        tool: action.type,
        ...(estimatedCost ? { cost: estimatedCost } : {}),
        ...(tokenId ? { tokenId } : {}),
      };
      actionsToExecute.push(action);
    }

    // Execute all in parallel; yield each result as it arrives.
    // Every action — whether it succeeds, is skipped (404), or fails — must
    // decrement totalExpected and call the notifier so the while-loop below
    // never hangs waiting for a notification that will never arrive.
    let totalExpected = actionsToExecute.length;
    const settled: Array<AgentStreamEvent & { phase: "tool_result" }> = [];
    const notifiers: Array<() => void> = [];
    let firstError: unknown = null;

    const allDone = this.mapWithConcurrency(actionsToExecute, this.maxToolConcurrency, async (action) => {
        const { label, tokenId, tokenSuffix } = this.actionMeta(action);
        let result: ExecutedAgentAction;
        try {
          result = await this.executeAction(userId, chatId, circleWalletAddress, action);
        } catch (err) {
          totalExpected--;
          notifiers.shift()?.();
          if (!this.isNotFoundError(err) && firstError === null) {
            firstError = err;
          }
          return;
        }
        collector.push(result);
        const txHash = result.settlementTransaction?.trim?.() || "";
        const txUrl = txHash ? this.txUrlForArcTestnet(txHash) : undefined;
        settled.push({
          phase: "tool_result",
          text: `${label}${tokenSuffix}`,
          tool: action.type,
          cost: result.amountUsd,
          ...(tokenId ? { tokenId } : {}),
          ...(txHash ? { txHash, txUrl } : {}),
        });
        notifiers.shift()?.();
      });

    let yielded = 0;
    while (yielded < totalExpected) {
      if (yielded < settled.length) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        yield settled[yielded++]!;
      } else {
        await new Promise<void>((resolve) => notifiers.push(resolve));
      }
    }

    await allDone;

    if (firstError !== null) {
      throw firstError;
    }
  }

  private estimateActionCost(action: PlannedPremiumAction): string | null {
    switch (action.type) {
      case "get_market_overview":
        return paidApiCatalog.getMarketOverview.priceUsd;
      case "get_token_profile":
        return paidApiCatalog.getTokenProfile.priceUsd;
      case "get_token_erc20":
        return paidApiCatalog.getTokenErc20.priceUsd;
      case "get_token_transfers":
        return paidApiCatalog.getTokenTransfers.priceUsd;
      case "get_token_holders":
        return paidApiCatalog.getTokenHolders.priceUsd;
      case "get_token_history":
        return paidApiCatalog.getTokenHistory.priceUsd;
      case "get_wallet_portfolio":
        return paidApiCatalog.getWalletPortfolio.priceUsd;
      case "get_signal":
        return paidApiCatalog.getSignal.priceUsd;
      case "compare_arc_token":
        return paidApiCatalog.getComparison.priceUsd;
      default:
        return null;
    }
  }

  /** Execute a batch of actions in parallel and return all results. */
  private runActionsParallel(
    userId: string,
    chatId: string,
    circleWalletAddress: string | null,
    actions: PlannedPremiumAction[],
  ): Promise<ExecutedAgentAction[]> {
    return this.mapWithConcurrency(actions, this.maxToolConcurrency, (action) =>
      this.executeAction(userId, chatId, circleWalletAddress, action),
    );
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index]!);
      }
    });

    await Promise.all(workers);
    return results;
  }

  /** Returns true when the upstream API responded with 404 (token not found). */
  private isNotFoundError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as Record<string, unknown>;
    // BadGatewayException embeds the upstream status in its message string.
    if (typeof e["message"] === "string" && e["message"].includes("Status: 404")) return true;
    // Also handle plain HTTP 404.
    if (e["status"] === 404 || e["statusCode"] === 404) return true;
    return false;
  }

  private actionMeta(action: PlannedPremiumAction) {
    const label = ACTION_LABELS[action.type] ?? action.type;
    const tokenId =
      "tokenId" in action
        ? action.tokenId.toUpperCase()
        : "arcTokenId" in action
          ? (action as { arcTokenId: string }).arcTokenId.toUpperCase()
          : undefined;
    const tokenSuffix = tokenId ? ` ${tokenId}` : "";
    return { label, tokenId, tokenSuffix };
  }

  private actionKey(action: PlannedPremiumAction): string {
    if (action.type === "compare_arc_token") {
      return `${action.type}:${action.arcTokenId.toUpperCase()}:${action.externalCoin}`;
    }

    const tokenId = "tokenId" in action ? action.tokenId.toUpperCase() : "";
    const period = "period" in action ? String(action.period) : "";
    return `${action.type}:${tokenId}:${period}`;
  }

  private executedKey(executed: ExecutedAgentAction): string {
    if (executed.type === "compare_arc_token") {
      const tokenId = executed.tokenId?.toUpperCase?.() ?? "";
      return `${executed.type}:${tokenId}:${executed.externalCoin ?? ""}`;
    }

    const tokenId = executed.tokenId?.toUpperCase?.() ?? "";
    const period = executed.period ? String(executed.period) : "";
    return `${executed.type}:${tokenId}:${period}`;
  }

  private async buildTradeProposal(
    action: Extract<PlannedPremiumAction, { type: "propose_buy_token" | "propose_sell_token" }>,
    walletAddress: string | null,
  ): Promise<TradeProposal> {
    const token = await this.tradeService.resolveToken(action.tokenId);
    const priceUsdEach = (token as { current: { price: number } }).current.price;
    const totalValueUsd = priceUsdEach * action.tokenAmount;

    return {
      tokenId: (token as { symbol: string }).symbol,
      tokenSymbol: (token as { symbol: string }).symbol,
      tokenAddress: (token as { address: string }).address,
      direction: action.type === "propose_buy_token" ? "BUY" : "SELL",
      tokenAmount: action.tokenAmount,
      priceUsdEach,
      totalValueUsd,
      serviceFeeUsd: "0.05",
      walletAddress: walletAddress ?? "",
    };
  }

  private async executeAction(
    userId: string,
    chatId: string,
    circleWalletAddress: string | null,
    action: PlannedPremiumAction,
  ): Promise<ExecutedAgentAction> {
    switch (action.type) {
      case "get_market_overview": {
        const endpoint = paidApiCatalog.getMarketOverview.buildPath();
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getMarketOverview.actionType,
          amountUsd: paidApiCatalog.getMarketOverview.priceUsd,
          description: paidApiCatalog.getMarketOverview.description,
          method: paidApiCatalog.getMarketOverview.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId: undefined,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getMarketOverview.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizeMarketOverview(response.data),
        };
      }
      case "get_token_profile": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getTokenProfile.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenProfile.actionType,
          amountUsd: paidApiCatalog.getTokenProfile.priceUsd,
          description: paidApiCatalog.getTokenProfile.description,
          method: paidApiCatalog.getTokenProfile.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getTokenProfile.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "get_token_erc20": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getTokenErc20.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenErc20.actionType,
          amountUsd: paidApiCatalog.getTokenErc20.priceUsd,
          description: paidApiCatalog.getTokenErc20.description,
          method: paidApiCatalog.getTokenErc20.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getTokenErc20.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "get_token_transfers": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getTokenTransfers.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenTransfers.actionType,
          amountUsd: paidApiCatalog.getTokenTransfers.priceUsd,
          description: paidApiCatalog.getTokenTransfers.description,
          method: paidApiCatalog.getTokenTransfers.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getTokenTransfers.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "get_token_holders": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getTokenHolders.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenHolders.actionType,
          amountUsd: paidApiCatalog.getTokenHolders.priceUsd,
          description: paidApiCatalog.getTokenHolders.description,
          method: paidApiCatalog.getTokenHolders.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getTokenHolders.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "get_token_history": {
        const tokenId = action.tokenId.toUpperCase();
        const period = action.period as HistoryPeriod;
        const endpoint = paidApiCatalog.getTokenHistory.buildPath(tokenId, period);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenHistory.actionType,
          amountUsd: paidApiCatalog.getTokenHistory.priceUsd,
          description: paidApiCatalog.getTokenHistory.description,
          method: paidApiCatalog.getTokenHistory.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period,
          endpoint,
          amountUsd: paidApiCatalog.getTokenHistory.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizeTokenHistory(response.data),
        };
      }
      case "get_wallet_portfolio": {
        if (!circleWalletAddress) {
          throw new Error("The current user does not have a Circle wallet address.");
        }

        const endpoint = paidApiCatalog.getWalletPortfolio.buildPath(circleWalletAddress);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getWalletPortfolio.actionType,
          amountUsd: paidApiCatalog.getWalletPortfolio.priceUsd,
          description: paidApiCatalog.getWalletPortfolio.description,
          method: paidApiCatalog.getWalletPortfolio.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId: undefined,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getWalletPortfolio.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizePortfolio(response.data),
        };
      }
      case "get_signal": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getSignal.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getSignal.actionType,
          amountUsd: paidApiCatalog.getSignal.priceUsd,
          description: paidApiCatalog.getSignal.description,
          method: paidApiCatalog.getSignal.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId,
          period: undefined,
          endpoint,
          amountUsd: paidApiCatalog.getSignal.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "compare_arc_token": {
        const arcTokenId = action.arcTokenId.toUpperCase();
        const externalCoin = action.externalCoin.toLowerCase();
        const endpoint = paidApiCatalog.getComparison.buildPath(arcTokenId, externalCoin);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getComparison.actionType,
          amountUsd: paidApiCatalog.getComparison.priceUsd,
          description: paidApiCatalog.getComparison.description,
          method: paidApiCatalog.getComparison.method,
          path: endpoint,
        });

        return {
          type: action.type,
          tokenId: arcTokenId,
          period: undefined,
          externalCoin,
          endpoint,
          amountUsd: paidApiCatalog.getComparison.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: response.data,
        };
      }
      case "propose_buy_token":
      case "propose_sell_token": {
        // Trade proposals are handled upstream — they should never reach executeAction.
        throw new Error(`Trade proposal action "${action.type}" must be handled before executeAction.`);
      }
      default: {
        const exhaustiveCheck: never = action;
        throw new Error(`Unsupported premium action: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private summarizeMarketOverview(payload: Record<string, unknown>) {
    const sentiment = this.asRecord(payload.sentiment);
    const leaders = this.asRecord(payload.leaders);
    const relativeStrength = this.asRecord(payload.relativeStrength);

    return {
      updatedAt: payload.updatedAt,
      totals: payload.totals,
      sentiment: {
        label: sentiment.label,
        score: sentiment.score,
        breadth: sentiment.breadth,
      },
      relativeStrength: {
        benchmark: relativeStrength.benchmark,
      },
      leaders: {
        topGainers: this.limitArray(leaders.topGainers, 3),
        topLosers: this.limitArray(leaders.topLosers, 3),
        topByVolume: this.limitArray(leaders.topByVolume, 3),
      },
    };
  }

  // Token detail calls are now split; keep raw payloads as summaries.

  private summarizeTokenHistory(payload: Record<string, unknown>) {
    const points = this.asArray(payload.points);
    const firstPoint = this.asRecord(points[0]);
    const lastPoint = this.asRecord(points.at(-1));
    const firstPrice = this.toNumber(firstPoint.price);
    const lastPrice = this.toNumber(lastPoint.price);
    const priceChangePct =
      firstPrice !== null && lastPrice !== null && firstPrice !== 0
        ? Number((((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2))
        : null;

    return {
      id: payload.id,
      period: payload.period,
      summary: payload.summary,
      pointsSample: {
        first: firstPoint,
        last: lastPoint,
        priceChangePct,
      },
    };
  }

  private summarizePortfolio(payload: Record<string, unknown>) {
    return {
      wallet: payload.wallet,
      network: payload.network,
      updatedAt: payload.updatedAt,
      summary: payload.summary,
      allocation: this.limitArray(payload.allocation, 5),
      positions: this.limitArray(payload.positions, 5),
    };
  }

  private pickObjectFields(record: Record<string, unknown>, keys: string[]) {
    return Object.fromEntries(keys.map((key) => [key, record[key] ?? null]));
  }

  private limitArray(value: unknown, size: number) {
    return Array.isArray(value) ? value.slice(0, size) : [];
  }

  private asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }

  private toNumber(value: unknown) {
    return typeof value === "number" ? value : null;
  }
}
