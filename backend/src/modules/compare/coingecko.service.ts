import { Injectable, Logger, NotFoundException } from "@nestjs/common";

/** Maps common symbols/names to CoinGecko coin IDs. */
const COIN_ALIASES: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  doge: "dogecoin",
  dogecoin: "dogecoin",
  shib: "shiba-inu",
  shiba: "shiba-inu",
  "shiba-inu": "shiba-inu",
  shibainu: "shiba-inu",
  xrp: "ripple",
  ripple: "ripple",
  ada: "cardano",
  cardano: "cardano",
  pepe: "pepe",
  bnb: "binancecoin",
  binance: "binancecoin",
  avax: "avalanche-2",
  avalanche: "avalanche-2",
  near: "near",
  matic: "matic-network",
  polygon: "matic-network",
  link: "chainlink",
  chainlink: "chainlink",
  uni: "uniswap",
  uniswap: "uniswap",
  ltc: "litecoin",
  litecoin: "litecoin",
  ton: "the-open-network",
  sui: "sui",
  apt: "aptos",
  aptos: "aptos",
  dot: "polkadot",
  polkadot: "polkadot",
  atom: "cosmos",
  cosmos: "cosmos",
};

export type CoinGeckoMarketData = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  change7d: number | null;
  change30d: number | null;
  volume24h: number;
  marketCap: number;
  allTimeHigh: number;
  allTimeHighChangePercent: number | null;
  circulatingSupply: number | null;
};

type CacheEntry = { data: CoinGeckoMarketData; expiresAt: number };

const CACHE_TTL_MS = 60_000;
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const MAX_RETRIES = 4;
/** Base delay in ms; doubles each attempt: 1s → 2s → 4s → 8s */
const RETRY_BASE_MS = 1_000;

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly cache = new Map<string, CacheEntry>();

  /** Resolves a user-supplied name/symbol to a CoinGecko coin ID. */
  resolveId(raw: string): string {
    const key = raw.trim().toLowerCase();
    const resolved = COIN_ALIASES[key] ?? key;
    return resolved;
  }

  /** Returns the list of supported alias → id mappings for prompts. */
  static getSupportedAliases(): string[] {
    return [...new Set(Object.values(COIN_ALIASES))];
  }

  async getCoinData(coinId: string): Promise<CoinGeckoMarketData> {
    const cached = this.cache.get(coinId);
    if (cached && Date.now() < cached.expiresAt) {
      this.logger.debug(`CoinGecko cache hit for ${coinId}`);
      return cached.data;
    }

    this.logger.log(`CoinGecko: fetching market data for ${coinId}`);

    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;

    let response: Response | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      response = await fetch(url, { headers: { Accept: "application/json" } });

      if (response.status === 404) {
        throw new NotFoundException(
          `CoinGecko does not recognise coin "${coinId}". Try a common symbol like bitcoin, ethereum, solana, dogecoin.`,
        );
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt === MAX_RETRIES) break;

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader
          ? Math.min(Number.parseInt(retryAfterHeader, 10) * 1_000 || RETRY_BASE_MS, 30_000)
          : RETRY_BASE_MS * 2 ** (attempt - 1);

        this.logger.warn(
          `CoinGecko rate limited (${response.status}) for "${coinId}". Retrying in ${retryAfterMs}ms (attempt ${attempt}/${MAX_RETRIES}).`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        continue;
      }

      break;
    }

    if (!response!.ok) {
      throw new Error(`CoinGecko API returned ${response!.status} for coin "${coinId}" after ${MAX_RETRIES} attempts.`);
    }

    const raw = (await response!.json()) as Record<string, unknown>;
    const md = raw.market_data as Record<string, unknown> | undefined;
    const currentPrice = this.asRecord(md?.current_price);
    const marketCap = this.asRecord(md?.market_cap);
    const totalVolume = this.asRecord(md?.total_volume);
    const ath = this.asRecord(md?.ath);
    const athChangePct = this.asRecord(md?.ath_change_percentage);

    const data: CoinGeckoMarketData = {
      id: coinId,
      symbol: typeof raw.symbol === "string" ? raw.symbol.toUpperCase() : coinId.toUpperCase(),
      name: typeof raw.name === "string" ? raw.name : coinId,
      price: this.toNumber(currentPrice.usd) ?? 0,
      change24h: this.toNumber(md?.price_change_percentage_24h) ?? 0,
      change7d: this.toNumber(md?.price_change_percentage_7d),
      change30d: this.toNumber(md?.price_change_percentage_30d),
      volume24h: this.toNumber(totalVolume.usd) ?? 0,
      marketCap: this.toNumber(marketCap.usd) ?? 0,
      allTimeHigh: this.toNumber(ath.usd) ?? 0,
      allTimeHighChangePercent: this.toNumber(athChangePct.usd),
      circulatingSupply: this.toNumber(md?.circulating_supply),
    };

    this.cache.set(coinId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    this.logger.log(`CoinGecko: fetched ${data.name} @ $${data.price}`);
    return data;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}
