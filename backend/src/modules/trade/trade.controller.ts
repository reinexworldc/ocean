import { Body, Controller, Post } from "@nestjs/common";
import { type TradeRequestDto } from "./dto/trade-request.dto.js";
import { TradeService } from "./trade.service.js";

@Controller("trade")
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  /**
   * Blueprint for buying a token with USDC.
   */
  @Post("buy")
  buyToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.buyToken(payload);
  }

  /**
   * Blueprint for selling a token into USDC.
   */
  @Post("sell")
  sellToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.sellToken(payload);
  }
}
