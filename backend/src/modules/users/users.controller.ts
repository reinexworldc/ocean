import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { type AuthenticatedUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { type UpdateCurrentUserDto } from "./dto/update-current-user.dto.js";
import { UsersService } from "./users.service.js";

@Controller("users")
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  getCurrentUserProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getCurrentUserProfile(user.id);
  }

  @Patch("me")
  updateCurrentUserProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCurrentUserDto,
  ) {
    return this.usersService.updateCurrentUserProfile(user.id, dto);
  }
}
