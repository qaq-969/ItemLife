import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SiteAdminOverviewDto, SiteInviteDto, SiteStatusDto, SiteUserDto } from '@itemlife/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/types/auth-user';
import { CreateSiteInviteDto, ResetSiteUserPasswordDto, UpdateRegistrationDto, UpdateSiteRoleDto, UpdateSiteUserStatusDto } from './dto/site-admin.dto';
import { SiteAdminService } from './site-admin.service';

@ApiTags('站点管理')
@Controller('site')
export class SiteAdminController {
  constructor(private readonly site: SiteAdminService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: '公开读取注册开关；尚无用户时允许创建首位超级管理员' })
  status(): Promise<SiteStatusDto> {
    return this.site.status();
  }

  @ApiBearerAuth()
  @Get('admin')
  @ApiOperation({ summary: '管理员读取站点设置、用户和邀请码' })
  overview(@CurrentUser() user: AuthenticatedUser): Promise<SiteAdminOverviewDto> {
    return this.site.overview(user.id);
  }

  @ApiBearerAuth()
  @Patch('admin/registration')
  @ApiOperation({ summary: '超级管理员开关公开注册' })
  updateRegistration(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRegistrationDto): Promise<SiteStatusDto> {
    return this.site.updateRegistration(user.id, dto.registrationOpen);
  }

  @ApiBearerAuth()
  @Post('admin/invites')
  @ApiOperation({ summary: '管理员在关闭公开注册时生成 7 天单次邀请码' })
  createInvite(@CurrentUser() user: AuthenticatedUser, @Body() dto?: CreateSiteInviteDto): Promise<SiteInviteDto> {
    return this.site.createInvite(user.id, dto?.remark);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Delete('admin/invites/:id')
  @ApiOperation({ summary: '管理员撤销未使用的邀请码' })
  revokeInvite(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.site.revokeInvite(user.id, id);
  }

  @ApiBearerAuth()
  @Patch('admin/users/:id/role')
  @ApiOperation({ summary: '超级管理员授予或移除站点管理员权限' })
  updateRole(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteRoleDto): Promise<SiteUserDto> {
    return this.site.updateRole(user.id, id, dto.role);
  }

  @ApiBearerAuth()
  @Patch('admin/users/:id/status')
  @ApiOperation({ summary: '管理员停用或恢复普通用户' })
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSiteUserStatusDto): Promise<SiteUserDto> {
    return this.site.updateStatus(user.id, id, dto.enabled);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Patch('admin/users/:id/password')
  @ApiOperation({ summary: '超级管理员重置其他用户密码并撤销其全部会话' })
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetSiteUserPasswordDto): Promise<null> {
    return this.site.resetPassword(user.id, id, dto.password);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Delete('admin/users/:id')
  @ApiOperation({ summary: '超级管理员永久删除已停用用户及其个人和自有家庭数据' })
  deleteUser(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.site.deleteUser(user.id, id);
  }
}
