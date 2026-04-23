import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { TradeModule } from "../trade/trade.module.js";
import { ChatAgentService } from "./chat-agent.service.js";
import { ChatsController } from "./chats.controller.js";
import { ChatsService } from "./chats.service.js";
import { GeminiService } from "./gemini.service.js";

@Module({
  imports: [AuthModule, PaymentsModule, TradeModule],
  controllers: [ChatsController],
  providers: [ChatsService, GeminiService, ChatAgentService],
})
export class ChatsModule {}
