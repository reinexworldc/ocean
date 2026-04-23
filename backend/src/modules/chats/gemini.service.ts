import { GoogleGenAI } from "@google/genai";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { HISTORY_PERIODS, type HistoryPeriod } from "../payments/paid-api-catalog.js";
import { buildAnomalyDetectionPrompt } from "./prompts/anomaly-detection.prompt.js";
import { buildPlanningPrompt } from "./prompts/planning.prompt.js";
import { buildRefinementPrompt, type ExecutedActionSummary } from "./prompts/refinement.prompt.js";
import { buildReplyPrompt } from "./prompts/reply.prompt.js";
import { buildToolReplyPrompt } from "./prompts/tool-reply.prompt.js";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

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
    };

@Injectable()
export class GeminiService {
  private client: GoogleGenAI | null = null;

  async generateReply(messages: GeminiChatMessage[]) {
    const text = await this.generateText(buildReplyPrompt(messages));

    if (!text) {
      throw new ServiceUnavailableException("Gemini returned an empty response.");
    }

    return text;
  }

  async *generateReplyStream(messages: GeminiChatMessage[]): AsyncGenerator<string> {
    yield* this.generateTextStream(buildReplyPrompt(messages));
  }

  async generateReplyWithToolResults(params: {
    messages: GeminiChatMessage[];
    toolResults: Array<Record<string, unknown>>;
  }) {
    const text = await this.generateText(buildToolReplyPrompt(params.messages, params.toolResults));

    if (!text) {
      throw new ServiceUnavailableException("Gemini returned an empty orchestrated response.");
    }

    return text;
  }

  async *generateReplyWithToolResultsStream(params: {
    messages: GeminiChatMessage[];
    toolResults: Array<Record<string, unknown>>;
  }): AsyncGenerator<string> {
    yield* this.generateTextStream(buildToolReplyPrompt(params.messages, params.toolResults));
  }

  async planPremiumActions(params: {
    latestUserMessage: string;
    circleWalletAddress: string | null;
  }): Promise<PlannedPremiumAction[]> {
    const rawPlan = await this.generateText(
      buildPlanningPrompt(params.latestUserMessage, params.circleWalletAddress),
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
  async planRefinedActions(params: {
    latestUserMessage: string;
    alreadyExecuted: ExecutedActionSummary[];
    toolResults: Array<Record<string, unknown>>;
  }): Promise<PlannedPremiumAction[]> {
    const rawPlan = await this.generateText(buildRefinementPrompt(params));
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
  async planAnomalyInvestigation(params: {
    latestUserMessage: string;
    alreadyExecuted: ExecutedActionSummary[];
    toolResults: Array<Record<string, unknown>>;
  }): Promise<{ actions: PlannedPremiumAction[]; anomalies: string[] }> {
    const rawPlan = await this.generateText(buildAnomalyDetectionPrompt(params));
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

  private async generateText(prompt: string) {
    const response = await this.getClient().models.generateContent({
      model: this.getModel(),
      contents: prompt,
    });

    return response.text?.trim();
  }

  private async *generateTextStream(prompt: string): AsyncGenerator<string> {
    const stream = await this.getClient().models.generateContentStream({
      model: this.getModel(),
      contents: prompt,
    });

    for await (const chunk of stream) {
      const text = chunk.text;

      if (text) {
        yield text;
      }
    }
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
