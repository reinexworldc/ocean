import { Controller, Get, Param, Query } from "@nestjs/common";
import { type GetTokenHistoryQueryDto } from "./dto/get-token-history-query.dto.js";
import { TokenService } from "./token.service.js";

@Controller("token")
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Returns the main token card with market data and status.
   */
  @Get(":id")
  getTokenById(@Param("id") tokenId: string) {
    return this.tokenService.getTokenById(tokenId);
  }

  /**
   * Returns price history for the requested period.
   */
  @Get(":id/history")
  getTokenHistory(
    @Param("id") tokenId: string,
    @Query() query: GetTokenHistoryQueryDto,
  ) {
    return this.tokenService.getTokenHistory(tokenId, query);
  }
}
