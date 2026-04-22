import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { BatchFacilitatorClient, GatewayEvmScheme } from "@circle-fin/x402-batching/server";
import { type FacilitatorClient, HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import {
  DEFAULT_X402_FACILITATOR_URL,
  DEFAULT_X402_NETWORK,
  DEFAULT_X402_TIMEOUT_SECONDS,
} from "./x402.constants.js";
import { type ResolvedX402ChargeOptions, type X402ChargeOptions } from "./x402.types.js";

type NestHttpRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
};

@Injectable()
export class X402Service {
  private readonly facilitatorClients: FacilitatorClient[] = [
    new HTTPFacilitatorClient({
      url: process.env.X402_FACILITATOR_URL ?? DEFAULT_X402_FACILITATOR_URL,
    }),
    new BatchFacilitatorClient() as unknown as FacilitatorClient,
  ];

  private readonly resourceServer = new x402ResourceServer([
    ...this.facilitatorClients,
  ]).register("eip155:*", new GatewayEvmScheme());

  private initializationPromise?: Promise<void>;

  async ensureInitialized() {
    this.initializationPromise ??= this.resourceServer.initialize();

    await this.initializationPromise;
  }

  createRouteMiddleware(request: NestHttpRequest, charge: X402ChargeOptions) {
    const resolvedCharge = this.resolveCharge(charge);
    const routeKey = `${this.getRequestMethod(request)} ${this.getRequestPath(request)}`;

    return paymentMiddleware(
      {
        [routeKey]: {
          accepts: {
            scheme: "exact",
            network: resolvedCharge.network,
            payTo: resolvedCharge.payTo,
            price: resolvedCharge.price,
            maxTimeoutSeconds: resolvedCharge.maxTimeoutSeconds,
            extra: resolvedCharge.extra,
          },
          description: resolvedCharge.description,
          resource: resolvedCharge.resource,
          mimeType: resolvedCharge.mimeType ?? "application/json",
        },
      },
      this.resourceServer,
      {
        appName: "Ocean API",
        testnet: true,
      },
      undefined,
      false,
    );
  }

  private resolveCharge(charge: X402ChargeOptions): ResolvedX402ChargeOptions {
    const payTo =
      charge.payTo ??
      process.env.X402_SELLER_ADDRESS ??
      process.env.TOKEN_OWNER ??
      process.env.OWNER;

    if (!payTo) {
      throw new InternalServerErrorException(
        "Missing seller address. Set X402_SELLER_ADDRESS, TOKEN_OWNER, or OWNER.",
      );
    }

    return {
      ...charge,
      payTo,
      network: charge.network ?? DEFAULT_X402_NETWORK,
      maxTimeoutSeconds: charge.maxTimeoutSeconds ?? DEFAULT_X402_TIMEOUT_SECONDS,
    };
  }

  private getRequestMethod(request: NestHttpRequest) {
    const method = request.method?.toUpperCase();

    if (!method) {
      throw new InternalServerErrorException("Unable to resolve request method for x402.");
    }

    return method;
  }

  private getRequestPath(request: NestHttpRequest) {
    const rawPath = request.originalUrl ?? request.url;

    if (!rawPath) {
      throw new InternalServerErrorException("Unable to resolve request path for x402.");
    }

    return rawPath.split("?")[0];
  }
}
