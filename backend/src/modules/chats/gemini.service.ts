import { GoogleGenAI } from "@google/genai";
import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { HISTORY_PERIODS, type HistoryPeriod } from "../payments/paid-api-catalog.js";
import { buildAnomalyDetectionPrompt } from "./prompts/anomaly-detection.prompt.js";
import { buildPlanningPrompt } from "./prompts/planning.prompt.js";
import { buildRefinementPrompt, type ExecutedActionSummary } from "./prompts/refinement.prompt.js";
import { buildReplyPrompt } from "./prompts/reply.prompt.js";
import { buildToolReplyPrompt } from "./prompts/tool-reply.prompt.js";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

/**
 * Ordered list of fallback models tried when the primary model returns 503 UNAVAILABLE.
 * The primary model (from env or default) is always tried first and is not duplicated here.
 */
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];

type ModelSwapCallback = (fromModel: string, toModel: string) => void;

export type GeminiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type PlannedPremiumAction =
  | {
      type: "get_market_overview";
    }
  | {
      type: "get_token_details";
      tokenId: string;
    }
  | {
      type: "get_token_history";
      tokenId: string;
      period: HistoryPeriod;
    }
  | {
      type: "get_wallet_portfolio";
    }
  | {
      type: "propose_buy_token";
      tokenId: string;
      tokenAmount: number;
    }
  | {
      type: "propose_sell_token";
      tokenId: string;
      tokenAmount: number;
    };

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI | null = null;

  async generateReply(messages: GeminiChatMessage[], onModelSwap?: ModelSwapCallback) {
    const text = await this.generateText(buildReplyPrompt(messages), onModelSwap);

    if (!text) {
      throw new ServiceUnavailableException("Gemini returned an empty response.");
    }

    return text;
  }

  async *generateReplyStream(
    messages: GeminiChatMessage[],
    onModelSwap?: ModelSwapCallback,
  ): AsyncGenerator<string> {
    yield* this.generateTextStream(buildReplyPrompt(messages), onModelSwap);
  }

  async generateReplyWithToolResults(
    params: {
      messages: GeminiChatMessage[];
      toolResults: Array<Record<string, unknown>>;
    },
    onModelSwap?: ModelSwapCallback,
  ) {
    const text = await this.generateText(
      buildToolReplyPrompt(params.messages, params.toolResults),
      onModelSwap,
    );

    if (!text) {
      throw new ServiceUnavailableException("Gemini returned an empty orchestrated response.");
    }

    return text;
  }

  async *generateReplyWithToolResultsStream(
    params: {
      messages: GeminiChatMessage[];
      toolResults: Array<Record<string, unknown>>;
    },
    onModelSwap?: ModelSwapCallback,
  ): AsyncGenerator<string> {
    yield* this.generateTextStream(
      buildToolReplyPrompt(params.messages, params.toolResults),
      onModelSwap,
    );
  }

  async planPremiumActions(
    params: {
      latestUserMessage: string;
      circleWalletAddress: string | null;
    },
    onModelSwap?: ModelSwapCallback,
  ): Promise<PlannedPremiumAction[]> {
    const rawPlan = await this.generateText(
      buildPlanningPrompt(params.latestUserMessage, params.circleWalletAddress),
      onModelSwap,
    );
    const parsedPlan = this.parseJsonObject(rawPlan);
    const actions = Array.isArray(parsedPlan.actions) ? parsedPlan.actions : [];

    return this.normalizePlannedActions(actions);
  }

  /**
   * Second-pass planner: called after the initial tool results are available.
   * Discovers additional token-specific actions the user implicitly requested
   * (e.g. "top tokens") that couldn't be resolved without the market data.
   */
  async planRefinedActions(
    params: {
      latestUserMessage: string;
      alreadyExecuted: ExecutedActionSummary[];
      toolResults: Array<Record<string, unknown>>;
    },
    onModelSwap?: ModelSwapCallback,
  ): Promise<PlannedPremiumAction[]> {
    const rawPlan = await this.generateText(buildRefinementPrompt(params), onModelSwap);
    const parsedPlan = this.parseJsonObject(rawPlan);
    const actions = Array.isArray(parsedPlan.actions) ? parsedPlan.actions : [];

    // Only allow token-specific actions in the refinement step.
    return this.normalizePlannedActions(actions).filter(
      (a) => a.type === "get_token_details" || a.type === "get_token_history",
    );
  }

  /**
   * Third-pass anomaly planner: called after all tool results are collected.
   * Detects data anomalies (sharp price moves, extreme sentiment) and returns
   * additional diagnostic actions — each one triggers its own nano-payment.
   *
   * Returns both the planned actions and human-readable anomaly descriptions
   * so the UI can surface what the agent spotted.
   */
  async planAnomalyInvestigation(
    params: {
      latestUserMessage: string;
      alreadyExecuted: ExecutedActionSummary[];
      toolResults: Array<Record<string, unknown>>;
    },
    onModelSwap?: ModelSwapCallback,
  ): Promise<{ actions: PlannedPremiumAction[]; anomalies: string[] }> {
    const rawPlan = await this.generateText(buildAnomalyDetectionPrompt(params), onModelSwap);
    const parsedPlan = this.parseJsonObject(rawPlan);

    const rawActions = Array.isArray(parsedPlan.actions) ? parsedPlan.actions : [];
    const anomalies = Array.isArray(parsedPlan.anomalies)
      ? (parsedPlan.anomalies as unknown[]).filter((a): a is string => typeof a === "string")
      : [];

    // Only allow token-specific actions in anomaly investigation.
    const actions = this.normalizePlannedActions(rawActions)
      .filter((a) => a.type === "get_token_details" || a.type === "get_token_history")
      .slice(0, 3);

    return { actions, anomalies };
  }

  private getClient() {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.GOOGLE_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException("GOOGLE_API_KEY is not configured.");
    }

    this.client = new GoogleGenAI({
      apiKey,
    });

    return this.client;
  }

  private getModel() {
    return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  }

  private isUnavailableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    return /503|UNAVAILABLE|high.demand/i.test(msg);
  }

  private buildModelChain(): string[] {
    const primary = this.getModel();
    return [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];
  }

  private async generateText(
    prompt: string,
    onModelSwap?: ModelSwapCallback,
  ): Promise<string | undefined> {
    const models = this.buildModelChain();
    const primaryModel = models[0] ?? this.getModel();
    let lastError: unknown;

    for (const model of models) {
      try {
        const response = await this.getClient().models.generateContent({
          model,
          contents: prompt,
        });

        if (model !== primaryModel) {
          this.logger.warn(`Model swap: ${primaryModel} → ${model} (unavailable)`);
          onModelSwap?.(primaryModel, model);
        }

        return response.text?.trim();
      } catch (err) {
        if (this.isUnavailableError(err)) {
          this.logger.warn(
            `Model ${model} unavailable, trying next fallback. Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          lastError = err;
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  private async *generateTextStream(
    prompt: string,
    onModelSwap?: ModelSwapCallback,
  ): AsyncGenerator<string> {
    const models = this.buildModelChain();
    const primaryModel = models[0] ?? this.getModel();
    let lastError: unknown;

    for (const model of models) {
      let tokensYielded = 0;

      try {
        const stream = await this.getClient().models.generateContentStream({
          model,
          contents: prompt,
        });

        // Notify BEFORE yielding any tokens so callers can drain swap events first.
        if (model !== primaryModel) {
          this.logger.warn(`Model swap (stream): ${primaryModel} → ${model} (unavailable)`);
          onModelSwap?.(primaryModel, model);
        }

        for await (const chunk of stream) {
          if (chunk.text) {
            tokensYielded++;
            yield chunk.text;
          }
        }

        return;
      } catch (err) {
        // Only retry on unavailable errors and only if no tokens have been streamed yet,
        // otherwise the response would be inconsistent.
        if (this.isUnavailableError(err) && tokensYielded === 0) {
          this.logger.warn(
            `Model ${model} unavailable (stream), trying next fallback. Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          lastError = err;
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  private parseJsonObject(value: string | undefined) {
    if (!value) {
      return {};
    }

    const trimmed = value.trim();

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
      const candidate = fencedMatch?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);

      try {
        return JSON.parse(candidate) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }

  private normalizePlannedActions(actions: unknown[]): PlannedPremiumAction[] {
    const dedupedActions = new Map<string, PlannedPremiumAction>();

    for (const rawAction of actions) {
      if (!rawAction || typeof rawAction !== "object" || Array.isArray(rawAction)) {
        continue;
      }

      const action = rawAction as Record<string, unknown>;
      const type = typeof action.type === "string" ? action.type : null;

      if (type === "get_market_overview") {
        dedupedActions.set(type, {
          type,
        });
        continue;
      }

      if (type === "get_wallet_portfolio") {
        dedupedActions.set(type, {
          type,
        });
        continue;
      }

      if (type === "get_token_details") {
        const tokenId = this.normalizeTokenId(action.tokenId);

        if (!tokenId) {
          continue;
        }

        dedupedActions.set(`${type}:${tokenId}`, {
          type,
          tokenId,
        });
        continue;
      }

      if (type === "get_token_history") {
        const tokenId = this.normalizeTokenId(action.tokenId);
        const period = this.normalizeHistoryPeriod(action.period);

        if (!tokenId || !period) {
          continue;
        }

        dedupedActions.set(`${type}:${tokenId}:${period}`, {
          type,
          tokenId,
          period,
        });
        continue;
      }

      if (type === "propose_buy_token" || type === "propose_sell_token") {
        const tokenId = this.normalizeTokenId(action.tokenId);
        const tokenAmount = typeof action.tokenAmount === "number" && action.tokenAmount > 0
          ? action.tokenAmount
          : null;

        if (!tokenId || !tokenAmount) {
          continue;
        }

        dedupedActions.set(`${type}:${tokenId}`, {
          type,
          tokenId,
          tokenAmount,
        });
      }
    }

    return [...dedupedActions.values()].slice(0, 8);
  }

  private normalizeTokenId(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeHistoryPeriod(value: unknown): HistoryPeriod | null {
    return typeof value === "string" && HISTORY_PERIODS.includes(value as HistoryPeriod)
      ? (value as HistoryPeriod)
      : null;
  }

}
