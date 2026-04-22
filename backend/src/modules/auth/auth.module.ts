import { Module } from "@nestjs/common";
import { CircleWalletModule } from "../circle-wallet/circle-wallet.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthOnboardingService } from "./auth-onboarding.service.js";
import { AuthService } from "./auth.service.js";
import { AuthSessionService } from "./auth-session.service.js";
import { SessionAuthGuard } from "./guards/session-auth.guard.js";

@Module({
  imports: [CircleWalletModule],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService, AuthOnboardingService, SessionAuthGuard],
  exports: [AuthService, AuthSessionService, SessionAuthGuard],
})
export class AuthModule {}
