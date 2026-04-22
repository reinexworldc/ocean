import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AccountType } from "@circle-fin/developer-controlled-wallets";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { CircleWalletBlockchain } from "../../generated/prisma/enums.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  DEFAULT_CIRCLE_WALLET_BLOCKCHAIN,
  createCircleIdempotencyKey,
  createCircleWalletClient,
  normalizeCircleBlockchain,
  persistCircleWalletSetId,
  resolveCircleWalletSetId,
  resolveCircleWalletSetName,
} from "./circle-wallet.client.js";

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWalletSummaryForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    return this.toWalletSummary(user);
  }

  async provisionWalletForUser(userId: string) {
    return this.ensureWalletForUser(userId);
  }

  async ensureWalletForUser(userId: string, forceRefresh = false): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    if (!forceRefresh && this.hasProvisionedWallet(user)) {
      return user;
    }

    const client = await createCircleWalletClient({
      log: (message, payload) => this.logger.log(this.formatLogMessage(message, payload)),
    });
    const walletSetId = await this.ensureWalletSetId(client);

    this.logger.log(
      `Creating Circle wallet for user ${user.id} in wallet set ${walletSetId}.`,
    );

    const createdWallet = (
      await client.createWallets({
        walletSetId,
        blockchains: [DEFAULT_CIRCLE_WALLET_BLOCKCHAIN],
        count: 1,
        accountType: AccountType.Eoa,
        idempotencyKey: createCircleIdempotencyKey(),
      })
    ).data?.wallets?.[0];

    if (!createdWallet?.id || !createdWallet.address || !createdWallet.blockchain) {
      throw new InternalServerErrorException(
        "Circle wallet creation failed: wallet payload is missing required fields.",
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        circleWalletId: createdWallet.id,
        circleWalletAddress: createdWallet.address,
        circleWalletBlockchain: this.toPrismaBlockchain(createdWallet.blockchain),
      },
    });

    this.logger.log(
      `Circle wallet ${createdWallet.id} assigned to user ${updatedUser.id}.`,
    );

    return updatedUser;
  }

  private async ensureWalletSetId(client: Awaited<ReturnType<typeof createCircleWalletClient>>) {
    const existingWalletSetId = resolveCircleWalletSetId();
    if (existingWalletSetId) {
      return existingWalletSetId;
    }

    this.logger.log("Creating a shared Circle wallet set for Ocean users.");

    const walletSet = (
      await client.createWalletSet({
        name: resolveCircleWalletSetName(),
        idempotencyKey: createCircleIdempotencyKey(),
      })
    ).data?.walletSet;

    if (!walletSet?.id) {
      throw new InternalServerErrorException(
        "Circle wallet set creation failed: wallet set ID was not returned.",
      );
    }

    persistCircleWalletSetId(walletSet.id);
    this.logger.log(`Circle wallet set ${walletSet.id} created and persisted to .env.`);

    return walletSet.id;
  }

  private hasProvisionedWallet(user: User) {
    return Boolean(
      user.circleWalletId && user.circleWalletAddress && user.circleWalletBlockchain,
    );
  }

  private toPrismaBlockchain(blockchain: string) {
    const normalizedBlockchain = normalizeCircleBlockchain(blockchain);

    switch (normalizedBlockchain) {
      case DEFAULT_CIRCLE_WALLET_BLOCKCHAIN:
        return CircleWalletBlockchain.ARC_TESTNET;
      default:
        throw new InternalServerErrorException(
          `Unsupported Circle blockchain: ${normalizedBlockchain}.`,
        );
    }
  }

  private toWalletSummary(user: User) {
    const provisioned = this.hasProvisionedWallet(user);

    return {
      provisioned,
      wallet: provisioned
        ? {
            id: user.circleWalletId!,
            address: user.circleWalletAddress!,
            blockchain: user.circleWalletBlockchain!,
          }
        : null,
    };
  }

  private formatLogMessage(message: string, payload?: unknown) {
    return payload === undefined
      ? message
      : `${message} ${JSON.stringify(payload)}`;
  }
}
