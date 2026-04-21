import { type X402ChargeOptions } from "./x402.types.js";

export const x402RouteConfigs = {
  getMarketOverview: {
    price: "$0.01",
    description: "Access the aggregated market overview.",
  },
  getTokenById: {
    price: "$0.01",
    description: "Access token metadata and on-chain transfer activity.",
  },
  getTokenHistory: {
    price: "$0.01",
    description: "Access token history time series data.",
  },
  getWalletPortfolio: {
    price: "$0.02",
    description: "Access the wallet portfolio breakdown.",
  },
  buyToken: {
    price: "$0.05",
    description: "Execute a token buy trade request.",
  },
  sellToken: {
    price: "$0.05",
    description: "Execute a token sell trade request.",
  },
} satisfies Record<string, X402ChargeOptions>;
