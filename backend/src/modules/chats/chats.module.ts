import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ChatsController } from "./chats.controller.js";
import { ChatsService } from "./chats.service.js";
import { GeminiService } from "./gemini.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ChatsController],
  providers: [ChatsService, GeminiService],
})
export class ChatsModule {}
