import { Injectable, Logger } from "@nestjs/common";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { CircleWalletService } from "../circle-wallet/circle-wallet.service.js";

@Injectable()
export class AuthOnboardingService {
  private readonly logger = new Logger(AuthOnboardingService.name);

  constructor(private readonly circleWalletService: CircleWalletService) {}

  async ensureUserProvisioned(user: User) {
    this.logger.log(`Ensuring Circle wallet and starter funding for user ${user.id}.`);

    return this.circleWalletService.ensureWalletAndFundingForUser(user.id);
  }
}
