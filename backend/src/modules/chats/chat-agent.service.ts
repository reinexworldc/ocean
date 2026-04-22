import { Inject, Injectable } from "@nestjs/common";
import { type GeminiChatMessage, GeminiService, type PlannedPremiumAction } from "./gemini.service.js";
import { PaymentsService } from "../payments/payments.service.js";
import { type HistoryPeriod, paidApiCatalog } from "../payments/paid-api-catalog.js";

type ExecutedAgentAction = {
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

    const executedActions: ExecutedAgentAction[] = [];

    for (const action of plannedActions) {
      executedActions.push(await this.executeAction(params.userId, params.chatId, params.circleWalletAddress, action));
    }

    return {
      content: await this.geminiService.generateReplyWithToolResults({
        messages: params.history,
        toolResults: executedActions.map(({ summary, ...metadata }) => ({
          ...metadata,
          result: summary,
        })),
      }),
      executedActions,
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
