import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TradeDirection, TradeStatus } from "../../generated/prisma/enums.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { type TradeRequestDto } from "./dto/trade-request.dto.js";

const DEFAULT_ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
export const TRADE_SERVICE_FEE_USD = "0.05";

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

type TokenSnapshot = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  current: {
    price: number;
  };
};

type TokenDataset = {
  tokens: Record<string, TokenSnapshot>;
};

export type BuyTokenResult = {
  txHash: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenAmount: string;
  priceUsdEach: string;
  totalValueUsd: string;
  serviceFeeUsd: string;
  recipientWallet: string;
};

export type SellTokenResult = {
  deployerAddress: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenAmount: string;
  priceUsdEach: string;
  totalValueUsd: string;
  serviceFeeUsd: string;
  senderWallet: string;
};

export type RecordTradeInput = {
  userId: string;
  chatId?: string;
  transactionId?: string;
  direction: "BUY" | "SELL";
  tokenSymbol: string;
  tokenAddress: string;
  tokenAmount: string;
  priceUsdEach: string;
  walletAddress: string;
  txHash?: string;
};

@Injectable()
export class TradeService {
  private readonly publicClient = createPublicClient({
    transport: http(process.env.ARC_TESTNET_RPC_URL ?? DEFAULT_ARC_TESTNET_RPC_URL),
  });

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes an on-chain ERC20 transfer from the deployer to the recipient wallet.
   * Called by the x402-guarded POST /trade/buy endpoint.
   * Does NOT write a Trade DB record (that is handled by confirmTrade).
   */
  async executeBuy(payload: TradeRequestDto): Promise<BuyTokenResult> {
    const token = await this.resolveToken(payload.tokenId);
    const decimals = await this.getTokenDecimals(token.address);
    const tokenAmountBigInt = parseUnits(String(payload.tokenAmount), decimals);
    const account = this.getDeployerAccount();
    const walletClient = createWalletClient({
      account,
      transport: http(process.env.ARC_TESTNET_RPC_URL ?? DEFAULT_ARC_TESTNET_RPC_URL),
    });

    const deployerBalance = await this.publicClient.readContract({
      address: getAddress(token.address),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    if (deployerBalance < tokenAmountBigInt) {
      throw new BadRequestException(
        `Deployer has insufficient ${token.symbol} balance. Available: ${formatUnits(deployerBalance, decimals)}, requested: ${payload.tokenAmount}.`,
      );
    }

    const txHash = await walletClient.writeContract({
      address: getAddress(token.address),
      abi: erc20Abi,
      functionName: "transfer",
      args: [getAddress(payload.walletAddress), tokenAmountBigInt],
      chain: null,
    });

    return {
      txHash,
      tokenSymbol: token.symbol,
      tokenAddress: getAddress(token.address),
      tokenAmount: String(payload.tokenAmount),
      priceUsdEach: String(token.current.price),
      totalValueUsd: (token.current.price * payload.tokenAmount).toFixed(6),
      serviceFeeUsd: TRADE_SERVICE_FEE_USD,
      recipientWallet: getAddress(payload.walletAddress),
    };
  }

  /**
   * Returns the deployer address and token info for a pending sell.
   * The user must transfer tokens to the deployer address manually (via wagmi).
   * Called by the x402-guarded POST /trade/sell endpoint.
   * Does NOT write a Trade DB record (that is handled by confirmTrade).
   */
  async prepareSell(payload: TradeRequestDto): Promise<SellTokenResult> {
    const token = await this.resolveToken(payload.tokenId);
    const deployerAddress = this.getDeployerAccount().address;

    return {
      deployerAddress,
      tokenSymbol: token.symbol,
      tokenAddress: getAddress(token.address),
      tokenAmount: String(payload.tokenAmount),
      priceUsdEach: String(token.current.price),
      totalValueUsd: (token.current.price * payload.tokenAmount).toFixed(6),
      serviceFeeUsd: TRADE_SERVICE_FEE_USD,
      senderWallet: getAddress(payload.walletAddress),
    };
  }

  /**
   * Persists a Trade record after the x402 payment and on-chain action complete.
   */
  async recordTrade(input: RecordTradeInput) {
    return this.prisma.trade.create({
      data: {
        userId: input.userId,
        chatId: input.chatId,
        transactionId: input.transactionId,
        direction: input.direction === "BUY" ? TradeDirection.BUY : TradeDirection.SELL,
        tokenSymbol: input.tokenSymbol,
        tokenAddress: input.tokenAddress,
        tokenAmount: input.tokenAmount,
        priceUsdEach: input.priceUsdEach,
        walletAddress: input.walletAddress,
        txHash: input.txHash,
        status: input.direction === "BUY" ? TradeStatus.COMPLETED : TradeStatus.PENDING,
      },
    });
  }

  async resolveToken(tokenId: string): Promise<TokenSnapshot> {
    const dataset = await this.readTokenDataset();
    const normalized = tokenId.trim().toUpperCase();
    const token = dataset.tokens[normalized];

    if (!token) {
      throw new NotFoundException(
        `Token "${tokenId}" was not found. Available: ${Object.keys(dataset.tokens).join(", ")}.`,
      );
    }

    return token;
  }

  getDeployerAddress(): string {
    return this.getDeployerAccount().address;
  }

  private getDeployerAccount() {
    const privateKey = process.env.ARC_TESTNET_PRIVATE_KEY?.trim();

    if (!privateKey) {
      throw new InternalServerErrorException("ARC_TESTNET_PRIVATE_KEY is not configured.");
    }

    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    try {
      return await this.publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: erc20Abi,
        functionName: "decimals",
      });
    } catch {
      return 18;
    }
  }

  private async readTokenDataset(): Promise<TokenDataset> {
    const filePath = join(process.cwd(), "tokens.json");
    const fileContents = await readFile(filePath, "utf8");
    return JSON.parse(fileContents) as TokenDataset;
  }
}
