import { Body, Controller, Post } from "@nestjs/common";
import { x402RouteConfigs } from "../../common/x402/x402-route-configs.js";
import { RequireX402 } from "../../common/x402/require-x402.decorator.js";
import { type TradeRequestDto } from "./dto/trade-request.dto.js";
import { TradeService } from "./trade.service.js";

@Controller("trade")
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  /**
   * Blueprint for buying a token with USDC.
   */
  @Post("buy")
  @RequireX402(x402RouteConfigs.buyToken)
  buyToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.buyToken(payload);
  }

  /**
   * Blueprint for selling a token into USDC.
   */
  @Post("sell")
  @RequireX402(x402RouteConfigs.sellToken)
  sellToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.sellToken(payload);
  }
}
