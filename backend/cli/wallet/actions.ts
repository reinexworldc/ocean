import {
  assertTestnetBlockchain,
  createClient,
  upsertEnvValue,
  type Logger,
  type ParsedArgs,
} from "./helpers.js";

async function handleNewSet(args: ParsedArgs, logger: Logger) {
  const client = await createClient(logger);

  logger.log("Creating wallet set", { name: args.value });

  const walletSet = (await client.createWalletSet({ name: args.value })).data?.walletSet;
  if (!walletSet?.id) {
    throw new Error("Wallet set creation failed: no ID returned");
  }

  const result = {
    action: "new_set",
    walletSet,
    logFilePath: logger.logFilePath,
  };

  logger.log("Wallet set created", result);
  logger.writeResult("new-set", result);
}

async function handleNewWallet(args: ParsedArgs, logger: Logger) {
  const client = await createClient(logger);

  logger.log("Creating wallet", {
    walletSetId: args.value,
    blockchain: args.blockchain,
  });

  const wallet = (
    await client.createWallets({
      walletSetId: args.value,
      blockchains: [args.blockchain],
      count: 1,
      accountType: "EOA",
    })
  ).data?.wallets?.[0];

  if (!wallet?.id || !wallet.address) {
    throw new Error("Wallet creation failed: no wallet returned");
  }

  upsertEnvValue("CIRCLE_WALLET_ID", wallet.id);
  upsertEnvValue("CIRCLE_WALLET_ADDRESS", wallet.address);
  upsertEnvValue("CIRCLE_WALLET_BLOCKCHAIN", wallet.blockchain);

  const result = {
    action: "new_wallet",
    wallet,
    logFilePath: logger.logFilePath,
  };

  logger.log("Wallet created", result);
  logger.writeResult("new-wallet", result);
}

async function handleFaucet(args: ParsedArgs, logger: Logger) {
  const client = await createClient(logger);
  const blockchain = assertTestnetBlockchain(args.blockchain);

  const request = {
    address: args.value,
    blockchain,
    native: args.faucet.native,
    usdc: args.faucet.usdc,
    eurc: args.faucet.eurc,
  };

  logger.log("Requesting faucet", request);

  const response = await client.requestTestnetTokens(request);

  const result = {
    action: "faucet",
    request,
    status: response.status,
    statusText: response.statusText,
    logFilePath: logger.logFilePath,
  };

  logger.log("Faucet request completed", result);
  logger.writeResult("faucet", result);
}

async function handleBalance(args: ParsedArgs, logger: Logger) {
  const client = await createClient(logger);

  logger.log("Fetching wallet balances", { walletId: args.value });

  const balances = (await client.getWalletTokenBalance({ id: args.value })).data?.tokenBalances;

  const result = {
    action: "balance",
    walletId: args.value,
    balances: balances ?? [],
    logFilePath: logger.logFilePath,
  };

  logger.log("Balances fetched", result);
  logger.writeResult("balance", result);
}

export async function runWalletAction(args: ParsedArgs, logger: Logger) {
  switch (args.action) {
    case "new_set":
      await handleNewSet(args, logger);
      break;
    case "new_wallet":
      await handleNewWallet(args, logger);
      break;
    case "faucet":
      await handleFaucet(args, logger);
      break;
    case "balance":
      await handleBalance(args, logger);
      break;
    default:
      throw new Error(`Unsupported action: ${String(args.action)}`);
  }
}
