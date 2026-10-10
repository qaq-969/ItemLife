import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { checkPasswordStrength, type SiteAdminOverviewDto, type SiteInviteDto, type SiteStatusDto, type SiteUserDto } from '@itemlife/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { deleteOwnerData } from '../../common/utils/delete-owner-data';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

@Injectable()
export class SiteAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async status(): Promise<SiteStatusDto> {
    const [settings, userCount] = await Promise.all([
      this.prisma.siteSettings.findUnique({ where: { id: 1 } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { registrationOpen: settings?.registrationOpen ?? true, initialized: userCount > 0 };
  }

  async overview(userId: string): Promise<SiteAdminOverviewDto> {
    await this.requireManager(userId);
    const [status, users, invites] = await Promise.all([
      this.status(),
      this.prisma.user.findMany({ where: { deletedAt: null }, include: { registrationInvite: { select: { remark: true } } }, orderBy: [{ createdAt: 'asc' }, { email: 'asc' }] }),
      this.prisma.siteInvite.findMany({ include: { creator: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return {
      ...status,
      users: users.map((row) => this.userVo(row)),
      invites: invites.map((row) => this.inviteVo(row)),
    };
  }

  async updateRegistration(userId: string, registrationOpen: boolean): Promise<SiteStatusDto> {
    await this.requireSuperAdmin(userId);
    await this.prisma.siteSettings.update({ where: { id: 1 }, data: { registrationOpen } });
    this.audit.record('site.registration.updated', { userId, registrationOpen });
    return this.status();
  }

  async createInvite(userId: string, remark?: string): Promise<SiteInviteDto> {
    const actor = await this.requireManager(userId);
    const settings = await this.prisma.siteSettings.findUnique({ where: { id: 1 } });
    if (settings?.registrationOpen ?? true) {
      throw new ConflictException({ code: 'REGISTRATION_IS_OPEN', message: '公开注册开启时无需生成邀请码' });
    }
    const code = this.inviteCode();
    const row = await this.prisma.siteInvite.create({
      data: {
        id: newId(),
        codeHash: this.crypto.sha256Hex(code),
        remark: remark?.trim() || null,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdBy: actor.id,
      },
      include: { creator: true },
    });
    this.audit.record('site.invite.created', { userId, inviteId: bytesToUuid(row.id) });
    return { ...this.inviteVo(row), code };
  }

  async revokeInvite(userId: string, inviteId: string): Promise<null> {
    await this.requireManager(userId);
    const id = toIdBytes(inviteId);
    const invite = id ? await this.prisma.siteInvite.findUnique({ where: { id } }) : null;
    if (!invite) throw this.notFound();
    await this.prisma.siteInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    this.audit.record('site.invite.revoked', { userId, inviteId });
    return null;
  }

  async updateRole(userId: string, targetUserId: string, role: 'admin' | 'user'): Promise<SiteUserDto> {
    await this.requireSuperAdmin(userId);
    if (userId === targetUserId) {
      throw new ConflictException({ code: 'SITE_ROLE_SELF_FORBIDDEN', message: '不能修改自己的超级管理员身份' });
    }
    const target = await this.requireUser(targetUserId);
    if (target.siteRole === 'super_admin') {
      throw new ForbiddenException({ code: 'SUPER_ADMIN_IMMUTABLE', message: '不能修改超级管理员身份' });
    }
    if (target.disabledAt && role === 'admin') {
      throw new ConflictException({ code: 'DISABLED_USER_ROLE', message: '请先恢复该用户，再设为管理员' });
    }
    const updated = await this.prisma.user.update({ where: { id: target.id }, data: { siteRole: role } });
    this.audit.record('site.user.role_updated', { userId, targetUserId, role });
    return this.userVo(updated);
  }

  async updateStatus(userId: string, targetUserId: string, enabled: boolean): Promise<SiteUserDto> {
    await this.requireManager(userId);
    if (userId === targetUserId) {
      throw new ConflictException({ code: 'SITE_USER_SELF_FORBIDDEN', message: '不能停用自己的账号' });
    }
    const target = await this.requireUser(targetUserId);
    if (target.siteRole !== 'user') {
      throw new ForbiddenException({ code: 'SITE_USER_ROLE_FORBIDDEN', message: '只能停用或恢复普通用户；请先移除管理员权限' });
    }
    const disabledAt = enabled ? null : new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id: target.id }, data: { disabledAt } });
      if (!enabled) {
        await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: disabledAt } });
      }
      return row;
    });
    this.audit.record(enabled ? 'site.user.enabled' : 'site.user.disabled', { userId, targetUserId });
    return this.userVo(updated);
  }

  async resetPassword(userId: string, targetUserId: string, password: string): Promise<null> {
    await this.requireSuperAdmin(userId);
    const target = await this.requireMutableUser(userId, targetUserId);
    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      throw new BadRequestException({ code: 'PASSWORD_TOO_WEAK', message: `密码强度不足：${strength.issues.join('；')}` });
    }
    const passwordHash = await this.crypto.hashPassword(password);
    const revokedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt } });
    });
    this.audit.record('site.user.password_reset', { userId, targetUserId });
    return null;
  }

  async deleteUser(userId: string, targetUserId: string): Promise<null> {
    await this.requireSuperAdmin(userId);
    const target = await this.requireMutableUser(userId, targetUserId);
    if (!target.disabledAt) {
      throw new ConflictException({ code: 'SITE_USER_NOT_DISABLED', message: '请先停用该用户，再执行永久删除' });
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const households = await tx.household.findMany({ where: { ownerUserId: target.id }, select: { id: true } });
      for (const household of households) {
        await deleteOwnerData(tx, 'household', household.id);
        await tx.householdInvite.deleteMany({ where: { householdId: household.id } });
        await tx.householdMember.deleteMany({ where: { householdId: household.id } });
        await tx.household.deleteMany({ where: { id: household.id } });
      }
      await deleteOwnerData(tx, 'user', target.id);
      await tx.householdInvite.deleteMany({ where: { createdBy: target.id } });
      await tx.householdMember.deleteMany({ where: { userId: target.id } });
      await tx.user.deleteMany({ where: { id: target.id } });
    });
    this.audit.record('site.user.deleted', { userId, targetUserId, targetEmail: target.email });
    return null;
  }

  private async requireManager(userId: string) {
    const user = await this.requireUser(userId);
    if (user.disabledAt || (user.siteRole !== 'super_admin' && user.siteRole !== 'admin')) {
      throw new ForbiddenException({ code: 'SITE_ADMIN_REQUIRED', message: '仅站点管理员可以执行此操作' });
    }
    return user;
  }

  private async requireSuperAdmin(userId: string) {
    const user = await this.requireUser(userId);
    if (user.disabledAt || user.siteRole !== 'super_admin') {
      throw new ForbiddenException({ code: 'SUPER_ADMIN_REQUIRED', message: '仅超级管理员可以执行此操作' });
    }
    return user;
  }

  private async requireMutableUser(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new ConflictException({ code: 'SITE_USER_SELF_FORBIDDEN', message: '不能对自己的超级管理员账号执行此操作' });
    }
    const target = await this.requireUser(targetUserId);
    if (target.siteRole === 'super_admin') {
      throw new ForbiddenException({ code: 'SUPER_ADMIN_IMMUTABLE', message: '不能修改超级管理员账号' });
    }
    return target;
  }

  private async requireUser(userId: string) {
    const id = toIdBytes(userId);
    const user = id ? await this.prisma.user.findFirst({ where: { id, deletedAt: null } }) : null;
    if (!user) throw this.notFound();
    return user;
  }

  private userVo(row: { id: IdBytes; email: string; nickname: string | null; siteRole: 'super_admin' | 'admin' | 'user'; disabledAt: Date | null; createdAt: Date; registrationInvite?: { remark: string | null } | null }): SiteUserDto {
    return {
      id: bytesToUuid(row.id), email: row.email, nickname: row.nickname, siteRole: row.siteRole,
      inviteRemark: row.registrationInvite?.remark ?? null,
      disabledAt: row.disabledAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    };
  }

  private inviteVo(row: { id: IdBytes; remark: string | null; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; createdAt: Date; creator: { email: string } | null }): SiteInviteDto {
    return {
      id: bytesToUuid(row.id), remark: row.remark, expiresAt: row.expiresAt.toISOString(), usedAt: row.usedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), createdByEmail: row.creator?.email ?? '已删除用户',
    };
  }

  private inviteCode(): string {
    return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'SITE_RESOURCE_NOT_FOUND', message: '用户或邀请码不存在' });
  }
}
