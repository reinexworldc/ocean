import { Controller, Get } from "@nestjs/common";
import { x402RouteConfigs } from "../../common/x402/x402-route-configs.js";
import { RequireX402 } from "../../common/x402/require-x402.decorator.js";
import { MarketService } from "./market.service.js";

@Controller("market")
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /**
   * Returns the aggregate market overview for tracked tokens.
   */
  @Get()
  @RequireX402(x402RouteConfigs.getMarketOverview)
  getMarketOverview() {
    return this.marketService.getMarketOverview();
  }
}
