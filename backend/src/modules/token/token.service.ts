import { Injectable } from "@nestjs/common";
import { type GetTokenHistoryQueryDto } from "./dto/get-token-history-query.dto.js";

@Injectable()
export class TokenService {
  getTokenById(_tokenId: string) {
    return null;
  }

  getTokenHistory(_tokenId: string, _query: GetTokenHistoryQueryDto) {
    return null;
  }
}
