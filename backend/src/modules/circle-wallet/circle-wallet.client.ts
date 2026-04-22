import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from "@circle-fin/developer-controlled-wallets";

export const OUTPUT_DIR = path.join(process.cwd(), "output");
export const ENV_PATH = path.join(process.cwd(), ".env");
export const TESTNET_BLOCKCHAINS = ["ARC-TESTNET"] as const;
export const DEFAULT_CIRCLE_WALLET_BLOCKCHAIN = "ARC-TESTNET" as const;
export const DEFAULT_CIRCLE_WALLET_SET_NAME = "Ocean Wallet Set";

export type TestnetBlockchainValue = (typeof TESTNET_BLOCKCHAINS)[number];

type CircleClientLogger = {
  log?: (message: string, payload?: unknown) => void;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function upsertBackendEnvValue(key: string, value: string) {
  const nextLine = `${key}=${value}`;

  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, `${nextLine}\n`, "utf-8");
    return;
  }

  const current = fs.readFileSync(ENV_PATH, "utf-8");
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  const nextContent = pattern.test(current)
    ? current.replace(pattern, nextLine)
    : `${current.trimEnd()}\n${nextLine}\n`;

  fs.writeFileSync(ENV_PATH, nextContent, "utf-8");
}

export function requireCircleApiKey() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "CIRCLE_API_KEY is required. Add it to .env or set it as an environment variable.",
    );
  }

  return apiKey;
}

export async function ensureCircleEntitySecret(logger?: CircleClientLogger) {
  const existing = process.env.CIRCLE_ENTITY_SECRET?.trim();
  if (existing) {
    logger?.log?.("Using existing Circle entity secret from environment.");
    return existing;
  }

  const apiKey = requireCircleApiKey();
  const entitySecret = crypto.randomBytes(32).toString("hex");

  logger?.log?.("Registering a new Circle entity secret.");

  await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: OUTPUT_DIR,
  });

  upsertBackendEnvValue("CIRCLE_ENTITY_SECRET", entitySecret);
  process.env.CIRCLE_ENTITY_SECRET = entitySecret;

  logger?.log?.("Circle entity secret registered and persisted to .env.");

  return entitySecret;
}

export async function createCircleWalletClient(logger?: CircleClientLogger) {
  const apiKey = requireCircleApiKey();
  const entitySecret = await ensureCircleEntitySecret(logger);

  return initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
}

export function assertSupportedCircleTestnetBlockchain(blockchain: string) {
  const allowed = new Set<string>(TESTNET_BLOCKCHAINS);

  if (!allowed.has(blockchain)) {
    throw new Error(
      `Unsupported blockchain for Circle testnet flow: ${blockchain}. Allowed: ${Array.from(allowed).join(", ")}`,
    );
  }

  return blockchain as TestnetBlockchainValue;
}

export function resolveCircleWalletSetName() {
  return process.env.CIRCLE_WALLET_SET_NAME?.trim() || DEFAULT_CIRCLE_WALLET_SET_NAME;
}

export function resolveCircleWalletSetId() {
  return process.env.CIRCLE_WALLET_SET_ID?.trim() || null;
}

export function persistCircleWalletSetId(walletSetId: string) {
  upsertBackendEnvValue("CIRCLE_WALLET_SET_ID", walletSetId);
  process.env.CIRCLE_WALLET_SET_ID = walletSetId;
}

export function createCircleIdempotencyKey() {
  return crypto.randomUUID();
}

export function normalizeCircleBlockchain(blockchain: string) {
  return assertSupportedCircleTestnetBlockchain(blockchain);
}
