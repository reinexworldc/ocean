import { Injectable } from "@nestjs/common";
import { type TradeRequestDto } from "./dto/trade-request.dto.js";

@Injectable()
export class TradeService {
  buyToken(_payload: TradeRequestDto) {
    return null;
  }

  sellToken(_payload: TradeRequestDto) {
    return null;
  }
}
