import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { ChatsService } from "./chats.service.js";
import { type CreateChatDto } from "./dto/create-chat.dto.js";
import { type CreateChatMessageDto } from "./dto/create-chat-message.dto.js";
import { type UpdateChatDto } from "./dto/update-chat.dto.js";

@Controller("chats")
@UseGuards(SessionAuthGuard)
export class ChatsController {
  constructor(@Inject(ChatsService) private readonly chatsService: ChatsService) {}

  @Get()
  listChats(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.listChats(user.id);
  }

  @Post()
  createChat(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChatDto) {
    return this.chatsService.createChat(user.id, dto);
  }

  @Get(":chatId")
  getChat(@CurrentUser() user: AuthenticatedUser, @Param("chatId") chatId: string) {
    return this.chatsService.getChat(user.id, chatId);
  }

  @Patch(":chatId")
  updateChat(
    @CurrentUser() user: AuthenticatedUser,
    @Param("chatId") chatId: string,
    @Body() dto: UpdateChatDto,
  ) {
    return this.chatsService.updateChat(user.id, chatId, dto);
  }

  @Delete(":chatId")
  deleteChat(@CurrentUser() user: AuthenticatedUser, @Param("chatId") chatId: string) {
    return this.chatsService.deleteChat(user.id, chatId);
  }

  @Get(":chatId/messages")
  getChatMessages(@CurrentUser() user: AuthenticatedUser, @Param("chatId") chatId: string) {
    return this.chatsService.getChatMessages(user.id, chatId);
  }

  @Post(":chatId/messages")
  createChatMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("chatId") chatId: string,
    @Body() dto: CreateChatMessageDto,
  ) {
    return this.chatsService.createChatMessage(user.id, chatId, dto);
  }

  @Post(":chatId/messages/stream-init")
  initStreamChatMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("chatId") chatId: string,
    @Body() dto: CreateChatMessageDto,
  ) {
    return this.chatsService.initStreamChatMessage(user.id, chatId, dto);
  }

  @Sse(":chatId/messages/stream")
  streamChatMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("chatId") chatId: string,
    @Query("token") token: string,
  ) {
    return this.chatsService.streamChatMessage(user.id, chatId, token);
  }
}
