import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { X402Module } from "./common/x402/x402.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { ChatsModule } from "./modules/chats/chats.module.js";
import { CircleWalletModule } from "./modules/circle-wallet/circle-wallet.module.js";
import { MarketModule } from "./modules/market/market.module.js";
import { PortfolioModule } from "./modules/portfolio/portfolio.module.js";
import { TokenModule } from "./modules/token/token.module.js";
import { TradeModule } from "./modules/trade/trade.module.js";
import { UsersModule } from "./modules/users/users.module.js";

@Module({
  imports: [
    PrismaModule,
    X402Module,
    HealthModule,
    AuthModule,
    ChatsModule,
    CircleWalletModule,
    UsersModule,
    TokenModule,
    MarketModule,
    PortfolioModule,
    TradeModule,
  ],
})
export class AppModule {}
