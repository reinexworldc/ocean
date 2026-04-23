import { Inject, Injectable } from "@nestjs/common";
import { type GeminiChatMessage, GeminiService, type PlannedPremiumAction } from "./gemini.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { type HistoryPeriod, paidApiCatalog } from "../payments/paid-api-catalog.js";
import { type AgentStreamEvent } from "./agent-stream.types.js";

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
};

@Injectable()
export class ChatAgentService {
  constructor(
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
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
      };
    }

    const executedActions = await this.runActionsParallel(
      params.userId,
      params.chatId,
      params.circleWalletAddress,
      plannedActions,
    );

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

    return {
      content: await this.geminiService.generateReplyWithToolResults({
        messages: params.history,
        toolResults: this.toToolResults(executedActions),
      }),
      executedActions,
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
    out: { executedActions: ExecutedAgentAction[] },
  ): AsyncGenerator<AgentStreamEvent> {
    yield { phase: "planning", text: "Analyzing your request..." };

    const plannedActions = await this.geminiService.planPremiumActions({
      latestUserMessage: params.latestUserMessage,
      circleWalletAddress: params.circleWalletAddress,
    });

    if (plannedActions.length === 0) {
      yield { phase: "generating", text: "Generating response..." };

      for await (const token of this.geminiService.generateReplyStream(params.history)) {
        yield { phase: "token", text: token };
      }

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
    // now that market data is available.
    const refinedActions = await this.geminiService.planRefinedActions({
      latestUserMessage: params.latestUserMessage,
      alreadyExecuted: this.toExecutedSummaries(plannedActions),
      toolResults: this.toToolResults(out.executedActions),
    });

    if (refinedActions.length > 0) {
      yield* this.streamActions(
        params.userId,
        params.chatId,
        params.circleWalletAddress,
        refinedActions,
        out.executedActions,
      );
    }

    yield { phase: "generating", text: "Generating response..." };

    for await (const token of this.geminiService.generateReplyWithToolResultsStream({
      messages: params.history,
      toolResults: this.toToolResults(out.executedActions),
    })) {
      yield { phase: "token", text: token };
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
    // Settled count may be less than actions.length when some are skipped (e.g. 404).
    let totalExpected = actions.length;
    const settled: Array<AgentStreamEvent & { phase: "tool_result" }> = [];
    const notifiers: Array<() => void> = [];

    const allSettled = Promise.all(
      actions.map(async (action) => {
        const { label, tokenId, tokenSuffix } = this.actionMeta(action);
        let result: ExecutedAgentAction;
        try {
          result = await this.executeAction(userId, chatId, circleWalletAddress, action);
        } catch (err) {
          // Skip tokens that are not found in the data API rather than
          // crashing the entire stream.
          if (this.isNotFoundError(err)) {
            totalExpected--;
            notifiers.shift()?.();
            return;
          }
          throw err;
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
