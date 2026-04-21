import "dotenv/config";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    arcTestnet: {
      type: "http",
      chainType: "l1",
      url: process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network",
      accounts: process.env.ARC_TESTNET_PRIVATE_KEY
        ? [process.env.ARC_TESTNET_PRIVATE_KEY]
        : [],
    },
  },
});
