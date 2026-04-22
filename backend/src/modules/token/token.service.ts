import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  zeroAddress,
} from "viem";
import { type GetTokenHistoryQueryDto } from "./dto/get-token-history-query.dto.js";

const DEFAULT_ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
const DEFAULT_HISTORY_PERIOD = "24h";
const HISTORY_PERIODS = ["1h", "24h", "7d", "30d"] as const;
const LOG_BLOCK_RANGE = 10_000n;

type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

type TokenHistoryPoint = {
  timestamp: string;
  price: number;
  volume: number;
};

type TokenHistoryActivityPoint = TokenHistoryPoint & {
  activity: {
    transfersCount: number;
    uniqueActiveAddresses: number;
    transferredAmount: {
      raw: string;
      formatted: string;
    };
  };
};

type TokenSnapshot = {
  symbol: string;
  name: string;
  address: string;
  description: string;
  totalSupply: number;
  decimals: number;
  launchDate: string;
  current: {
    price: number;
    marketCap: number;
    volume24h: number;
    change1h: number;
    change24h: number;
    change7d: number;
    holders: number;
    liquidity: number;
  };
  history: Record<HistoryPeriod, TokenHistoryPoint[]>;
  sentiment: string;
  analysis: string;
};

type TokenDataset = {
  tokens: Record<string, TokenSnapshot>;
};

type HolderBalance = {
  address: string;
  balance: string;
  balanceFormatted: string;
  shareOfSupply: number;
};

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

function isHistoryPeriod(value: string): value is HistoryPeriod {
  return HISTORY_PERIODS.includes(value as HistoryPeriod);
}

@Injectable()
export class TokenService {
  private readonly publicClient = createPublicClient({
    transport: http(process.env.ARC_TESTNET_RPC_URL ?? DEFAULT_ARC_TESTNET_RPC_URL),
  });

  async getTokenById(tokenId: string) {
    const dataset = await this.readTokenDataset();
    const token = this.resolveToken(dataset, tokenId);
    const onChainData = await this.fetchOnChainTokenDetails(token.address);

    return {
      id: token.symbol,
      network: "Arc Testnet",
      address: onChainData.address,
      explorerUrl: this.getExplorerUrl(onChainData.address),
      name: onChainData.name,
      symbol: onChainData.symbol,
      description: token.description,
      launchDate: token.launchDate,
      decimals: onChainData.decimals,
      totalSupply: {
        raw: onChainData.totalSupply.toString(),
        formatted: formatUnits(onChainData.totalSupply, onChainData.decimals),
      },
      current: {
        ...token.current,
        holders: onChainData.holders.length,
      },
      sentiment: token.sentiment,
      analysis: token.analysis,
      holders: {
        total: onChainData.holders.length,
        items: onChainData.holders,
      },
      transfers: {
        total: onChainData.transfers.length,
        items: onChainData.transfers,
      },
    };
  }

  async getTokenHistory(tokenId: string, query: GetTokenHistoryQueryDto) {
    const dataset = await this.readTokenDataset();
    const token = this.resolveToken(dataset, tokenId);
    const requestedPeriod = query.period ?? DEFAULT_HISTORY_PERIOD;

    if (!isHistoryPeriod(requestedPeriod)) {
      throw new BadRequestException(
        `Unsupported period "${requestedPeriod}". Supported values: ${HISTORY_PERIODS.join(", ")}.`,
      );
    }

    const transferLogs = await this.getTransferLogs(getAddress(token.address));
    const points = await this.buildHistoryPointsWithActivity(
      token.history[requestedPeriod],
      transferLogs,
      token.decimals,
      requestedPeriod,
    );

    return {
      id: token.symbol,
      address: getAddress(token.address),
      period: requestedPeriod,
      summary: {
        points: points.length,
        transfersCount: points.reduce((total, point) => total + point.activity.transfersCount, 0),
        uniqueActiveAddresses: new Set(
          transferLogs.flatMap((log) => {
            const addresses = [];

            if (log.args.from && log.args.from !== zeroAddress) {
              addresses.push(getAddress(log.args.from));
            }

            if (log.args.to && log.args.to !== zeroAddress) {
              addresses.push(getAddress(log.args.to));
            }

            return addresses;
          }),
        ).size,
        lastActivityAt: await this.getLastActivityTimestamp(transferLogs),
      },
      points,
    };
  }

  private async readTokenDataset(): Promise<TokenDataset> {
    const filePath = join(process.cwd(), "tokens.json");
    const fileContents = await readFile(filePath, "utf8");

    return JSON.parse(fileContents) as TokenDataset;
  }

  private resolveToken(dataset: TokenDataset, tokenId: string): TokenSnapshot {
    const normalizedTokenId = tokenId.trim();

    if (normalizedTokenId.length === 0) {
      throw new BadRequestException("Token id is required.");
    }

    const bySymbol = dataset.tokens[normalizedTokenId.toUpperCase()];

    if (bySymbol) {
      return bySymbol;
    }

    if (!isAddress(normalizedTokenId)) {
      throw new NotFoundException(`Token "${tokenId}" was not found.`);
    }

    const normalizedAddress = getAddress(normalizedTokenId);
    const matchedToken = Object.values(dataset.tokens).find(
      (token) => getAddress(token.address) === normalizedAddress,
    );

    if (!matchedToken) {
      throw new NotFoundException(`Token "${tokenId}" was not found.`);
    }

    return matchedToken;
  }

  private async fetchOnChainTokenDetails(tokenAddress: string) {
    const address = getAddress(tokenAddress);
    const [name, symbol, decimals, totalSupply, transferLogs] = await Promise.all([
      this.publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "name",
      }),
      this.publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      this.publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      this.publicClient.readContract({
        address,
        abi: erc20Abi,
        functionName: "totalSupply",
      }),
      this.getTransferLogs(address),
    ]);

    const participantAddresses = new Set<`0x${string}`>();

    for (const log of transferLogs) {
      const from = log.args.from;
      const to = log.args.to;

      if (from && from !== zeroAddress) {
        participantAddresses.add(getAddress(from));
      }

      if (to && to !== zeroAddress) {
        participantAddresses.add(getAddress(to));
      }
    }

    const holdersWithBalances = await Promise.all(
      [...participantAddresses].map(async (holderAddress) => {
        const balance = await this.publicClient.readContract({
          address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [holderAddress],
        });

        return {
          address: holderAddress,
          balance,
        };
      }),
    );

    const holders = holdersWithBalances
      .filter(({ balance }) => balance > 0n)
      .sort((left, right) => (left.balance === right.balance ? 0 : left.balance > right.balance ? -1 : 1))
      .map<HolderBalance>(({ address: holderAddress, balance }) => ({
        address: holderAddress,
        balance: balance.toString(),
        balanceFormatted: formatUnits(balance, decimals),
        shareOfSupply: totalSupply === 0n ? 0 : Number((balance * 10_000n) / totalSupply) / 100,
      }));

    const transfers = transferLogs
      .map((log) => ({
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber?.toString() ?? null,
        from: log.args.from ? getAddress(log.args.from) : zeroAddress,
        to: log.args.to ? getAddress(log.args.to) : zeroAddress,
        value: (log.args.value ?? 0n).toString(),
        valueFormatted: formatUnits(log.args.value ?? 0n, decimals),
      }))
      .reverse();

    return {
      address,
      name,
      symbol,
      decimals,
      totalSupply,
      holders,
      transfers,
    };
  }

  private getExplorerUrl(address: string) {
    return `https://testnet.arcscan.app/address/${address}`;
  }

  private async buildHistoryPointsWithActivity(
    historyPoints: TokenHistoryPoint[],
    transferLogs: Awaited<ReturnType<TokenService["getTransferLogs"]>>,
    decimals: number,
    period: HistoryPeriod,
  ): Promise<TokenHistoryActivityPoint[]> {
    if (historyPoints.length === 0) {
      return [];
    }

    const blockTimestamps = await this.getBlockTimestampsByNumber(transferLogs);
    const sortedPoints = [...historyPoints].sort(
      (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    );
    const firstPoint = sortedPoints[0];
    const secondPoint = sortedPoints[1];
    const inferredIntervalMs =
      firstPoint && secondPoint
        ? Math.max(new Date(secondPoint.timestamp).getTime() - new Date(firstPoint.timestamp).getTime(), 1)
        : this.getFallbackIntervalMs(period);

    return sortedPoints.map((point, index) => {
      const intervalEndMs = new Date(point.timestamp).getTime();
      const previousPoint = index > 0 ? sortedPoints[index - 1] : undefined;
      const intervalStartMs =
        previousPoint ? new Date(previousPoint.timestamp).getTime() : intervalEndMs - inferredIntervalMs;
      const intervalLogs = transferLogs.filter((log) => {
        const blockNumber = log.blockNumber;

        if (blockNumber === null || blockNumber === undefined) {
          return false;
        }

        const blockTimestampMs = blockTimestamps.get(blockNumber);

        if (blockTimestampMs === undefined) {
          return false;
        }

        return blockTimestampMs > intervalStartMs && blockTimestampMs <= intervalEndMs;
      });
      const activeAddresses = new Set<string>();
      const transferredAmount = intervalLogs.reduce((total, log) => total + (log.args.value ?? 0n), 0n);

      for (const log of intervalLogs) {
        if (log.args.from && log.args.from !== zeroAddress) {
          activeAddresses.add(getAddress(log.args.from));
        }

        if (log.args.to && log.args.to !== zeroAddress) {
          activeAddresses.add(getAddress(log.args.to));
        }
      }

      return {
        ...point,
        activity: {
          transfersCount: intervalLogs.length,
          uniqueActiveAddresses: activeAddresses.size,
          transferredAmount: {
            raw: transferredAmount.toString(),
            formatted: formatUnits(transferredAmount, decimals),
          },
        },
      };
    });
  }

  private async getBlockTimestampsByNumber(
    transferLogs: Awaited<ReturnType<TokenService["getTransferLogs"]>>,
  ) {
    const blockNumbers = [...new Set(transferLogs.map((log) => log.blockNumber).filter((blockNumber) => blockNumber !== null))];
    const blocks = await Promise.all(
      blockNumbers.map(async (blockNumber) => ({
        blockNumber,
        timestampMs: Number(
          (
            await this.publicClient.getBlock({
              blockNumber,
            })
          ).timestamp * 1000n,
        ),
      })),
    );

    return new Map(blocks.map(({ blockNumber, timestampMs }) => [blockNumber, timestampMs]));
  }

  private async getLastActivityTimestamp(
    transferLogs: Awaited<ReturnType<TokenService["getTransferLogs"]>>,
  ) {
    const latestLog = [...transferLogs]
      .filter((log) => log.blockNumber !== null && log.blockNumber !== undefined)
      .sort((left, right) =>
        left.blockNumber === right.blockNumber ? 0 : left.blockNumber > right.blockNumber ? -1 : 1,
      )[0];

    if (!latestLog?.blockNumber) {
      return null;
    }

    const block = await this.publicClient.getBlock({
      blockNumber: latestLog.blockNumber,
    });

    return new Date(Number(block.timestamp * 1000n)).toISOString();
  }

  private getFallbackIntervalMs(period: HistoryPeriod) {
    switch (period) {
      case "1h":
        return 5 * 60 * 1000;
      case "24h":
        return 2 * 60 * 60 * 1000;
      case "7d":
        return 24 * 60 * 60 * 1000;
      case "30d":
        return 3 * 24 * 60 * 60 * 1000;
    }
  }

  private async getTransferLogs(address: `0x${string}`) {
    const latestBlock = await this.publicClient.getBlockNumber();
    const deploymentBlock = await this.findDeploymentBlock(address, latestBlock);
    const logs = [];

    for (
      let fromBlock = deploymentBlock;
      fromBlock <= latestBlock;
      fromBlock += LOG_BLOCK_RANGE
    ) {
      const toBlock =
        fromBlock + LOG_BLOCK_RANGE - 1n > latestBlock
          ? latestBlock
          : fromBlock + LOG_BLOCK_RANGE - 1n;

      const batchLogs = await this.publicClient.getLogs({
        address,
        event: transferEvent,
        fromBlock,
        toBlock,
      });

      logs.push(...batchLogs);
    }

    return logs;
  }

  private async findDeploymentBlock(
    address: `0x${string}`,
    latestBlock: bigint,
  ): Promise<bigint> {
    let low = 0n;
    let high = latestBlock;

    while (low < high) {
      const mid = low + (high - low) / 2n;
      const code = await this.publicClient.getCode({
        address,
        blockNumber: mid,
      });

      if (code && code !== "0x") {
        high = mid;
      } else {
        low = mid + 1n;
      }
    }

    return low;
  }
}
