import { Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { type AuthenticatedUser } from "../auth/auth.types.js";
import { CircleWalletService } from "./circle-wallet.service.js";

@Controller("circle-wallet")
@UseGuards(SessionAuthGuard)
export class CircleWalletController {
  constructor(
    @Inject(CircleWalletService)
    private readonly circleWalletService: CircleWalletService,
  ) {}

  @Get("me")
  getMyCircleWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.circleWalletService.getWalletSummaryForUser(user.id);
  }

  @Post("provision")
  provisionMyCircleWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.circleWalletService.provisionWalletForUser(user.id);
  }
}
