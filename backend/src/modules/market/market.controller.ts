import { Controller, Get } from "@nestjs/common";
import { MarketService } from "./market.service.js";

@Controller("market")
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /**
   * Returns the aggregate market overview for tracked tokens.
   */
  @Get()
  getMarketOverview() {
    return this.marketService.getMarketOverview();
  }
}
