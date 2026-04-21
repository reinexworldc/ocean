import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { X402_CHARGE_METADATA_KEY } from "./x402.constants.js";
import { X402PaymentGuard } from "./x402.guard.js";
import { type X402ChargeOptions } from "./x402.types.js";

export function RequireX402(config: X402ChargeOptions) {
  return applyDecorators(
    SetMetadata(X402_CHARGE_METADATA_KEY, config),
    UseGuards(X402PaymentGuard),
  );
}
