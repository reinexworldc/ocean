import { Controller, Get, Param } from "@nestjs/common";
import { PortfolioService } from "./portfolio.service.js";

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * Returns the wallet portfolio with balances and P&L.
   */
  @Get(":wallet")
  getWalletPortfolio(@Param("wallet") walletAddress: string) {
    return this.portfolioService.getWalletPortfolio(walletAddress);
  }
}
