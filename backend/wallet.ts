import {
  OUTPUT_DIR,
  createLogger,
  parseArgs,
} from "./cli/wallet/helpers.js";
import { runWalletAction } from "./cli/wallet/actions.js";
import { logUnhandledError } from "./cli/script-helpers.js";

async function main() {
  const logger = createLogger();
  const args = parseArgs(process.argv.slice(2));

  logger.log("Parsed arguments", args);
  await runWalletAction(args, logger);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logUnhandledError(
    {
      outputDir: OUTPUT_DIR,
      filename: "wallet-error.log",
    },
    error,
  );
  console.error(message);
  process.exit(1);
});