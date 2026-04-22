import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { MessageRole, MessageStatus } from "../../generated/prisma/enums.js";
import { type ChatModel as Chat } from "../../generated/prisma/models/Chat.js";
import { type MessageModel as Message } from "../../generated/prisma/models/Message.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { type CreateChatDto } from "./dto/create-chat.dto.js";
import { type CreateChatMessageDto } from "./dto/create-chat-message.dto.js";
import { type UpdateChatDto } from "./dto/update-chat.dto.js";
import { GeminiService, type GeminiChatMessage } from "./gemini.service.js";

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

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly geminiService: GeminiService,
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

    try {
      const assistantContent = await this.geminiService.generateReply(
        this.toGeminiHistory(history),
      );

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
    };
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
}
