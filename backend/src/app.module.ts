import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { MarketModule } from "./modules/market/market.module.js";
import { PortfolioModule } from "./modules/portfolio/portfolio.module.js";
import { TokenModule } from "./modules/token/token.module.js";
import { TradeModule } from "./modules/trade/trade.module.js";

@Module({
  imports: [HealthModule, TokenModule, MarketModule, PortfolioModule, TradeModule],
})
export class AppModule {}
