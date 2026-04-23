import { Inject, Injectable } from "@nestjs/common";
import { type GeminiChatMessage, GeminiService, type PlannedPremiumAction } from "./gemini.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { TradeService } from "../trade/trade.service.js";
import { type HistoryPeriod, paidApiCatalog } from "../payments/paid-api-catalog.js";
import { type AgentStreamEvent, type TradeProposal } from "./agent-stream.types.js";

const ACTION_LABELS: Record<string, string> = {
  get_market_overview: "Market Overview",
  get_token_details: "Token Details",
  get_token_history: "Token History",
  get_wallet_portfolio: "Wallet Portfolio",
};

export type ExecutedAgentAction = {
  type: PlannedPremiumAction["type"];
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
      const content = await this.geminiService.generateReply(params.history);
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
  ): AsyncGenerator<AgentStreamEvent> {
    yield { phase: "planning", text: "Analyzing your request..." };

    const swapQueue: Array<{ from: string; to: string }> = [];
    const onModelSwap = (from: string, to: string) => swapQueue.push({ from, to });

    const plannedActions = await this.geminiService.planPremiumActions(
      {
        latestUserMessage: params.latestUserMessage,
        circleWalletAddress: params.circleWalletAddress,
      },
      onModelSwap,
    );
    yield* this.drainModelSwapEvents(swapQueue);

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

      const tokenStream = this.geminiService.generateReplyStream(params.history, onModelSwap);
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
    yield { phase: "planning", text: "Refining analysis..." };
    const refinedActions = await this.geminiService.planRefinedActions(
      {
        latestUserMessage: params.latestUserMessage,
        alreadyExecuted: this.toExecutedSummaries(plannedActions),
        toolResults: this.toToolResults(out.executedActions),
      },
      onModelSwap,
    );
    yield* this.drainModelSwapEvents(swapQueue);

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
    yield { phase: "planning", text: "Scanning for anomalies..." };
    const allExecutedSoFar = [...plannedActions, ...refinedActions];
    const { actions: anomalyActions, anomalies } =
      await this.geminiService.planAnomalyInvestigation(
        {
          latestUserMessage: params.latestUserMessage,
          alreadyExecuted: this.toExecutedSummaries(allExecutedSoFar),
          toolResults: this.toToolResults(out.executedActions),
        },
        onModelSwap,
      );
    yield* this.drainModelSwapEvents(swapQueue);

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
    // Announce all tool calls immediately so the UI shows the full list at once.
    for (const action of actions) {
      const { label, tokenId, tokenSuffix } = this.actionMeta(action);
      yield {
        phase: "tool_executing",
        text: `Fetching${tokenSuffix} ${label.toLowerCase()}`,
        tool: action.type,
        ...(tokenId ? { tokenId } : {}),
      };
    }

    // Execute all in parallel; yield each result as it arrives.
    // Every action — whether it succeeds, is skipped (404), or fails — must
    // decrement totalExpected and call the notifier so the while-loop below
    // never hangs waiting for a notification that will never arrive.
    let totalExpected = actions.length;
    const settled: Array<AgentStreamEvent & { phase: "tool_result" }> = [];
    const notifiers: Array<() => void> = [];
    let firstError: unknown = null;

    const allSettled = Promise.allSettled(
      actions.map(async (action) => {
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
        settled.push({
          phase: "tool_result",
          text: `${label}${tokenSuffix}`,
          tool: action.type,
          cost: result.amountUsd,
          ...(tokenId ? { tokenId } : {}),
        });
        notifiers.shift()?.();
      }),
    );

    let yielded = 0;
    while (yielded < totalExpected) {
      if (yielded < settled.length) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        yield settled[yielded++]!;
      } else {
        await new Promise<void>((resolve) => notifiers.push(resolve));
      }
    }

    await allSettled;

    if (firstError !== null) {
      throw firstError;
    }
  }

  /** Execute a batch of actions in parallel and return all results. */
  private runActionsParallel(
    userId: string,
    chatId: string,
    circleWalletAddress: string | null,
    actions: PlannedPremiumAction[],
  ): Promise<ExecutedAgentAction[]> {
    return Promise.all(
      actions.map((action) => this.executeAction(userId, chatId, circleWalletAddress, action)),
    );
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
    const tokenId = "tokenId" in action ? action.tokenId.toUpperCase() : undefined;
    const tokenSuffix = tokenId ? ` ${tokenId}` : "";
    return { label, tokenId, tokenSuffix };
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
          endpoint,
          amountUsd: paidApiCatalog.getMarketOverview.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizeMarketOverview(response.data),
        };
      }
      case "get_token_details": {
        const tokenId = action.tokenId.toUpperCase();
        const endpoint = paidApiCatalog.getTokenDetails.buildPath(tokenId);
        const response = await this.paymentsService.callPaidJsonEndpoint<Record<string, unknown>>({
          userId,
          chatId,
          actionType: paidApiCatalog.getTokenDetails.actionType,
          amountUsd: paidApiCatalog.getTokenDetails.priceUsd,
          description: paidApiCatalog.getTokenDetails.description,
          method: paidApiCatalog.getTokenDetails.method,
          path: endpoint,
        });

        return {
          type: action.type,
          endpoint,
          amountUsd: paidApiCatalog.getTokenDetails.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizeTokenDetails(response.data),
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
          endpoint,
          amountUsd: paidApiCatalog.getWalletPortfolio.priceUsd,
          transactionId: response.transactionId,
          settlementTransaction: response.settlementTransaction,
          paymentNetwork: response.paymentNetwork,
          summary: this.summarizePortfolio(response.data),
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

  private summarizeTokenDetails(payload: Record<string, unknown>) {
    return {
      id: payload.id,
      symbol: payload.symbol,
      name: payload.name,
      network: payload.network,
      address: payload.address,
      current: payload.current,
      sentiment: payload.sentiment,
      analysis: payload.analysis,
      holders: this.pickObjectFields(this.asRecord(payload.holders), ["total"]),
      transfers: this.pickObjectFields(this.asRecord(payload.transfers), ["total"]),
    };
  }

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
