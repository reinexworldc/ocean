import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { MessageRole, MessageStatus } from "../../generated/prisma/enums.js";
import { type ChatModel as Chat } from "../../generated/prisma/models/Chat.js";
import { type MessageModel as Message } from "../../generated/prisma/models/Message.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { type CreateChatDto } from "./dto/create-chat.dto.js";
import { type CreateChatMessageDto } from "./dto/create-chat-message.dto.js";
import { type UpdateChatDto } from "./dto/update-chat.dto.js";
import { ChatAgentService, type ExecutedAgentAction } from "./chat-agent.service.js";
import { type GeminiChatMessage } from "./gemini.service.js";

type StreamSession = {
  userId: string;
  chatId: string;
  content: string;
  circleWalletAddress: string | null;
  expiresAt: number;
};

const DEFAULT_CHAT_TITLE = "New chat";
const FAILED_ASSISTANT_MESSAGE = "I couldn't generate a response right now. Please try again.";
const MAX_CHAT_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 8_000;

type ChatSummaryRecord = Chat & {
  messages: Array<Pick<Message, "id" | "content" | "createdAt">>;
  _count: {
    messages: number;
  };
};

const STREAM_SESSION_TTL_MS = 5 * 60 * 1_000;

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);
  private readonly streamSessions = new Map<string, StreamSession>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatAgentService) private readonly chatAgentService: ChatAgentService,
  ) {}

  async listChats(userId: string) {
    const chats = await this.prisma.chat.findMany({
      where: {
        userId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: this.chatSummaryInclude(),
    });

    return chats.map((chat) => this.toChatSummary(chat));
  }

  async createChat(userId: string, dto: CreateChatDto) {
    const createdChat = await this.prisma.chat.create({
      data: {
        userId,
        title: this.normalizeChatTitle(dto.title, {
          allowEmpty: true,
          fallback: DEFAULT_CHAT_TITLE,
        }),
      },
    });

    return this.getChat(userId, createdChat.id);
  }

  async getChat(userId: string, chatId: string) {
    const chat = await this.findOwnedChatWithSummary(userId, chatId);
    return this.toChatSummary(chat);
  }

  async updateChat(userId: string, chatId: string, dto: UpdateChatDto) {
    await this.ensureOwnedChat(userId, chatId);

    const updatedChat = await this.prisma.chat.update({
      where: {
        id: chatId,
      },
      data: {
        title: this.normalizeChatTitle(dto.title),
      },
      include: this.chatSummaryInclude(),
    });

    return this.toChatSummary(updatedChat);
  }

  async deleteChat(userId: string, chatId: string) {
    await this.ensureOwnedChat(userId, chatId);

    await this.prisma.chat.delete({
      where: {
        id: chatId,
      },
    });

    return {
      success: true,
    };
  }

  async getChatMessages(userId: string, chatId: string) {
    const [chat, messages] = await Promise.all([
      this.findOwnedChatWithSummary(userId, chatId),
      this.prisma.message.findMany({
        where: {
          chatId,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    ]);

    return {
      chat: this.toChatSummary(chat),
      messages: messages.map((message) => this.toMessageDto(message)),
    };
  }

  async createChatMessage(userId: string, chatId: string, dto: CreateChatMessageDto) {
    const chat = await this.ensureOwnedChat(userId, chatId);
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        circleWalletAddress: true,
      },
    });
    const content = this.normalizeMessageContent(dto.content);
    const shouldRetitle = await this.shouldRefreshTitle(chat);
    const nextTitle = shouldRetitle ? this.deriveTitleFromMessage(content) : null;

    const userMessage = await this.prisma.message.create({
      data: {
        chatId,
        role: MessageRole.USER,
        content,
        status: MessageStatus.COMPLETED,
      },
    });

    await this.touchChat(chatId, nextTitle);

    const history = await this.prisma.message.findMany({
      where: {
        chatId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    let generationFailed = false;
    let assistantMessage: Message;
    let agentActions: Array<Record<string, unknown>> = [];

    try {
      const agentResult = await this.chatAgentService.generateReply({
        userId,
        chatId,
        history: this.toGeminiHistory(history),
        latestUserMessage: content,
        circleWalletAddress: user?.circleWalletAddress ?? null,
      });
      const assistantContent = agentResult.content;
      agentActions = agentResult.executedActions;

      assistantMessage = await this.prisma.message.create({
        data: {
          chatId,
          role: MessageRole.ASSISTANT,
          content: assistantContent,
          status: MessageStatus.COMPLETED,
        },
      });
    } catch (error) {
      generationFailed = true;
      this.logger.error(
        `Gemini failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );

      assistantMessage = await this.prisma.message.create({
        data: {
          chatId,
          role: MessageRole.ASSISTANT,
          content: FAILED_ASSISTANT_MESSAGE,
          status: MessageStatus.FAILED,
        },
      });
    }

    await this.touchChat(chatId);

    const updatedChat = await this.findOwnedChatWithSummary(userId, chatId);

    return {
      chat: this.toChatSummary(updatedChat),
      userMessage: this.toMessageDto(userMessage),
      assistantMessage: this.toMessageDto(assistantMessage),
      generationFailed,
      agentActions,
    };
  }

  async initStreamChatMessage(userId: string, chatId: string, dto: CreateChatMessageDto) {
    const chat = await this.ensureOwnedChat(userId, chatId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { circleWalletAddress: true },
    });
    const content = this.normalizeMessageContent(dto.content);
    const shouldRetitle = await this.shouldRefreshTitle(chat);
    const nextTitle = shouldRetitle ? this.deriveTitleFromMessage(content) : null;

    const userMessage = await this.prisma.message.create({
      data: {
        chatId,
        role: MessageRole.USER,
        content,
        status: MessageStatus.COMPLETED,
      },
    });

    await this.touchChat(chatId, nextTitle);

    const streamToken = randomUUID();

    this.streamSessions.set(streamToken, {
      userId,
      chatId,
      content,
      circleWalletAddress: user?.circleWalletAddress ?? null,
      expiresAt: Date.now() + STREAM_SESSION_TTL_MS,
    });

    return {
      userMessage: this.toMessageDto(userMessage),
      streamToken,
    };
  }

  streamChatMessage(userId: string, chatId: string, streamToken: string): Observable<{ data: unknown }> {
    const session = this.streamSessions.get(streamToken);

    if (!session || session.userId !== userId || session.chatId !== chatId) {
      throw new NotFoundException("Stream session not found.");
    }

    if (Date.now() > session.expiresAt) {
      this.streamSessions.delete(streamToken);
      throw new NotFoundException("Stream session expired.");
    }

    this.streamSessions.delete(streamToken);

    const { content, circleWalletAddress } = session;

    return new Observable<{ data: unknown }>((subscriber) => {
      void (async () => {
        let fullContent = "";
          const out = { executedActions: [] as ExecutedAgentAction[] };

        try {
          const history = await this.prisma.message.findMany({
            where: { chatId },
            orderBy: { createdAt: "asc" },
          });

          const agentStream = this.chatAgentService.generateReplyStream(
            {
              userId,
              chatId,
              history: this.toGeminiHistory(history),
              latestUserMessage: content,
              circleWalletAddress,
            },
            out,
          );

          for await (const event of agentStream) {
            if (event.phase === "token") {
              fullContent += event.text;
            }

            subscriber.next({ data: event });
          }

          const assistantMessage = await this.prisma.message.create({
            data: {
              chatId,
              role: MessageRole.ASSISTANT,
              content: fullContent || FAILED_ASSISTANT_MESSAGE,
              status: fullContent ? MessageStatus.COMPLETED : MessageStatus.FAILED,
            },
          });

          await this.touchChat(chatId);

          const updatedChat = await this.findOwnedChatWithSummary(userId, chatId);

          subscriber.next({
            data: {
              phase: "final",
              messageId: assistantMessage.id,
              content: assistantMessage.content,
              agentActions: out.executedActions,
              chat: this.toChatSummary(updatedChat),
            },
          });

          subscriber.complete();
        } catch (error) {
          this.logger.error(
            `Stream failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
          );

          subscriber.next({
            data: {
              phase: "error",
              text: this.toUserFacingErrorMessage(error),
            },
          });

          try {
            await this.prisma.message.create({
              data: {
                chatId,
                role: MessageRole.ASSISTANT,
                content: FAILED_ASSISTANT_MESSAGE,
                status: MessageStatus.FAILED,
              },
            });
          } catch {
            // Ignore cleanup errors
          }

          subscriber.complete();
        }
      })();
    });
  }

  private async ensureOwnedChat(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: {
        id: chatId,
      },
    });

    if (!chat || chat.userId !== userId) {
      throw new NotFoundException("Chat was not found.");
    }

    return chat;
  }

  private async findOwnedChatWithSummary(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({
      where: {
        id: chatId,
      },
      include: this.chatSummaryInclude(),
    });

    if (!chat || chat.userId !== userId) {
      throw new NotFoundException("Chat was not found.");
    }

    return chat;
  }

  private chatSummaryInclude() {
    return {
      messages: {
        orderBy: {
          createdAt: "desc" as const,
        },
        take: 1,
        select: {
          id: true,
          content: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    };
  }

  private normalizeChatTitle(
    value: string | undefined,
    options?: { allowEmpty?: boolean; fallback?: string },
  ) {
    if (value === undefined) {
      if (options?.allowEmpty) {
        return options.fallback ?? DEFAULT_CHAT_TITLE;
      }

      throw new BadRequestException("title is required.");
    }

    if (typeof value !== "string") {
      throw new BadRequestException("title must be a string.");
    }

    const normalized = value.trim().replace(/\s+/gu, " ");

    if (normalized.length === 0) {
      if (options?.allowEmpty) {
        return options.fallback ?? DEFAULT_CHAT_TITLE;
      }

      throw new BadRequestException("title must not be empty.");
    }

    if (normalized.length > MAX_CHAT_TITLE_LENGTH) {
      throw new BadRequestException(
        `title must be at most ${MAX_CHAT_TITLE_LENGTH} characters.`,
      );
    }

    return normalized;
  }

  private normalizeMessageContent(value: string) {
    if (typeof value !== "string") {
      throw new BadRequestException("content must be a string.");
    }

    const normalized = value.trim().replace(/\s+/gu, " ");

    if (normalized.length === 0) {
      throw new BadRequestException("content must not be empty.");
    }

    if (normalized.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `content must be at most ${MAX_MESSAGE_LENGTH} characters.`,
      );
    }

    return normalized;
  }

  private async shouldRefreshTitle(chat: Chat) {
    if (chat.title !== DEFAULT_CHAT_TITLE) {
      return false;
    }

    const messageCount = await this.prisma.message.count({
      where: {
        chatId: chat.id,
      },
    });

    return messageCount === 0;
  }

  private deriveTitleFromMessage(content: string) {
    const normalized = content.trim().replace(/\s+/gu, " ");
    const words = normalized.split(" ").slice(0, 6);
    const title = words.join(" ");

    if (title.length <= 60) {
      return title;
    }

    return `${title.slice(0, 57).trimEnd()}...`;
  }

  private async touchChat(chatId: string, title?: string | null) {
    await this.prisma.chat.update({
      where: {
        id: chatId,
      },
      data: {
        updatedAt: new Date(),
        ...(title ? { title } : {}),
      },
    });
  }

  private toGeminiHistory(messages: Message[]): GeminiChatMessage[] {
    return messages.flatMap((message) => {
      if (message.role === MessageRole.ASSISTANT && message.status !== MessageStatus.COMPLETED) {
        return [];
      }

      return [
        {
          role: this.toGeminiRole(message.role),
          content: message.content,
        },
      ];
    });
  }

  private toGeminiRole(role: Message["role"]): GeminiChatMessage["role"] {
    switch (role) {
      case MessageRole.USER:
        return "user";
      case MessageRole.SYSTEM:
        return "system";
      case MessageRole.ASSISTANT:
      default:
        return "assistant";
    }
  }

  private toChatSummary(chat: ChatSummaryRecord) {
    const lastMessage = chat.messages[0] ?? null;

    return {
      id: chat.id,
      title: chat.title,
      messageCount: chat._count.messages,
      lastMessagePreview: lastMessage ? this.truncatePreview(lastMessage.content) : null,
      lastMessageAt: lastMessage?.createdAt ?? null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    };
  }

  private truncatePreview(content: string) {
    const normalized = content.trim().replace(/\s+/gu, " ");

    if (normalized.length <= 140) {
      return normalized;
    }

    return `${normalized.slice(0, 137).trimEnd()}...`;
  }

  private toMessageDto(message: Message) {
    return {
      id: message.id,
      chatId: message.chatId,
      role: message.role.toLowerCase(),
      content: message.content,
      status: message.status.toLowerCase(),
      createdAt: message.createdAt,
    };
  }

  private toUserFacingErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);

    if (/insufficient|balance|funds|low balance/i.test(raw)) {
      return "Insufficient USDC balance to process your request. Please top up your wallet and try again.";
    }

    if (/settlement failed|payment.*fail|x402.*fail/i.test(raw)) {
      return "Payment processing failed. Please try again in a moment.";
    }

    if (/circle wallet|wallet.*not found|not.*provisioned/i.test(raw)) {
      return "Your payment wallet is not ready. Please try reconnecting your wallet.";
    }

    if (/timeout|timed out|ETIMEDOUT/i.test(raw)) {
      return "The request timed out. Please try again.";
    }

    return "Something went wrong while processing your request. Please try again.";
  }
}
