export type GatewayTokenBalances = {
  balance: string;
  formatted: string;
};

export type GatewayBalanceSummary = {
  total: string;
  available: string;
  withdrawing: string;
  withdrawable: string;
  formattedTotal: string;
  formattedAvailable: string;
  formattedWithdrawing: string;
  formattedWithdrawable: string;
};

export type GatewayBalances = {
  wallet: GatewayTokenBalances;
  gateway: GatewayBalanceSummary;
};

export type GatewayBalancesResult = GatewayBalances | { error: string } | null;

export type WalletSummary = {
  provisioned: boolean;
  wallet: {
    id: string;
    address: string;
    blockchain: string;
  } | null;
  gateway: GatewayBalancesResult;
};
