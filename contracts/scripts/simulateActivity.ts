import { randomBytes, randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { network } from "hardhat";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";

const defaultTransactionsPerToken = 120;
const defaultMinDelayMs = 500;
const defaultMaxDelayMs = 1_000;
const defaultMinTransferAmount = "5";
const defaultMaxTransferAmount = "250";
const defaultReuseRecipientChance = 0.35;

function parsePositiveInteger(value: string, envName: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer.`);
  }

  return parsed;
}

function parseProbability(value: string, envName: string): number {
  const parsed = Number.parseFloat(value);

  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${envName} must be a number between 0 and 1.`);
  }

  return parsed;
}

function parseTokenAddresses(): `0x${string}`[] {
  const cliAddresses = process.argv
    .slice(2)
    .map((value) => value.trim())
    .filter((value) => isAddress(value));
  const envAddresses = (process.env.ACTIVITY_TOKEN_ADDRESSES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const rawAddresses = cliAddresses.length > 0 ? cliAddresses : envAddresses;

  if (rawAddresses.length === 0) {
    throw new Error(
      "Provide token addresses via ACTIVITY_TOKEN_ADDRESSES or CLI arguments.",
    );
  }

  return [...new Set(rawAddresses.map((address) => normalizeAddress(address)))];
}

function normalizeAddress(address: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new Error(`Invalid token address: ${address}`);
  }

  return getAddress(address);
}

function getRandomRecipientAddress(): `0x${string}` {
  return getAddress(`0x${randomBytes(20).toString("hex")}`);
}

function randomBigInt(min: bigint, max: bigint): bigint {
  if (max < min) {
    throw new Error("Max random value cannot be smaller than min random value.");
  }

  if (min === max) {
    return min;
  }

  const range = max - min + 1n;
  const byteLength = Math.ceil(range.toString(2).length / 8);

  while (true) {
    const bytes = randomBytes(byteLength);
    let randomValue = 0n;

    for (const byte of bytes) {
      randomValue = (randomValue << 8n) + BigInt(byte);
    }

    if (randomValue < range) {
      return min + randomValue;
    }
  }
}

const tokenAddresses = parseTokenAddresses();
const transactionsPerToken = parsePositiveInteger(
  process.env.ACTIVITY_TRANSACTIONS_PER_TOKEN ??
    String(defaultTransactionsPerToken),
  "ACTIVITY_TRANSACTIONS_PER_TOKEN",
);
const minDelayMs = parsePositiveInteger(
  process.env.ACTIVITY_MIN_DELAY_MS ?? String(defaultMinDelayMs),
  "ACTIVITY_MIN_DELAY_MS",
);
const maxDelayMs = parsePositiveInteger(
  process.env.ACTIVITY_MAX_DELAY_MS ?? String(defaultMaxDelayMs),
  "ACTIVITY_MAX_DELAY_MS",
);
const reuseRecipientChance = parseProbability(
  process.env.ACTIVITY_REUSE_RECIPIENT_CHANCE ??
    String(defaultReuseRecipientChance),
  "ACTIVITY_REUSE_RECIPIENT_CHANCE",
);
const minTransferAmountRaw =
  process.env.ACTIVITY_MIN_TRANSFER_AMOUNT ?? defaultMinTransferAmount;
const maxTransferAmountRaw =
  process.env.ACTIVITY_MAX_TRANSFER_AMOUNT ?? defaultMaxTransferAmount;

if (maxDelayMs < minDelayMs) {
  throw new Error("ACTIVITY_MAX_DELAY_MS must be greater than or equal to ACTIVITY_MIN_DELAY_MS.");
}

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [senderClient] = await viem.getWalletClients();

if (!senderClient?.account) {
  throw new Error(
    "No sender account available. Set ARC_TESTNET_PRIVATE_KEY before running the script.",
  );
}

const nativeBalance = await publicClient.getBalance({
  address: senderClient.account.address,
});

console.log("Starting token activity simulation...");
console.log("Network:", publicClient.chain?.name ?? "arcTestnet");
console.log("Sender:", senderClient.account.address);
console.log("Native balance:", formatUnits(nativeBalance, 18));
console.log("Token count:", tokenAddresses.length);
console.log("Transactions per token:", transactionsPerToken);
console.log("Delay range (ms):", `${minDelayMs}-${maxDelayMs}`);
console.log("Recipient reuse chance:", reuseRecipientChance);

let totalTransactionsSent = 0;

for (const tokenAddress of tokenAddresses) {
  const token = await viem.getContractAt("ArcToken", tokenAddress, {
    client: {
      public: publicClient,
      wallet: senderClient,
    },
  });

  const [name, symbol, decimals, startingBalance] = await Promise.all([
    token.read.name(),
    token.read.symbol(),
    token.read.decimals(),
    token.read.balanceOf([senderClient.account.address]),
  ]);

  const minTransferAmount = parseUnits(minTransferAmountRaw, decimals);
  const maxTransferAmount = parseUnits(maxTransferAmountRaw, decimals);

  if (minTransferAmount <= 0n) {
    throw new Error("ACTIVITY_MIN_TRANSFER_AMOUNT must be greater than zero.");
  }

  if (maxTransferAmount < minTransferAmount) {
    throw new Error(
      `ACTIVITY_MAX_TRANSFER_AMOUNT must be greater than or equal to ACTIVITY_MIN_TRANSFER_AMOUNT for ${symbol}.`,
    );
  }

  const minimumRequiredBalance = minTransferAmount * BigInt(transactionsPerToken);

  if (startingBalance < minimumRequiredBalance) {
    throw new Error(
      `Not enough ${symbol} balance for ${transactionsPerToken} transfers. Required at least ${formatUnits(minimumRequiredBalance, decimals)}, current balance is ${formatUnits(startingBalance, decimals)}.`,
    );
  }

  console.log(`\n[${symbol}] Simulating activity for ${name}`);
  console.log(`[${symbol}] Contract: ${tokenAddress}`);
  console.log(
    `[${symbol}] Sender balance: ${formatUnits(startingBalance, decimals)}`,
  );

  let remainingBalance = startingBalance;
  const knownRecipients: `0x${string}`[] = [];

  for (let transactionIndex = 1; transactionIndex <= transactionsPerToken; transactionIndex += 1) {
    const remainingTransactions = transactionsPerToken - transactionIndex;
    const minimumReservedBalance =
      minTransferAmount * BigInt(remainingTransactions);
    const maxAllowedAmount = remainingBalance - minimumReservedBalance;
    const transferAmount = randomBigInt(
      minTransferAmount,
      maxTransferAmount < maxAllowedAmount ? maxTransferAmount : maxAllowedAmount,
    );

    const shouldReuseRecipient =
      knownRecipients.length > 0 && Math.random() < reuseRecipientChance;
    const recipientAddress = shouldReuseRecipient
      ? knownRecipients[randomInt(0, knownRecipients.length)]
      : getRandomRecipientAddress();

    if (!shouldReuseRecipient) {
      knownRecipients.push(recipientAddress);
    }

    const transactionHash = await token.write.transfer([
      recipientAddress,
      transferAmount,
    ]);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
    });

    if (receipt.status !== "success") {
      throw new Error(
        `[${symbol}] Transfer ${transactionIndex} failed: ${transactionHash}`,
      );
    }

    remainingBalance -= transferAmount;
    totalTransactionsSent += 1;

    console.log(
      `[${symbol}] ${transactionIndex}/${transactionsPerToken} -> ${recipientAddress} | amount=${formatUnits(transferAmount, decimals)} | tx=${transactionHash}`,
    );

    if (transactionIndex === transactionsPerToken) {
      continue;
    }

    const delayMs =
      minDelayMs === maxDelayMs
        ? minDelayMs
        : randomInt(minDelayMs, maxDelayMs + 1);

    console.log(`[${symbol}] Waiting ${delayMs}ms before next transfer...`);
    await sleep(delayMs);
  }

  console.log(
    `[${symbol}] Completed ${transactionsPerToken} transfers. Remaining sender balance: ${formatUnits(remainingBalance, decimals)}`,
  );
}

console.log("\nSimulation completed successfully.");
console.log("Total transfers sent:", totalTransactionsSent);
