import OpenAI from "openai";
import { Injectable, Logger } from "@nestjs/common";

/**
 * OpenRouter model to use for all Gemini fallbacks.
 */
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash-lite";

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private client: OpenAI | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  }

  async generateText(prompt: string, geminiModel: string): Promise<string | undefined> {
    const model = this.resolveModel(geminiModel);
    this.logger.log(`OpenRouter fallback: using model ${model}`);

    const response = await this.getClient().chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0]?.message?.content?.trim() ?? undefined;
  }

  async *generateTextStream(prompt: string, geminiModel: string): AsyncGenerator<string> {
    const model = this.resolveModel(geminiModel);
    this.logger.log(`OpenRouter fallback (stream): using model ${model}`);

    const stream = await this.getClient().chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        yield text;
      }
    }
  }

  private resolveModel(geminiModel: string): string {
    const envModel = process.env.OPENROUTER_MODEL?.trim();
    if (envModel) return envModel;
    return DEFAULT_OPENROUTER_MODEL;
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_URL ?? "https://ocean.app",
        "X-Title": "Ocean",
      },
    });

    return this.client;
  }
}
