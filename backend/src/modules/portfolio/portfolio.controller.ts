import { Controller, Get, Param } from "@nestjs/common";
import { x402RouteConfigs } from "../../common/x402/x402-route-configs.js";
import { RequireX402 } from "../../common/x402/require-x402.decorator.js";
import { PortfolioService } from "./portfolio.service.js";

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * Returns the wallet portfolio with balances and P&L.
   */
  @Get(":wallet")
  @RequireX402(x402RouteConfigs.getWalletPortfolio)
  getWalletPortfolio(@Param("wallet") walletAddress: string) {
    return this.portfolioService.getWalletPortfolio(walletAddress);
  }
}
