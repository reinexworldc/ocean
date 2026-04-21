import { network } from "hardhat";
import { formatUnits, isAddress, parseUnits } from "viem";

type TokenConfig = {
  name: string;
  symbol: string;
  description: string;
};

const tokenConfigs: TokenConfig[] = [
  {
    name: "Moon Token",
    symbol: "MOON",
    description: "Bullish meme token with strong community",
  },
  {
    name: "Rekt Token",
    symbol: "REKT",
    description: "Bearish token, handle with care",
  },
  {
    name: "Crab Token",
    symbol: "CRAB",
    description: "Stable sideways token, going nowhere",
  },
];

const initialSupplyRaw = process.env.TOKENS_INITIAL_SUPPLY ?? "1000000";
const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

if (!deployer?.account) {
  throw new Error(
    "No deployer account available. Set ARC_TESTNET_PRIVATE_KEY before deployment.",
  );
}

const owner = process.env.TOKEN_OWNER ?? deployer.account.address;

if (!isAddress(owner)) {
  throw new Error("TOKEN_OWNER must be a valid EVM address.");
}

const initialSupply = parseUnits(initialSupplyRaw, 18);

console.log("Deploying ArcToken contracts...");
console.log("Network:", publicClient.chain?.name ?? "arcTestnet");
console.log("Deployer:", deployer.account.address);
console.log("Owner:", owner);
console.log("Initial supply per token:", formatUnits(initialSupply, 18));

for (const tokenConfig of tokenConfigs) {
  const token = await viem.deployContract("ArcToken", [
    tokenConfig.name,
    tokenConfig.symbol,
    owner,
    initialSupply,
  ]);

  console.log(`${tokenConfig.symbol} deployed:`, token.address);
  console.log(`${tokenConfig.symbol} description:`, tokenConfig.description);
  console.log(
    `${tokenConfig.symbol} explorer:`,
    `https://testnet.arcscan.app/address/${token.address}`,
  );
}
