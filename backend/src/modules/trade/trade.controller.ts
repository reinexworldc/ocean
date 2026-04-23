import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { PaymentsService } from "../payments/payments.service.js";
import { x402RouteConfigs } from "../../common/x402/x402-route-configs.js";
import { RequireX402 } from "../../common/x402/require-x402.decorator.js";
import { type ConfirmTradeDto } from "./dto/confirm-trade.dto.js";
import { type TradeRequestDto } from "./dto/trade-request.dto.js";
import { TradeService, type BuyTokenResult, type SellTokenResult } from "./trade.service.js";

@Controller("trade")
export class TradeController {
  constructor(
    @Inject(TradeService) private readonly tradeService: TradeService,
    @Inject(PaymentsService) private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * x402-guarded — called internally by the confirm flow via callPaidJsonEndpoint.
   * Executes an ERC20 transfer from the deployer wallet to the recipient.
   */
  @Post("buy")
  @RequireX402(x402RouteConfigs.buyToken)
  buyToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.executeBuy(payload);
  }

  /**
   * x402-guarded — called internally by the confirm flow via callPaidJsonEndpoint.
   * Returns pending sell info (deployer address) for the user to transfer tokens to.
   */
  @Post("sell")
  @RequireX402(x402RouteConfigs.sellToken)
  sellToken(@Body() payload: TradeRequestDto) {
    return this.tradeService.prepareSell(payload);
  }

  /**
   * Session-authenticated — called by the frontend when the user confirms a trade proposal.
   * Pays the $0.05 x402 fee via the user's Circle wallet, executes the trade action,
   * then writes a Trade DB record with the authenticated user's ID.
   */
  @Post("confirm")
  @UseGuards(SessionAuthGuard)
  async confirmTrade(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmTradeDto,
  ) {
    if (dto.direction !== "BUY" && dto.direction !== "SELL") {
      throw new BadRequestException('direction must be "BUY" or "SELL".');
    }

    const config = dto.direction === "BUY" ? x402RouteConfigs.buyToken : x402RouteConfigs.sellToken;
    const path = dto.direction === "BUY" ? "/trade/buy" : "/trade/sell";

    const requestBody: TradeRequestDto = {
      tokenId: dto.tokenId,
      tokenAmount: dto.tokenAmount,
      walletAddress: user.walletAddress,
    };

    const result = await this.paymentsService.callPaidJsonEndpoint<BuyTokenResult | SellTokenResult>({
      userId: user.id,
      chatId: dto.chatId,
      actionType: dto.direction === "BUY" ? "buy_token" : "sell_token",
      amountUsd: config.price,
      description: config.description,
      method: "POST",
      path,
      body: requestBody as unknown as Record<string, unknown>,
    });

    const tradeData = result.data;

    const trade = await this.tradeService.recordTrade({
      userId: user.id,
      chatId: dto.chatId,
      transactionId: result.transactionId,
      direction: dto.direction,
      tokenSymbol: "txHash" in tradeData ? tradeData.tokenSymbol : tradeData.tokenSymbol,
      tokenAddress: tradeData.tokenAddress,
      tokenAmount: tradeData.tokenAmount,
      priceUsdEach: tradeData.priceUsdEach,
      walletAddress: user.walletAddress,
      txHash: "txHash" in tradeData ? tradeData.txHash : undefined,
    });

    return {
      trade,
      ...tradeData,
      transactionId: result.transactionId,
      settlementTransaction: result.settlementTransaction,
      paymentNetwork: result.paymentNetwork,
    };
  }
}
