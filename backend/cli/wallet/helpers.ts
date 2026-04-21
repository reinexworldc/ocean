/// <reference types="node" />

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
  type Blockchain,
} from "@circle-fin/developer-controlled-wallets";
import {
  createScriptLogger,
  getCliValue,
  hasCliFlag,
  parseCliArgs,
  upsertEnvValue as upsertEnvVariable,
  type ParsedCliEntry,
  type ScriptLogger,
} from "../script-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "../..");

export const OUTPUT_DIR = path.join(BACKEND_DIR, "output");
export const ENV_PATH = path.join(BACKEND_DIR, ".env");
export const TESTNET_BLOCKCHAINS = ["ARC-TESTNET"] as const;
export const DEFAULT_BLOCKCHAIN = "ARC-TESTNET" as const;
export const SUPPORTED_ACTIONS = [
  "new_set",
  "new_wallet",
  "faucet",
  "balance",
] as const;

export type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];
export type TestnetBlockchainValue = (typeof TESTNET_BLOCKCHAINS)[number];

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
  upsertEnvVariable(ENV_PATH, key, value);
}

export function requireApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is required. Add it to .env or set it as an environment variable.",
    );
  }

  return apiKey;
}

export async function ensureEntitySecret(logger: Logger) {
  const existing = process.env.CIRCLE_ENTITY_SECRET;
  if (existing) {
    logger.log("Using existing entity secret from environment");
    return existing;
  }

  const apiKey = requireApiKey();
  const entitySecret = crypto.randomBytes(32).toString("hex");

  logger.log("Registering new entity secret");

  await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: OUTPUT_DIR,
  });

  upsertEnvValue("CIRCLE_ENTITY_SECRET", entitySecret);
  process.env.CIRCLE_ENTITY_SECRET = entitySecret;

  logger.log("Entity secret registered and saved to .env");

  return entitySecret;
}

export async function createClient(logger: Logger) {
  const apiKey = requireApiKey();
  const entitySecret = await ensureEntitySecret(logger);

  return initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
}

export function assertTestnetBlockchain(blockchain: string) {
  const allowed = new Set<string>(TESTNET_BLOCKCHAINS);
  if (!allowed.has(blockchain)) {
    throw new Error(
      `Unsupported blockchain for faucet: ${blockchain}. Allowed: ${Array.from(allowed).join(", ")}`,
    );
  }

  return blockchain as TestnetBlockchainValue;
}
