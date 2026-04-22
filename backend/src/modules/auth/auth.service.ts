import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { SiweMessage } from "siwe";
import { getAddress } from "viem";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { AuthOnboardingService } from "./auth-onboarding.service.js";
import { AuthSessionService } from "./auth-session.service.js";
import {
  type AuthenticatedRequest,
  type AuthenticatedUser,
} from "./auth.types.js";
import { type VerifySiweRequestDto } from "./dto/verify-siwe-request.dto.js";

type CookieWriter = {
  cookie: (name: string, value: string, options: Record<string, unknown>) => void;
  clearCookie: (name: string, options: Record<string, unknown>) => void;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSessionService: AuthSessionService,
    private readonly authOnboardingService: AuthOnboardingService,
  ) {}

  issueSiweNonce(response: CookieWriter) {
    return this.authSessionService.issueNonceCookie(response);
  }

  async verifySiwe(
    request: AuthenticatedRequest,
    response: CookieWriter,
    dto: VerifySiweRequestDto,
  ) {
    const nonce = this.authSessionService.readNonce(request);
    if (!nonce) {
      throw new UnauthorizedException("SIWE challenge is missing or expired.");
    }

    const siweMessage = this.parseSiweMessage(dto);
    const verifiedMessage = await this.verifyMessageSignature(siweMessage, dto.signature, nonce);

    this.assertAllowedDomain(verifiedMessage.domain);
    this.assertAllowedUri(verifiedMessage.uri);

    const walletAddress = getAddress(verifiedMessage.address);
    const existingUser = await this.prisma.user.findUnique({
      where: {
        walletAddress,
      },
    });

    const user =
      existingUser ??
      (await this.prisma.user.create({
        data: {
          walletAddress,
          avatarUrl: null,
        },
      }));

    const provisionedUser = await this.authOnboardingService.ensureUserProvisioned(user);

    this.authSessionService.clearNonceCookie(response);
    const session = this.authSessionService.issueSessionCookie(response, provisionedUser);

    return {
      authenticated: true,
      isNewUser: !existingUser,
      session,
      user: this.toAuthenticatedUser(provisionedUser),
    };
  }

  async getCurrentSession(request: AuthenticatedRequest) {
    const user = await this.resolveAuthenticatedUser(request);

    return {
      authenticated: user !== null,
      user,
    };
  }

  signOut(response: CookieWriter) {
    this.authSessionService.clearAuthCookies(response);

    return {
      success: true,
    };
  }

  async requireAuthenticatedUser(request: AuthenticatedRequest) {
    const user = await this.resolveAuthenticatedUser(request);

    if (!user) {
      throw new UnauthorizedException("Authentication is required.");
    }

    return user;
  }

  private parseSiweMessage(dto: VerifySiweRequestDto) {
    if (typeof dto.message !== "string" || dto.message.trim().length === 0) {
      throw new BadRequestException("message is required.");
    }

    if (typeof dto.signature !== "string" || dto.signature.trim().length === 0) {
      throw new BadRequestException("signature is required.");
    }

    try {
      return new SiweMessage(dto.message);
    } catch {
      throw new BadRequestException("Invalid SIWE message.");
    }
  }

  private async verifyMessageSignature(
    siweMessage: SiweMessage,
    signature: string,
    nonce: string,
  ) {
    const verification = await siweMessage.verify(
      {
        signature,
        nonce,
        time: new Date().toISOString(),
      },
      {
        suppressExceptions: true,
      },
    );

    if (!verification.success) {
      throw new UnauthorizedException(verification.error?.type || "SIWE verification failed.");
    }

    return verification.data;
  }

  private assertAllowedDomain(domain: string) {
    const allowedDomains = this.authSessionService.getAllowedDomains();

    if (!allowedDomains.includes(domain)) {
      throw new UnauthorizedException("SIWE domain is not allowed.");
    }
  }

  private assertAllowedUri(uri: string) {
    let normalizedOrigin = uri;

    try {
      normalizedOrigin = new URL(uri).origin;
    } catch {
      throw new UnauthorizedException("SIWE uri is invalid.");
    }

    const allowedUris = this.authSessionService.getAllowedUris();
    if (!allowedUris.includes(uri) && !allowedUris.includes(normalizedOrigin)) {
      throw new UnauthorizedException("SIWE uri is not allowed.");
    }
  }

  private async resolveAuthenticatedUser(request: AuthenticatedRequest) {
    const session = this.authSessionService.readSession(request);

    if (!session) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: session.sub,
      },
    });

    if (!user || user.walletAddress !== session.walletAddress) {
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      walletAddress: user.walletAddress,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      circleWalletId: user.circleWalletId,
      circleWalletAddress: user.circleWalletAddress,
      circleWalletBlockchain: user.circleWalletBlockchain,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
