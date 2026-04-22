import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { type UserModel as User } from "../../generated/prisma/models/User.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { type UpdateCurrentUserDto } from "./dto/update-current-user.dto.js";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException("User was not found.");
    }

    return this.toUserProfile(user);
  }

  async updateCurrentUserProfile(userId: string, dto: UpdateCurrentUserDto) {
    const data = this.normalizeProfileUpdate(dto);

    const user = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data,
    });

    return this.toUserProfile(user);
  }

  private normalizeProfileUpdate(dto: UpdateCurrentUserDto) {
    const nextData: { displayName?: string | null; email?: string | null } = {};

    if (dto.displayName !== undefined) {
      if (typeof dto.displayName !== "string") {
        throw new BadRequestException("displayName must be a string.");
      }

      const trimmedDisplayName = dto.displayName.trim();

      if (trimmedDisplayName.length > 80) {
        throw new BadRequestException("displayName must be at most 80 characters.");
      }

      nextData.displayName = trimmedDisplayName.length > 0 ? trimmedDisplayName : null;
    }

    if (dto.email !== undefined) {
      if (typeof dto.email !== "string") {
        throw new BadRequestException("email must be a string.");
      }

      const trimmedEmail = dto.email.trim();

      if (trimmedEmail.length > 120) {
        throw new BadRequestException("email must be at most 120 characters.");
      }

      if (trimmedEmail.length > 0 && !this.isValidEmail(trimmedEmail)) {
        throw new BadRequestException("email must be a valid email address.");
      }

      nextData.email = trimmedEmail.length > 0 ? trimmedEmail : null;
    }

    if (Object.keys(nextData).length === 0) {
      throw new BadRequestException("At least one profile field must be provided.");
    }

    return nextData;
  }

  private isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
  }

  private toUserProfile(user: User) {
    return {
      id: user.id,
      walletAddress: user.walletAddress,
      displayName: user.displayName,
      email: user.email ?? null,
      circleWalletId: user.circleWalletId,
      circleWalletAddress: user.circleWalletAddress,
      circleWalletBlockchain: user.circleWalletBlockchain,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
