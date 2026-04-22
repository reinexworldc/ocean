import { GoogleGenAI } from "@google/genai";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export type GeminiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

@Injectable()
export class GeminiService {
  private client: GoogleGenAI | null = null;

  async generateReply(messages: GeminiChatMessage[]) {
    const response = await this.getClient().models.generateContent({
      model: this.getModel(),
      contents: this.buildPrompt(messages),
    });

    const text = response.text?.trim();

    if (!text) {
      throw new ServiceUnavailableException("Gemini returned an empty response.");
    }

    return text;
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

  private buildPrompt(messages: GeminiChatMessage[]) {
    const transcript = messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n\n");

    return [
      "You are Ocean, a concise and helpful AI chat assistant.",
      "Continue the conversation naturally and answer in plain text.",
      "Use the transcript below as the chat history.",
      transcript,
    ].join("\n\n");
  }
}
