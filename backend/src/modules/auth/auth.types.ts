import { type Request } from "express";
import { type UserModel as User } from "../../generated/prisma/models/User.js";

export type AuthenticatedUser = Pick<
  User,
  | "id"
  | "walletAddress"
  | "displayName"
  | "avatarUrl"
  | "circleWalletId"
  | "circleWalletAddress"
  | "circleWalletBlockchain"
  | "createdAt"
  | "updatedAt"
>;

export type SessionCookiePayload = {
  sid: string;
  sub: string;
  walletAddress: string;
  iat: number;
  exp: number;
};

export type NonceCookiePayload = {
  nonce: string;
  exp: number;
};

export type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
};
