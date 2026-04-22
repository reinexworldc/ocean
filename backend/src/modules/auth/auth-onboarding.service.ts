import { Injectable, Logger } from "@nestjs/common";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { CircleWalletService } from "../circle-wallet/circle-wallet.service.js";

@Injectable()
export class AuthOnboardingService {
  private readonly logger = new Logger(AuthOnboardingService.name);

  constructor(private readonly circleWalletService: CircleWalletService) {}

  async ensureUserProvisioned(user: User) {
    if (user.circleWalletId && user.circleWalletAddress && user.circleWalletBlockchain) {
      return user;
    }

    this.logger.log(`Provisioning Circle wallet for user ${user.id}.`);

    return this.circleWalletService.ensureWalletForUser(user.id);
  }
}
