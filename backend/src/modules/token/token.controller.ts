import { Controller, Get, Param, Query } from "@nestjs/common";
import { x402RouteConfigs } from "../../common/x402/x402-route-configs.js";
import { RequireX402 } from "../../common/x402/require-x402.decorator.js";
import { type GetTokenHistoryQueryDto } from "./dto/get-token-history-query.dto.js";
import { TokenService } from "./token.service.js";

@Controller("token")
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Returns the main token card with market data and status.
   */
  @Get(":id")
  @RequireX402(x402RouteConfigs.getTokenById)
  getTokenById(@Param("id") tokenId: string) {
    return this.tokenService.getTokenById(tokenId);
  }

  /**
   * Returns price history for the requested period.
   */
  @Get(":id/history")
  @RequireX402(x402RouteConfigs.getTokenHistory)
  getTokenHistory(
    @Param("id") tokenId: string,
    @Query() query: GetTokenHistoryQueryDto,
  ) {
    return this.tokenService.getTokenHistory(tokenId, query);
  }
}
