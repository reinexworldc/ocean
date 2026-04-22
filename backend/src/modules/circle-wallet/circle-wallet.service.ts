import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { getAddress } from "viem";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { CircleWalletBlockchain } from "../../generated/prisma/enums.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import {
  DEFAULT_ARC_TESTNET_RPC_URL,
  CIRCLE_EOA_ACCOUNT_TYPE,
} from "./circle-wallet.constants.js";
import {
  DEFAULT_CIRCLE_WALLET_BLOCKCHAIN,
  createCircleIdempotencyKey,
  createCircleWalletClient,
  normalizeCircleBlockchain,
  persistCircleWalletSetId,
  resolveCircleWalletSetId,
  resolveCircleWalletSetName,
} from "./circle-wallet.client.js";
import type {
  GatewayBalancesResult,
  WalletSummary,
} from "./circle-wallet.types.js";

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getWalletSummaryForUser(userId: string): Promise<WalletSummary> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    const gatewayBalances = await this.readGatewayBalances(user);

    return this.toWalletSummary(user, gatewayBalances);
  }

  async provisionWalletForUser(userId: string): Promise<WalletSummary> {
    await this.ensureWalletForUser(userId);

    return this.getWalletSummaryForUser(userId);
  }

  /**
   * Kept for compatibility with PaymentsService — now only ensures the wallet
   * exists without triggering any on-chain gateway funding.
   */
  async ensureWalletAndFundingForUser(userId: string): Promise<User> {
    return this.ensureWalletForUser(userId);
  }

  async ensureWalletForUser(userId: string, forceRefresh = false): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    if (!forceRefresh && this.hasProvisionedWallet(user)) {
      return user;
    }

    const client = await createCircleWalletClient({
      log: (message, payload) =>
        this.logger.log(payload !== undefined ? `${message} ${JSON.stringify(payload)}` : message),
    });

    const walletSetId = await this.ensureWalletSetId(client);

    this.logger.log(`Creating Circle wallet for user ${user.id} in wallet set ${walletSetId}.`);

    const createdWallet = (
      await client.createWallets({
        walletSetId,
        blockchains: [DEFAULT_CIRCLE_WALLET_BLOCKCHAIN],
        count: 1,
        accountType: CIRCLE_EOA_ACCOUNT_TYPE,
        idempotencyKey: createCircleIdempotencyKey(),
      })
    ).data?.wallets?.[0];

    if (!createdWallet?.id || !createdWallet.address || !createdWallet.blockchain) {
      throw new InternalServerErrorException(
        "Circle wallet creation failed: wallet payload is missing required fields.",
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        circleWalletId: createdWallet.id,
        circleWalletAddress: createdWallet.address,
        circleWalletBlockchain: this.toPrismaBlockchain(createdWallet.blockchain),
      },
    });

    this.logger.log(`Circle wallet ${createdWallet.id} assigned to user ${updatedUser.id}.`);

    return updatedUser;
  }

  private async ensureWalletSetId(
    client: Awaited<ReturnType<typeof createCircleWalletClient>>,
  ): Promise<string> {
    const existingId = resolveCircleWalletSetId();

    if (existingId) {
      return existingId;
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

  private createGatewayClient() {
    const rpcUrl = process.env.ARC_TESTNET_RPC_URL?.trim() ?? DEFAULT_ARC_TESTNET_RPC_URL;

    return new GatewayClient({
      chain: "arcTestnet",
      privateKey: this.requireArcPrivateKey(),
      rpcUrl,
    });
  }

  private requireArcPrivateKey(): `0x${string}` {
    const raw = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();

    if (!raw) {
      throw new InternalServerErrorException(
        "ARC_TESTNET_PRIVATE_KEY is required to read Gateway balances.",
      );
    }

    return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  }

  private async readGatewayBalances(user: User): Promise<GatewayBalancesResult> {
    if (!this.hasProvisionedWallet(user)) {
      return null;
    }

    try {
      const balances = await this.createGatewayClient().getBalances(
        getAddress(user.circleWalletAddress!),
      );

      return {
        wallet: {
          balance: balances.wallet.balance.toString(),
          formatted: balances.wallet.formatted,
        },
        gateway: {
          total: balances.gateway.total.toString(),
          available: balances.gateway.available.toString(),
          withdrawing: balances.gateway.withdrawing.toString(),
          withdrawable: balances.gateway.withdrawable.toString(),
          formattedTotal: balances.gateway.formattedTotal,
          formattedAvailable: balances.gateway.formattedAvailable,
          formattedWithdrawing: balances.gateway.formattedWithdrawing,
          formattedWithdrawable: balances.gateway.formattedWithdrawable,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Gateway balance read error.";
      this.logger.warn(`Failed to read Gateway balances for user ${user.id}: ${message}`);

      return { error: message };
    }
  }

  private toWalletSummary(user: User, gatewayBalances: GatewayBalancesResult): WalletSummary {
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
      gateway: gatewayBalances,
    };
  }

  private hasProvisionedWallet(user: User): boolean {
    return Boolean(
      user.circleWalletId && user.circleWalletAddress && user.circleWalletBlockchain,
    );
  }

  private toPrismaBlockchain(blockchain: string): CircleWalletBlockchain {
    switch (normalizeCircleBlockchain(blockchain)) {
      case DEFAULT_CIRCLE_WALLET_BLOCKCHAIN:
        return CircleWalletBlockchain.ARC_TESTNET;
      default:
        throw new InternalServerErrorException(`Unsupported Circle blockchain: ${blockchain}.`);
    }
  }

}
