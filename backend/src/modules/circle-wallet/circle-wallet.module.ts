import { Module } from "@nestjs/common";
import { CircleWalletController } from "./circle-wallet.controller.js";
import { CircleWalletService } from "./circle-wallet.service.js";

@Module({
  controllers: [CircleWalletController],
  providers: [CircleWalletService],
  exports: [CircleWalletService],
})
export class CircleWalletModule {}
