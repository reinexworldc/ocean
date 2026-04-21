import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { X402_CHARGE_METADATA_KEY } from "./x402.constants.js";
import { X402Service } from "./x402.service.js";
import { type X402ChargeOptions } from "./x402.types.js";

type NextFunction = (error?: unknown) => void;

@Injectable()
export class X402PaymentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly x402Service: X402Service,
  ) {}

  async canActivate(context: ExecutionContext) {
    const charge = this.reflector.getAllAndOverride<X402ChargeOptions>(
      X402_CHARGE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!charge) {
      return true;
    }

    await this.x402Service.ensureInitialized();

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const middleware = this.x402Service.createRouteMiddleware(request, charge);

    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      void middleware(request, response, next);
    });

    return !(response.headersSent || response.writableEnded);
  }
}
