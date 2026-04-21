import { type Network } from "@x402/express";

export type X402ChargeOptions = {
  price: string;
  description: string;
  network?: Network;
  payTo?: string;
  resource?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

export type ResolvedX402ChargeOptions = Omit<X402ChargeOptions, "network" | "payTo"> & {
  network: Network;
  payTo: string;
};
