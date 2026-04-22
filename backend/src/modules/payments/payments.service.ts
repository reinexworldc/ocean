import { randomUUID } from "node:crypto";
import {
  BadGatewayException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { registerBatchScheme } from "@circle-fin/x402-batching/client";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme, authorizationTypes, toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http, verifyTypedData } from "viem";
import { Prisma } from "../../generated/prisma/client.js";
import { TransactionProvider, TransactionStatus } from "../../generated/prisma/enums.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { DEFAULT_X402_NETWORK } from "../../common/x402/x402.constants.js";
import { CircleWalletService } from "../circle-wallet/circle-wallet.service.js";
import { createCircleWalletClient } from "../circle-wallet/circle-wallet.client.js";

const DEFAULT_ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";

type HttpMethod = "GET" | "POST";

type JsonRecord = Record<string, unknown>;

export type PaidApiRequestInput = {
  userId: string;
  chatId?: string;
  actionType: string;
  amountUsd: string;
  description: string;
  method: HttpMethod;
  path: string;
  body?: JsonRecord;
};

export type PaidApiRequestResult<T> = {
  data: T;
  transactionId: string;
  settlementTransaction: string;
  paymentNetwork: string;
};

@Injectable()
export class PaymentsService {
  private readonly publicClient = createPublicClient({
    transport: http(process.env.ARC_TESTNET_RPC_URL ?? DEFAULT_ARC_TESTNET_RPC_URL),
  });

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CircleWalletService) private readonly circleWalletService: CircleWalletService,
  ) {}

  async callPaidJsonEndpoint<T>(input: PaidApiRequestInput): Promise<PaidApiRequestResult<T>> {
    const user = await this.ensureChargeableUser(input.userId);
    const requestUrl = this.buildInternalApiUrl(input.path);
    const unsignedResponse = await fetch(requestUrl, {
      method: input.method,
      headers: this.buildRequestHeaders(input.body),
      body: input.body ? JSON.stringify(input.body) : undefined,
    });

    if (unsignedResponse.status !== 402) {
      const responseBody = await this.readResponseBody(unsignedResponse);

      throw new InternalServerErrorException(
        `Expected x402 challenge for ${input.method} ${input.path}, but received ${unsignedResponse.status}. ${responseBody}`,
      );
    }

    const signer = await this.createCircleSigner(user.circleWalletId!, user.circleWalletAddress!);
    const client = new x402Client();
    registerBatchScheme(client, {
      signer,
      networks: [DEFAULT_X402_NETWORK],
      fallbackScheme: new ExactEvmScheme(signer),
    });
    const x402HttpClient = new x402HTTPClient(client);
    const paymentRequired = x402HttpClient.getPaymentRequiredResponse((name) =>
      unsignedResponse.headers.get(name),
    );
    const pendingTransaction = await this.prisma.transaction.create({
      data: {
        userId: input.userId,
        chatId: input.chatId,
        walletAddress: user.circleWalletAddress!,
        amountUsd: this.toDecimalAmount(input.amountUsd),
        currency: "USDC",
        provider: TransactionProvider.X402,
        externalPaymentId: randomUUID(),
        status: TransactionStatus.PENDING,
        metadata: this.toMetadataValue({
          kind: "X402_AGENT_TOOL_CALL",
          actionType: input.actionType,
          description: input.description,
          request: {
            method: input.method,
            path: input.path,
            url: requestUrl,
          },
          paymentRequired,
        }),
      },
    });

    let settlementResult: { success: boolean } | null = null;

    try {
      const paymentPayload = await x402HttpClient.createPaymentPayload(paymentRequired);
      const signatureDiagnostics = await this.buildPaymentSignatureDiagnostics(
        paymentPayload,
        user.circleWalletAddress!,
      );
      const paidResponse = await fetch(requestUrl, {
        method: input.method,
        headers: {
          ...this.buildRequestHeaders(input.body),
          ...x402HttpClient.encodePaymentSignatureHeader(paymentPayload),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
      });
      const rawPaidBody = await paidResponse.text();
      const settlementHeader =
        paidResponse.headers.get("PAYMENT-RESPONSE") || paidResponse.headers.get("X-PAYMENT-RESPONSE");

      if (!settlementHeader) {
        const retryPaymentRequired = this.readPaymentRequiredFromResponse(x402HttpClient, paidResponse, rawPaidBody);

        throw new BadGatewayException(
          `Paid request did not include a payment settlement header. Status: ${paidResponse.status}. Body: ${rawPaidBody.trim().slice(0, 500)}. Retry challenge: ${this.toJsonString(
            retryPaymentRequired ?? {},
          )}. Signature diagnostics: ${this.toJsonString(signatureDiagnostics)}`,
        );
      }

      const settlement = x402HttpClient.getPaymentSettleResponse((name) => paidResponse.headers.get(name));
      settlementResult = settlement;

      await this.prisma.transaction.update({
        where: {
          id: pendingTransaction.id,
        },
        data: {
          status: settlement.success ? TransactionStatus.COMPLETED : TransactionStatus.FAILED,
          externalPaymentId: settlement.transaction || pendingTransaction.externalPaymentId,
          metadata: this.toMetadataValue({
            kind: "X402_AGENT_TOOL_CALL",
            actionType: input.actionType,
            description: input.description,
            request: {
              method: input.method,
              path: input.path,
              url: requestUrl,
            },
            paymentRequired,
            settlement,
            response: {
              ok: paidResponse.ok,
              status: paidResponse.status,
            },
          }),
        },
      });

      if (!settlement.success) {
        throw new BadGatewayException(
          settlement.errorMessage || `x402 settlement failed for ${input.method} ${input.path}.`,
        );
      }

      if (!paidResponse.ok) {
        throw new BadGatewayException(
          `Paid request failed for ${input.method} ${input.path} with status ${paidResponse.status}.`,
        );
      }

      return {
        data: this.parseJsonBody<T>(rawPaidBody),
        transactionId: pendingTransaction.id,
        settlementTransaction: settlement.transaction,
        paymentNetwork: settlement.network,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown x402 payment error.";

      if (!settlementResult?.success) {
        await this.prisma.transaction.update({
          where: {
            id: pendingTransaction.id,
          },
          data: {
            status: TransactionStatus.FAILED,
            metadata: this.toMetadataValue({
              kind: "X402_AGENT_TOOL_CALL",
              actionType: input.actionType,
              description: input.description,
              request: {
                method: input.method,
                path: input.path,
                url: requestUrl,
              },
              paymentRequired,
              error: errorMessage,
            }),
          },
        });
      }

      throw error;
    }
  }

  private async ensureChargeableUser(userId: string) {
    await this.circleWalletService.ensureWalletAndFundingForUser(userId);

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    if (!user.circleWalletId || !user.circleWalletAddress) {
      throw new InternalServerErrorException("The user does not have a chargeable Circle wallet.");
    }

    return user;
  }

  private async createCircleSigner(circleWalletId: string, circleWalletAddress: string) {
    const circleClient = await createCircleWalletClient();

    return toClientEvmSigner(
      {
        address: circleWalletAddress as `0x${string}`,
        signTypedData: async ({ domain, types, primaryType, message }) => {
          const circleTypedData = this.toCircleTypedData({
            domain,
            types,
            primaryType,
            message,
          });
          const response = await circleClient.signTypedData({
            walletId: circleWalletId,
            data: this.toJsonString(circleTypedData),
            memo: "Ocean x402 premium API payment",
          });
          const signature = response.data?.signature;

          if (!signature) {
            throw new InternalServerErrorException("Circle did not return an EIP-712 signature.");
          }

          return signature as `0x${string}`;
        },
      },
      this.publicClient,
    );
  }

  private buildInternalApiUrl(path: string) {
    const origin = process.env.INTERNAL_API_ORIGIN?.trim() || `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
    return `${origin}/api${path.startsWith("/") ? path : `/${path}`}`;
  }

  private buildRequestHeaders(body?: JsonRecord) {
    return {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    };
  }

  private parseJsonBody<T>(rawBody: string) {
    if (!rawBody) {
      throw new BadGatewayException("Paid endpoint returned an empty response body.");
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch {
      throw new BadGatewayException("Paid endpoint returned a non-JSON response.");
    }
  }

  private async readResponseBody(response: Response) {
    const rawBody = await response.text();
    return rawBody.trim().slice(0, 500);
  }

  private toDecimalAmount(priceUsd: string) {
    return priceUsd.replace(/^\$/u, "");
  }

  private toMetadataValue(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(this.toJsonString(value)) as Prisma.InputJsonValue;
  }

  private toJsonString(value: unknown) {
    return JSON.stringify(value, (_key, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue,
    );
  }

  private readPaymentRequiredFromResponse(
    x402HttpClient: x402HTTPClient,
    response: Response,
    rawBody: string,
  ) {
    const paymentRequiredHeader = response.headers.get("PAYMENT-REQUIRED");

    if (!paymentRequiredHeader && response.status !== 402) {
      return null;
    }

    try {
      const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : undefined;
      const paymentRequired = x402HttpClient.getPaymentRequiredResponse(
        (name) => response.headers.get(name),
        parsedBody,
      ) as Record<string, unknown>;

      return {
        error: paymentRequired.error ?? null,
        invalidReason: paymentRequired.invalidReason ?? null,
        invalidMessage: paymentRequired.invalidMessage ?? null,
        accepts: Array.isArray(paymentRequired.accepts)
          ? (paymentRequired.accepts as unknown[]).slice(0, 1)
          : [],
      };
    } catch {
      return null;
    }
  }

  private async buildPaymentSignatureDiagnostics(paymentPayload: unknown, expectedAddress: string) {
    const payloadRecord =
      paymentPayload && typeof paymentPayload === "object" && !Array.isArray(paymentPayload)
        ? (paymentPayload as Record<string, unknown>)
        : null;
    const accepted =
      payloadRecord?.accepted && typeof payloadRecord.accepted === "object" && !Array.isArray(payloadRecord.accepted)
        ? (payloadRecord.accepted as Record<string, unknown>)
        : null;
    const payload =
      payloadRecord?.payload && typeof payloadRecord.payload === "object" && !Array.isArray(payloadRecord.payload)
        ? (payloadRecord.payload as Record<string, unknown>)
        : null;
    const authorization =
      payload?.authorization && typeof payload.authorization === "object" && !Array.isArray(payload.authorization)
        ? (payload.authorization as Record<string, unknown>)
        : null;
    const signature = typeof payload?.signature === "string" ? payload.signature : null;

    if (!accepted || !authorization || !signature) {
      return {
        available: false,
      };
    }

    const chainId = this.getChainIdFromNetwork(accepted.network);
    const asset = typeof accepted.asset === "string" ? accepted.asset : null;
    const extra =
      accepted.extra && typeof accepted.extra === "object" && !Array.isArray(accepted.extra)
        ? (accepted.extra as Record<string, unknown>)
        : null;
    const name = typeof extra?.name === "string" ? extra.name : null;
    const version = typeof extra?.version === "string" ? extra.version : null;
    const verifyingContract =
      typeof extra?.verifyingContract === "string" ? extra.verifyingContract : asset;

    if (!chainId || !verifyingContract || typeof name !== "string" || typeof version !== "string") {
      return {
        available: false,
        reason: "missing_exact_evm_context",
      };
    }

    try {
      const isValid = await verifyTypedData({
        address: expectedAddress as `0x${string}`,
        domain: {
          name,
          version,
          chainId,
          verifyingContract: verifyingContract as `0x${string}`,
        },
        types: {
          EIP712Domain: this.buildEip712DomainTypes({
            name,
            version,
            chainId,
            verifyingContract,
          }),
          ...authorizationTypes,
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: String(authorization.from) as `0x${string}`,
          to: String(authorization.to) as `0x${string}`,
          value: BigInt(String(authorization.value)),
          validAfter: BigInt(String(authorization.validAfter)),
          validBefore: BigInt(String(authorization.validBefore)),
          nonce: String(authorization.nonce) as `0x${string}`,
        },
        signature: signature as `0x${string}`,
      } as never);

      return {
        available: true,
        isValid,
        expectedAddress,
        signerAddress: authorization.from ?? null,
        signaturePrefix: signature.slice(0, 18),
      };
    } catch (error) {
      return {
        available: true,
        isValid: false,
        expectedAddress,
        signerAddress: authorization.from ?? null,
        signaturePrefix: signature.slice(0, 18),
        verifyError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getChainIdFromNetwork(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }

    const match = value.match(/^eip155:(\d+)$/u);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }

  private toCircleTypedData(input: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) {
    const normalizedTypes = this.normalizeTypedDataTypes(input.types);
    const messageFields = normalizedTypes[input.primaryType] ?? [];

    return {
      types: {
        ...normalizedTypes,
        EIP712Domain: this.buildEip712DomainTypes(input.domain),
      },
      domain: this.normalizeTypedDataValue(input.domain),
      primaryType: input.primaryType,
      message: this.pickTypedDataFields(input.message, messageFields),
    };
  }

  private normalizeTypedDataTypes(types: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(types).flatMap(([typeName, fields]) => {
        if (!Array.isArray(fields)) {
          return [];
        }

        return [
          [
            typeName,
            fields.flatMap((field) => {
              if (!field || typeof field !== "object" || Array.isArray(field)) {
                return [];
              }

              const typedField = field as Record<string, unknown>;
              const name = typeof typedField.name === "string" ? typedField.name : null;
              const type = typeof typedField.type === "string" ? typedField.type : null;

              if (!name || !type) {
                return [];
              }

              return [{ name, type }];
            }),
          ],
        ];
      }),
    ) as Record<string, Array<{ name: string; type: string }>>;
  }

  private buildEip712DomainTypes(domain: Record<string, unknown>) {
    const entries: Array<{ name: string; type: string }> = [];

    if (domain.name !== undefined) {
      entries.push({ name: "name", type: "string" });
    }

    if (domain.version !== undefined) {
      entries.push({ name: "version", type: "string" });
    }

    if (domain.chainId !== undefined) {
      entries.push({ name: "chainId", type: "uint256" });
    }

    if (domain.verifyingContract !== undefined) {
      entries.push({ name: "verifyingContract", type: "address" });
    }

    if (domain.salt !== undefined) {
      entries.push({ name: "salt", type: "bytes32" });
    }

    return entries;
  }

  private pickTypedDataFields(
    value: Record<string, unknown>,
    fields: Array<{ name: string; type: string }>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      fields
        .filter((field) => value[field.name] !== undefined)
        .map((field) => [field.name, this.normalizeTypedDataValue(value[field.name])]),
    );
  }

  private normalizeTypedDataValue(value: unknown): unknown {
    if (typeof value === "bigint") {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeTypedDataValue(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, currentValue]) => [
          key,
          this.normalizeTypedDataValue(currentValue),
        ]),
      );
    }

    return value;
  }
}
