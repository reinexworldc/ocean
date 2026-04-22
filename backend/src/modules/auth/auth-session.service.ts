import { Injectable } from "@nestjs/common";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { generateNonce } from "siwe";
import { resolveAuthConfig } from "./auth.config.js";
import {
  type AuthenticatedRequest,
  type NonceCookiePayload,
  type SessionCookiePayload,
} from "./auth.types.js";

type CookiePayload = NonceCookiePayload | SessionCookiePayload;

@Injectable()
export class AuthSessionService {
  private readonly config = resolveAuthConfig();

  issueNonceCookie(response: {
    cookie: (name: string, value: string, options: Record<string, unknown>) => void;
  }) {
    const nonce = generateNonce();
    const expiresAt = Date.now() + this.config.nonceTtlSeconds * 1000;

    this.setSignedCookie(
      response,
      this.config.nonceCookieName,
      {
        nonce,
        exp: expiresAt,
      },
      expiresAt,
    );

    return {
      nonce,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  issueSessionCookie(
    response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => void;
    },
    user: { id: string; walletAddress: string },
  ) {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + this.config.sessionTtlSeconds * 1000;

    const payload: SessionCookiePayload = {
      sid: randomUUID(),
      sub: user.id,
      walletAddress: user.walletAddress,
      iat: issuedAt,
      exp: expiresAt,
    };

    this.setSignedCookie(response, this.config.sessionCookieName, payload, expiresAt);

    return {
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  readNonce(request: AuthenticatedRequest) {
    const payload = this.readSignedCookie<NonceCookiePayload>(
      request,
      this.config.nonceCookieName,
    );

    return payload?.nonce ?? null;
  }

  readSession(request: AuthenticatedRequest) {
    return this.readSignedCookie<SessionCookiePayload>(request, this.config.sessionCookieName);
  }

  clearAuthCookies(response: {
    clearCookie: (name: string, options: Record<string, unknown>) => void;
  }) {
    this.clearSessionCookie(response);
    this.clearNonceCookie(response);
  }

  clearSessionCookie(response: {
    clearCookie: (name: string, options: Record<string, unknown>) => void;
  }) {
    response.clearCookie(this.config.sessionCookieName, this.buildCookieOptions());
  }

  clearNonceCookie(response: {
    clearCookie: (name: string, options: Record<string, unknown>) => void;
  }) {
    response.clearCookie(this.config.nonceCookieName, this.buildCookieOptions());
  }

  getAllowedDomains() {
    return this.config.allowedDomains;
  }

  getAllowedUris() {
    return this.config.allowedUris;
  }

  getAllowedOrigins() {
    return this.config.allowedOrigins;
  }

  private setSignedCookie(
    response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => void;
    },
    name: string,
    payload: CookiePayload,
    expiresAt: number,
  ) {
    response.cookie(name, this.signPayload(payload), this.buildCookieOptions(expiresAt));
  }

  private readSignedCookie<T extends CookiePayload>(request: AuthenticatedRequest, name: string) {
    const rawCookieValue = request.cookies?.[name];

    if (typeof rawCookieValue !== "string" || rawCookieValue.length === 0) {
      return null;
    }

    const [encodedPayload, providedSignature] = rawCookieValue.split(".");
    if (!encodedPayload || !providedSignature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    if (!this.isMatchingSignature(providedSignature, expectedSignature)) {
      return null;
    }

    try {
      const decodedPayload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as T;

      if (typeof decodedPayload.exp !== "number" || decodedPayload.exp <= Date.now()) {
        return null;
      }

      return decodedPayload;
    } catch {
      return null;
    }
  }

  private signPayload(payload: CookiePayload) {
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  private sign(value: string) {
    return createHmac("sha256", this.config.sessionSecret).update(value).digest("base64url");
  }

  private isMatchingSignature(providedSignature: string, expectedSignature: string) {
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private buildCookieOptions(expiresAt?: number) {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      domain: this.config.cookieDomain,
      path: "/",
      expires: expiresAt ? new Date(expiresAt) : new Date(0),
    };
  }
}
