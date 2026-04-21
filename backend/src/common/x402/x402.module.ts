import { Global, Module } from "@nestjs/common";
import { X402PaymentGuard } from "./x402.guard.js";
import { X402Service } from "./x402.service.js";

@Global()
@Module({
  providers: [X402Service, X402PaymentGuard],
  exports: [X402Service, X402PaymentGuard],
})
export class X402Module {}
