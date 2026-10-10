import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { HouseholdDto, HouseholdInviteDto, HouseholdMemberDto } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import {
  CreateHouseholdDto,
  CreateInviteDto,
  DeleteHouseholdDto,
  JoinHouseholdDto,
  UpdateHouseholdDto,
  UpdateHouseholdMemberRoleDto,
} from './dto/family.dto';
import { FamilyService } from './family.service';

@ApiBearerAuth()
@ApiTags('家庭')
@Controller('households')
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get()
  @ApiOperation({ summary: '我加入的家庭' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<HouseholdDto[]> { return this.family.list(user.id); }

  @Post()
  @ApiOperation({ summary: '创建家庭，同时创建 owner 成员关系与预置分类' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateHouseholdDto): Promise<HouseholdDto> {
    return this.family.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '创建者修改家庭名称' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHouseholdDto): Promise<HouseholdDto> {
    return this.family.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '创建者永久删除家庭及其全部数据' })
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteHouseholdDto): Promise<null> {
    return this.family.delete(user.id, id, dto);
  }

  @Post('join')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '凭 8 位邀请码加入家庭' })
  join(@CurrentUser() user: AuthenticatedUser, @Body() dto: JoinHouseholdDto): Promise<HouseholdDto> {
    return this.family.join(user.id, dto);
  }

  @Get(':id/members')
  members(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<HouseholdMemberDto[]> {
    return this.family.members(user.id, id);
  }

  @Delete(':id/members')
  leave(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.family.leave(user.id, id);
  }

  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) memberId: string): Promise<null> {
    return this.family.removeMember(user.id, id, memberId);
  }

  @Patch(':id/members/:userId')
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateHouseholdMemberRoleDto,
  ): Promise<HouseholdMemberDto> {
    return this.family.updateMemberRole(user.id, id, memberId, dto);
  }

  @Get(':id/invites')
  invites(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<HouseholdInviteDto[]> {
    return this.family.invites(user.id, id);
  }

  @Post(':id/invites')
  @HttpCode(HttpStatus.CREATED)
  createInvite(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInviteDto): Promise<HouseholdInviteDto> {
    return this.family.createInvite(user.id, id, dto);
  }

  @Delete(':id/invites/:inviteId')
  revokeInvite(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('inviteId', ParseUUIDPipe) inviteId: string): Promise<null> {
    return this.family.revokeInvite(user.id, id, inviteId);
  }
}
