import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { TradeController } from "./trade.controller.js";
import { TradeService } from "./trade.service.js";

@Module({
  imports: [PrismaModule, PaymentsModule, AuthModule],
  controllers: [TradeController],
  providers: [TradeService],
  exports: [TradeService],
})
export class TradeModule {}
