import { Injectable } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type TokenCurrentSnapshot = {
  price: number;
  marketCap: number;
  volume24h: number;
  change1h: number;
  change24h: number;
  change7d: number;
  holders: number;
  liquidity: number;
};

type TokenSnapshot = {
  symbol: string;
  name: string;
  address: string;
  description: string;
  launchDate: string;
  current: TokenCurrentSnapshot;
  sentiment: string;
  analysis: string;
};

type TokenDataset = {
  tokens: Record<string, TokenSnapshot>;
  market?: {
    totalMarketCap?: number;
    totalVolume24h?: number;
    updatedAt?: string;
  };
};

type MarketTokenSummary = {
  id: string;
  symbol: string;
  name: string;
  address: string;
  price: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  holders: number;
  sentiment: string;
  change1h: number;
  change24h: number;
  change7d: number;
  relativeStrength24h: number;
  performance: "outperforming" | "underperforming" | "in-line";
};

const DEFAULT_SENTIMENT_SCORE = {
  bullish: 1,
  neutral: 0,
  bearish: -1,
} as const satisfies Record<string, number>;

@Injectable()
export class MarketService {
  async getMarketOverview() {
    const dataset = await this.readTokenDataset();
    const tokens = Object.values(dataset.tokens);
    const trackedTokens = tokens.length;

    const totalMarketCap = this.sum(tokens, ({ current }) => current.marketCap);
    const totalVolume24h = this.sum(tokens, ({ current }) => current.volume24h);
    const totalLiquidity = this.sum(tokens, ({ current }) => current.liquidity);
    const totalHolders = this.sum(tokens, ({ current }) => current.holders);
    const averageChange24h =
      trackedTokens === 0 ? 0 : this.round(totalMarketCap === 0 ? 0 : this.weightedAverage(tokens, "change24h"));
    const averageChange7d =
      trackedTokens === 0 ? 0 : this.round(totalMarketCap === 0 ? 0 : this.weightedAverage(tokens, "change7d"));
    const averageSentimentScore =
      trackedTokens === 0
        ? 0
        : this.round(
            tokens.reduce((total, token) => total + this.getSentimentScore(token.sentiment), 0) / trackedTokens,
          );

    const enrichedTokens = tokens
      .map<MarketTokenSummary>((token) => {
        const relativeStrength24h = this.round(token.current.change24h - averageChange24h);

        return {
          id: token.symbol,
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          price: token.current.price,
          marketCap: token.current.marketCap,
          volume24h: token.current.volume24h,
          liquidity: token.current.liquidity,
          holders: token.current.holders,
          sentiment: token.sentiment,
          change1h: token.current.change1h,
          change24h: token.current.change24h,
          change7d: token.current.change7d,
          relativeStrength24h,
          performance: this.getPerformanceLabel(relativeStrength24h),
        };
      })
      .sort((left, right) => right.marketCap - left.marketCap);

    const breadth = {
      advancing: enrichedTokens.filter((token) => token.change24h > 0).length,
      declining: enrichedTokens.filter((token) => token.change24h < 0).length,
      flat: enrichedTokens.filter((token) => token.change24h === 0).length,
      bullish: tokens.filter((token) => token.sentiment === "bullish").length,
      neutral: tokens.filter((token) => token.sentiment === "neutral").length,
      bearish: tokens.filter((token) => token.sentiment === "bearish").length,
    };

    return {
      updatedAt: dataset.market?.updatedAt ?? new Date().toISOString(),
      totals: {
        trackedTokens,
        marketCap: dataset.market?.totalMarketCap ?? totalMarketCap,
        volume24h: dataset.market?.totalVolume24h ?? totalVolume24h,
        liquidity: totalLiquidity,
        holders: totalHolders,
      },
      sentiment: {
        label: this.resolveMarketSentiment(averageChange24h, averageSentimentScore),
        score: this.round((averageChange24h / 10 + averageSentimentScore) / 2),
        averageSentimentScore,
        breadth,
      },
      leaders: {
        topTokens: enrichedTokens.slice(0, 5),
        topGainers: [...enrichedTokens]
          .sort((left, right) => right.change24h - left.change24h)
          .slice(0, 5),
        topLosers: [...enrichedTokens]
          .sort((left, right) => left.change24h - right.change24h)
          .slice(0, 5),
        topByVolume: [...enrichedTokens]
          .sort((left, right) => right.volume24h - left.volume24h)
          .slice(0, 5),
      },
      relativeStrength: {
        benchmark: {
          averageChange24h,
          averageChange7d,
        },
        strongest: [...enrichedTokens]
          .sort((left, right) => right.relativeStrength24h - left.relativeStrength24h)
          .slice(0, 5),
        weakest: [...enrichedTokens]
          .sort((left, right) => left.relativeStrength24h - right.relativeStrength24h)
          .slice(0, 5),
      },
      outperformers: enrichedTokens.filter((token) => token.performance === "outperforming"),
      underperformers: enrichedTokens.filter((token) => token.performance === "underperforming"),
      tokens: enrichedTokens,
    };
  }

  private async readTokenDataset(): Promise<TokenDataset> {
    const filePath = join(process.cwd(), "tokens.json");
    const fileContents = await readFile(filePath, "utf8");

    return JSON.parse(fileContents) as TokenDataset;
  }

  private sum(tokens: TokenSnapshot[], selector: (token: TokenSnapshot) => number) {
    return this.round(tokens.reduce((total, token) => total + selector(token), 0));
  }

  private weightedAverage(
    tokens: TokenSnapshot[],
    field: keyof Pick<TokenCurrentSnapshot, "change24h" | "change7d">,
  ) {
    const totalWeight = tokens.reduce((total, token) => total + token.current.marketCap, 0);

    if (totalWeight === 0) {
      return 0;
    }

    return (
      tokens.reduce((total, token) => total + token.current[field] * token.current.marketCap, 0) / totalWeight
    );
  }

  private getSentimentScore(sentiment: string) {
    return DEFAULT_SENTIMENT_SCORE[sentiment as keyof typeof DEFAULT_SENTIMENT_SCORE] ?? 0;
  }

  private getPerformanceLabel(
    relativeStrength24h: number,
  ): "outperforming" | "underperforming" | "in-line" {
    if (relativeStrength24h >= 2) {
      return "outperforming";
    }

    if (relativeStrength24h <= -2) {
      return "underperforming";
    }

    return "in-line";
  }

  private resolveMarketSentiment(averageChange24h: number, averageSentimentScore: number) {
    if (averageChange24h >= 3 || averageSentimentScore >= 0.5) {
      return "bullish";
    }

    if (averageChange24h <= -3 || averageSentimentScore <= -0.5) {
      return "bearish";
    }

    return "neutral";
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }
}
