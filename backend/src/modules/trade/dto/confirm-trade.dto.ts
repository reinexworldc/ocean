export class ConfirmTradeDto {
  tokenId!: string;
  direction!: "BUY" | "SELL";
  tokenAmount!: number;
  chatId?: string;
}
