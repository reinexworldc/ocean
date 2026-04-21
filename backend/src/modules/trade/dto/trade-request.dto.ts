export class TradeRequestDto {
  wallet!: string;
  tokenId!: string;
  amountUsdc!: number;
  slippageBps?: number;
}
