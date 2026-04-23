import { Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { type Request } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { type AuthenticatedRequest, type AuthenticatedUser } from "../auth/auth.types.js";
import { CircleWalletService } from "./circle-wallet.service.js";

@Controller("circle-wallet")
@UseGuards(SessionAuthGuard)
export class CircleWalletController {
  constructor(
    @Inject(CircleWalletService)
    private readonly circleWalletService: CircleWalletService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
  ) {}

  @Get("me")
  getMyCircleWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.circleWalletService.getWalletSummaryForUser(user.id);
  }

  @Post("provision")
  provisionMyCircleWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.circleWalletService.provisionWalletForUser(user.id);
  }

  @Post("replenish")
  replenishMyCircleWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const session = this.authSessionService.readSession(request as AuthenticatedRequest);
    const sessionId = session?.sid ?? user.id;
    return this.circleWalletService.replenishWalletForUser(user.id, sessionId);
  }
}
