import { type CookieOptions } from "express";

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";
const DEFAULT_COOKIE_NAME = "ocean_session";
const DEFAULT_NONCE_COOKIE_NAME = "ocean_siwe_nonce";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_NONCE_TTL_SECONDS = 60 * 5;
const DEFAULT_COOKIE_SAME_SITE: CookieOptions["sameSite"] = "lax";
const INSECURE_DEV_SESSION_SECRET = "ocean-local-dev-session-secret-change-me";

type AuthConfig = {
  sessionCookieName: string;
  nonceCookieName: string;
  sessionTtlSeconds: number;
  nonceTtlSeconds: number;
  cookieSecure: boolean;
  cookieSameSite: CookieOptions["sameSite"];
  cookieDomain?: string;
  sessionSecret: string;
  allowedOrigins: string[];
  allowedDomains: string[];
  allowedUris: string[];
};

function parseList(value: string | undefined, fallback: string[]) {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parsed && parsed.length > 0 ? parsed : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSameSite(value: string | undefined): CookieOptions["sameSite"] {
  if (value === "strict" || value === "lax" || value === "none") {
    return value;
  }

  return DEFAULT_COOKIE_SAME_SITE;
}

function resolveSessionSecret() {
  const configuredSecret = process.env.AUTH_SESSION_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if ((process.env.NODE_ENV ?? "development") !== "production") {
    return INSECURE_DEV_SESSION_SECRET;
  }

  throw new Error("AUTH_SESSION_SECRET is required in production.");
}

function buildAllowedDomains(origins: string[]) {
  return origins.map((origin) => new URL(origin).host);
}

export function resolveFrontendOrigins() {
  return parseList(process.env.FRONTEND_ORIGIN, [DEFAULT_FRONTEND_ORIGIN]);
}

export function resolveAuthConfig(): AuthConfig {
  const allowedOrigins = resolveFrontendOrigins();

  return {
    sessionCookieName: process.env.AUTH_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME,
    nonceCookieName: process.env.AUTH_NONCE_COOKIE_NAME?.trim() || DEFAULT_NONCE_COOKIE_NAME,
    sessionTtlSeconds: parsePositiveInteger(
      process.env.AUTH_SESSION_TTL_SECONDS,
      DEFAULT_SESSION_TTL_SECONDS,
    ),
    nonceTtlSeconds: parsePositiveInteger(
      process.env.AUTH_NONCE_TTL_SECONDS,
      DEFAULT_NONCE_TTL_SECONDS,
    ),
    cookieSecure:
      process.env.AUTH_COOKIE_SECURE === "true" || (process.env.NODE_ENV ?? "development") === "production",
    cookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAME_SITE),
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined,
    sessionSecret: resolveSessionSecret(),
    allowedOrigins,
    allowedDomains: parseList(
      process.env.SIWE_ALLOWED_DOMAINS,
      buildAllowedDomains(allowedOrigins),
    ),
    allowedUris: parseList(process.env.SIWE_ALLOWED_URIS, allowedOrigins),
  };
}
