import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import {
  CircleWalletBlockchain,
  TransactionProvider,
  TransactionStatus,
} from "../../generated/prisma/enums.js";
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

const STARTER_FUNDING_EXTERNAL_PAYMENT_ID_PREFIX = "circle-testnet-starter-funding";
const STARTER_FUNDING_CURRENCY = "USDC";
const STARTER_FUNDING_AMOUNT_USD = "0.03";
const STARTER_FUNDING_DECIMALS = 18;
const CIRCLE_EOA_ACCOUNT_TYPE = "EOA";
const DEFAULT_ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_TESTNET_CHAIN = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: STARTER_FUNDING_CURRENCY,
    symbol: STARTER_FUNDING_CURRENCY,
    decimals: STARTER_FUNDING_DECIMALS,
  },
  rpcUrls: {
    default: {
      http: [DEFAULT_ARC_TESTNET_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

type FundingSummary = {
  status: "NOT_STARTED" | TransactionStatus;
  currency: string;
  provider: TransactionProvider;
  transactionId: string | null;
  externalPaymentId: string | null;
};

@Injectable()
export class CircleWalletService {
  private readonly logger = new Logger(CircleWalletService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getWalletSummaryForUser(userId: string) {
    const [user, fundingTransaction] = await Promise.all([
      this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      }),
      this.findStarterFundingTransaction(userId),
    ]);

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    return this.toWalletSummary(user, fundingTransaction);
  }

  async provisionWalletForUser(userId: string) {
    await this.ensureWalletAndFundingForUser(userId);

    return this.getWalletSummaryForUser(userId);
  }

  async fundWalletForUser(userId: string) {
    await this.ensureWalletAndFundingForUser(userId);

    return this.getWalletSummaryForUser(userId);
  }

  async ensureWalletAndFundingForUser(userId: string) {
    const user = await this.ensureWalletForUser(userId);

    await this.ensureStarterFundingForUser(user);

    return user;
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

  private async ensureStarterFundingForUser(user: User) {
    if (!this.hasProvisionedWallet(user)) {
      throw new InternalServerErrorException(
        "Circle wallet funding requires a provisioned wallet.",
      );
    }

    const existingTransaction = await this.findStarterFundingTransaction(user.id);
    const walletAddress = user.circleWalletAddress!;
    const blockchain = this.toCircleBlockchain(user.circleWalletBlockchain!);
    const { account, publicClient, walletClient } = this.createArcFundingClients();
    const transferAmount = parseUnits(STARTER_FUNDING_AMOUNT_USD, STARTER_FUNDING_DECIMALS);

    if (
      existingTransaction &&
      existingTransaction.walletAddress === walletAddress &&
      (existingTransaction.status === TransactionStatus.PENDING ||
        existingTransaction.status === TransactionStatus.COMPLETED)
    ) {
      return existingTransaction;
    }

    const metadata = {
      kind: "STARTER_TESTNET_USDC",
      walletId: user.circleWalletId,
      walletAddress,
      blockchain,
      fundingMethod: "ARC_NATIVE_TRANSFER",
      sourceWalletAddress: account.address,
      amount: {
        currency: STARTER_FUNDING_CURRENCY,
        usd: STARTER_FUNDING_AMOUNT_USD,
        raw: transferAmount.toString(),
        decimals: STARTER_FUNDING_DECIMALS,
      },
      lastAttemptAt: new Date().toISOString(),
    };

    const fundingTransaction = existingTransaction
      ? await this.prisma.transaction.update({
          where: {
            id: existingTransaction.id,
          },
          data: {
            walletAddress,
            amountUsd: STARTER_FUNDING_AMOUNT_USD,
            currency: STARTER_FUNDING_CURRENCY,
            provider: TransactionProvider.MANUAL,
            externalPaymentId: this.createStarterFundingExternalPaymentId(user.id),
            status: TransactionStatus.PENDING,
            metadata,
          },
        })
      : await this.prisma.transaction.create({
          data: {
            userId: user.id,
            walletAddress,
            amountUsd: STARTER_FUNDING_AMOUNT_USD,
            currency: STARTER_FUNDING_CURRENCY,
            provider: TransactionProvider.MANUAL,
            externalPaymentId: this.createStarterFundingExternalPaymentId(user.id),
            status: TransactionStatus.PENDING,
            metadata,
          },
        });

    try {
      this.logger.log(
        `Sending starter ${STARTER_FUNDING_AMOUNT_USD} ${STARTER_FUNDING_CURRENCY} to user ${user.id}.`,
      );

      const hash = await walletClient.sendTransaction({
        account,
        chain: ARC_TESTNET_CHAIN,
        to: getAddress(walletAddress),
        value: transferAmount,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
      });
      const requestSucceeded = receipt.status === "success";

      return this.prisma.transaction.update({
        where: {
          id: fundingTransaction.id,
        },
        data: {
          status: requestSucceeded ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
          metadata: {
            ...metadata,
            transfer: {
              hash,
              status: receipt.status,
              blockNumber: receipt.blockNumber.toString(),
              gasUsed: receipt.gasUsed.toString(),
              explorerUrl: `${ARC_TESTNET_CHAIN.blockExplorers.default.url}/tx/${hash}`,
            },
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown ARC funding error.";

      this.logger.error(`Starter ARC funding failed for user ${user.id}.`, error);

      return this.prisma.transaction.update({
        where: {
          id: fundingTransaction.id,
        },
        data: {
          status: TransactionStatus.FAILED,
          metadata: {
            ...metadata,
            error: message,
          },
        },
      });
    }
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

  private async findStarterFundingTransaction(userId: string) {
    return this.prisma.transaction.findFirst({
      where: {
        userId,
        externalPaymentId: this.createStarterFundingExternalPaymentId(userId),
      },
      orderBy: {
        createdAt: "desc",
      },
    });
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

  private toCircleBlockchain(blockchain: CircleWalletBlockchain) {
    switch (blockchain) {
      case CircleWalletBlockchain.ARC_TESTNET:
        return DEFAULT_CIRCLE_WALLET_BLOCKCHAIN;
      default:
        throw new InternalServerErrorException(
          `Unsupported Circle blockchain: ${String(blockchain)}.`,
        );
    }
  }

  private toWalletSummary(
    user: User,
    fundingTransaction: Awaited<ReturnType<CircleWalletService["findStarterFundingTransaction"]>>,
  ) {
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
      funding: this.toFundingSummary(fundingTransaction),
    };
  }

  private toFundingSummary(
    fundingTransaction: Awaited<ReturnType<CircleWalletService["findStarterFundingTransaction"]>>,
  ): FundingSummary {
    return fundingTransaction
      ? {
          status: fundingTransaction.status,
          currency: fundingTransaction.currency,
          provider: fundingTransaction.provider,
          transactionId: fundingTransaction.id,
          externalPaymentId: fundingTransaction.externalPaymentId,
        }
      : {
          status: "NOT_STARTED",
          currency: STARTER_FUNDING_CURRENCY,
          provider: TransactionProvider.MANUAL,
          transactionId: null,
          externalPaymentId: null,
        };
  }

  private createArcFundingClients() {
    const rpcUrl = process.env.ARC_TESTNET_RPC_URL?.trim() || DEFAULT_ARC_TESTNET_RPC_URL;
    const privateKey = this.requireArcStarterFundingPrivateKey();
    const account = privateKeyToAccount(privateKey);
    const transport = http(rpcUrl);

    return {
      account,
      publicClient: createPublicClient({
        chain: ARC_TESTNET_CHAIN,
        transport,
      }),
      walletClient: createWalletClient({
        account,
        chain: ARC_TESTNET_CHAIN,
        transport,
      }),
    };
  }

  private requireArcStarterFundingPrivateKey(): `0x${string}` {
    const privateKey = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();
    if (!privateKey) {
      throw new InternalServerErrorException(
        "ARC_TESTNET_PRIVATE_KEY is required to send starter funding.",
      );
    }

    return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  }

  private createStarterFundingExternalPaymentId(userId: string) {
    return `${STARTER_FUNDING_EXTERNAL_PAYMENT_ID_PREFIX}:${userId}`;
  }

  private formatLogMessage(message: string, payload?: unknown) {
    return payload === undefined
      ? message
      : `${message} ${JSON.stringify(payload)}`;
  }
}
