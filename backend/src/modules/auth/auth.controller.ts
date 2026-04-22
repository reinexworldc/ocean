import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { type Response } from "express";
import { AuthService } from "./auth.service.js";
import { type AuthenticatedRequest } from "./auth.types.js";
import { type VerifySiweRequestDto } from "./dto/verify-siwe-request.dto.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("siwe/nonce")
  getSiweNonce(@Res({ passthrough: true }) response: Response) {
    return this.authService.issueSiweNonce(response);
  }

  @Post("siwe/verify")
  verifySiwe(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: VerifySiweRequestDto,
  ) {
    return this.authService.verifySiwe(request, response, dto);
  }

  @Get("me")
  getCurrentSession(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentSession(request);
  }

  @Post("sign-out")
  signOut(@Res({ passthrough: true }) response: Response) {
    return this.authService.signOut(response);
  }
}
