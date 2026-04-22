/// <reference types="node" />

import { type Blockchain } from "@circle-fin/developer-controlled-wallets";
import {
  createScriptLogger,
  getCliValue,
  hasCliFlag,
  parseCliArgs,
  type ParsedCliEntry,
  type ScriptLogger,
} from "../script-helpers.js";
import {
  OUTPUT_DIR,
  DEFAULT_CIRCLE_WALLET_BLOCKCHAIN,
  assertSupportedCircleTestnetBlockchain,
  createCircleWalletClient,
  ensureCircleEntitySecret,
  upsertBackendEnvValue,
  type TestnetBlockchainValue,
} from "../../src/modules/circle-wallet/circle-wallet.client.js";

export { OUTPUT_DIR };
export const DEFAULT_BLOCKCHAIN = DEFAULT_CIRCLE_WALLET_BLOCKCHAIN;
export const SUPPORTED_ACTIONS = [
  "new_set",
  "new_wallet",
  "faucet",
  "balance",
] as const;

export type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

export type ParsedArgs = {
  action: SupportedAction;
  value: string;
  blockchain: Blockchain;
  faucet: {
    native: boolean;
    usdc: boolean;
    eurc: boolean;
  };
};

export type Logger = ScriptLogger;

export function getUsage() {
  return [
    "Arguments are required. Commands:",
    '  -new_set="name"',
    "  -new_wallet=set_id [-blockchain=ARC-TESTNET]",
    "  -faucet=wallet_address [-blockchain=ARC-TESTNET] [-usdc] [-native] [-eurc]",
    "  -balance=wallet_id",
    "",
    "Examples:",
    '  node --env-file=.env --import=tsx wallet.ts -new_set="Main set"',
    "  node --env-file=.env --import=tsx wallet.ts -new_wallet=<walletSetId>",
    "  node --env-file=.env --import=tsx wallet.ts -faucet=<walletAddress> -usdc",
    "  node --env-file=.env --import=tsx wallet.ts -balance=<walletId>",
  ].join("\n");
}

export function createLogger(): Logger {
  return createScriptLogger({
    outputDir: OUTPUT_DIR,
    logPrefix: "wallet",
  });
}

function parseRawWalletArgs(argv: string[], usage: string): ParsedCliEntry[] {
  try {
    return parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\n${usage}`);
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const usage = getUsage();
  if (argv.length === 0 || argv.includes("-help") || argv.includes("--help")) {
    throw new Error(usage);
  }

  const rawEntries = parseRawWalletArgs(argv, usage);

  const actionEntries = rawEntries.filter((entry) =>
    SUPPORTED_ACTIONS.includes(entry.key as SupportedAction),
  );

  if (actionEntries.length !== 1) {
    throw new Error(
      `Exactly one command is required from: ${SUPPORTED_ACTIONS.join(", ")}\n\n${usage}`,
    );
  }

  const actionEntry = actionEntries[0];
  if (!actionEntry) {
    throw new Error(`Unable to resolve wallet action.\n\n${usage}`);
  }

  if (!actionEntry.value) {
    throw new Error(`-${actionEntry.key} requires a value.\n\n${usage}`);
  }

  const faucet = {
    native: hasCliFlag(rawEntries, "native"),
    usdc: hasCliFlag(rawEntries, "usdc"),
    eurc: hasCliFlag(rawEntries, "eurc"),
  };

  if (actionEntry.key === "faucet" && !faucet.native && !faucet.usdc && !faucet.eurc) {
    faucet.usdc = true;
  }

  return {
    action: actionEntry.key as SupportedAction,
    value: actionEntry.value,
    blockchain: getCliValue(rawEntries, "blockchain", DEFAULT_BLOCKCHAIN) as Blockchain,
    faucet,
  };
}

export function upsertEnvValue(key: string, value: string) {
  upsertBackendEnvValue(key, value);
}

export function requireApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is required. Add it to .env or set it as an environment variable.",
    );
  }

  return apiKey;
}

export async function ensureEntitySecret(logger: Logger) {
  return ensureCircleEntitySecret(logger);
}

export async function createClient(logger: Logger) {
  return createCircleWalletClient(logger);
}

export function assertTestnetBlockchain(blockchain: string) {
  return assertSupportedCircleTestnetBlockchain(blockchain);
}
