import { createHash, randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { HouseholdDto, HouseholdInviteDto, HouseholdMemberDto } from '@itemlife/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import { seedPresetCategories } from '../categories/category-presets';
import type {
  CreateHouseholdDto,
  CreateInviteDto,
  DeleteHouseholdDto,
  JoinHouseholdDto,
  UpdateHouseholdDto,
  UpdateHouseholdMemberRoleDto,
} from './dto/family.dto';

const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function familyNotFound(): NotFoundException {
  return new NotFoundException({ code: 'HOUSEHOLD_NOT_FOUND', message: '家庭不存在或无权访问' });
}

@Injectable()
export class FamilyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<HouseholdDto[]> {
    const userBytes = this.userBytes(userId);
    const memberships = await this.prisma.householdMember.findMany({
      where: { userId: userBytes },
      include: { household: true },
      orderBy: { joinedAt: 'asc' },
    });
    return Promise.all(memberships.map(async (membership) => ({
      id: bytesToUuid(membership.household.id),
      name: membership.household.name,
      role: membership.role,
      memberCount: await this.prisma.householdMember.count({ where: { householdId: membership.householdId } }),
      createdAt: membership.household.createdAt.toISOString(),
    })));
  }

  async create(userId: string, dto: CreateHouseholdDto): Promise<HouseholdDto> {
    const ownerUserId = this.userBytes(userId);
    const householdId = newId();
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ code: 'HOUSEHOLD_NAME_REQUIRED', message: '家庭名称不能为空' });
    const created = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const household = await tx.household.create({ data: { id: householdId, name, ownerUserId } });
      await tx.householdMember.create({
        data: { id: newId(), householdId, userId: ownerUserId, role: 'owner' },
      });
      await seedPresetCategories(tx, { ownerType: 'household', ownerId: householdId });
      return household;
    });
    this.audit.record('family.household.created', { userId, householdId: bytesToUuid(householdId) });
    return { id: bytesToUuid(householdId), name, role: 'owner', memberCount: 1, createdAt: created.createdAt.toISOString() };
  }

  async update(userId: string, householdId: string, dto: UpdateHouseholdDto): Promise<HouseholdDto> {
    const id = await this.requireOwner(userId, householdId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ code: 'HOUSEHOLD_NAME_REQUIRED', message: '家庭名称不能为空' });
    const household = await this.prisma.household.update({ where: { id }, data: { name } });
    const memberCount = await this.prisma.householdMember.count({ where: { householdId: id } });
    this.audit.record('family.household.updated', { userId, householdId, name: household.name });
    return {
      id: householdId, name: household.name, role: 'owner', memberCount,
      createdAt: household.createdAt.toISOString(),
    };
  }

  async delete(userId: string, householdId: string, dto: DeleteHouseholdDto): Promise<null> {
    const id = await this.requireOwner(userId, householdId);
    const household = await this.prisma.household.findUnique({ where: { id } });
    if (!household) throw familyNotFound();
    if (dto.confirmationName.trim() !== household.name) {
      throw new BadRequestException({ code: 'HOUSEHOLD_NAME_MISMATCH', message: '输入的家庭名称不一致' });
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [items, transactions] = await Promise.all([
        tx.item.findMany({ where: { ownerType: 'household', ownerId: id }, select: { id: true } }),
        tx.transaction.findMany({ where: { ownerType: 'household', ownerId: id }, select: { id: true } }),
      ]);
      const itemIds = items.map((row) => row.id);
      const transactionIds = transactions.map((row) => row.id);
      const linkedRows = [
        ...(itemIds.length ? [{ itemId: { in: itemIds } }] : []),
        ...(transactionIds.length ? [{ transactionId: { in: transactionIds } }] : []),
      ];

      if (itemIds.length > 0) await tx.inventoryRevert.deleteMany({ where: { itemId: { in: itemIds } } });
      if (linkedRows.length > 0) {
        await tx.transactionItem.updateMany({ where: { OR: linkedRows }, data: { parentId: null } });
        await tx.transactionItem.deleteMany({ where: { OR: linkedRows } });
      }
      if (itemIds.length > 0) {
        await tx.accessoryUsage.deleteMany({ where: { itemId: { in: itemIds } } });
        await tx.itemAccessory.deleteMany({ where: { itemId: { in: itemIds } } });
        await tx.item.updateMany({ where: { id: { in: itemIds } }, data: { parentItemId: null, purchaseTransactionId: null } });
        await tx.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (transactionIds.length > 0) await tx.transaction.deleteMany({ where: { id: { in: transactionIds } } });
      await tx.category.updateMany({ where: { ownerType: 'household', ownerId: id }, data: { parentId: null } });
      await tx.category.deleteMany({ where: { ownerType: 'household', ownerId: id } });
      await tx.account.deleteMany({ where: { ownerType: 'household', ownerId: id } });
      await tx.householdInvite.deleteMany({ where: { householdId: id } });
      await tx.householdMember.deleteMany({ where: { householdId: id } });
      await tx.household.deleteMany({ where: { id } });
    });
    this.audit.record('family.household.deleted', { userId, householdId, name: household.name });
    return null;
  }

  async members(userId: string, householdId: string): Promise<HouseholdMemberDto[]> {
    const id = await this.requireMember(userId, householdId);
    const rows = await this.prisma.householdMember.findMany({
      where: { householdId: id },
      include: { user: true },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return rows.map((row) => ({
      userId: bytesToUuid(row.userId),
      email: row.user.email,
      nickname: row.user.nickname,
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    }));
  }

  async invites(userId: string, householdId: string): Promise<HouseholdInviteDto[]> {
    const id = await this.requireManager(userId, householdId);
    const rows = await this.prisma.householdInvite.findMany({
      where: { householdId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.inviteVo(row));
  }

  async createInvite(userId: string, householdId: string, dto: CreateInviteDto): Promise<HouseholdInviteDto> {
    const id = await this.requireManager(userId, householdId);
    const code = this.inviteCode();
    const row = await this.prisma.householdInvite.create({
      data: {
        id: newId(),
        householdId: id,
        codeHash: this.hashCode(code),
        expiresAt: new Date(Date.now() + (dto.expiresInHours ?? 72) * 3_600_000),
        maxUses: dto.maxUses ?? 5,
        createdBy: this.userBytes(userId),
      },
    });
    this.audit.record('family.invite.created', { userId, householdId, inviteId: bytesToUuid(row.id) });
    return { ...this.inviteVo(row), code };
  }

  async revokeInvite(userId: string, householdId: string, inviteId: string): Promise<null> {
    const id = await this.requireManager(userId, householdId);
    const inviteBytes = toIdBytes(inviteId);
    const row = inviteBytes ? await this.prisma.householdInvite.findFirst({ where: { id: inviteBytes, householdId: id } }) : null;
    if (!row) throw familyNotFound();
    await this.prisma.householdInvite.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    this.audit.record('family.invite.revoked', { userId, householdId, inviteId });
    return null;
  }

  async join(userId: string, dto: JoinHouseholdDto): Promise<HouseholdDto> {
    const codeHash = this.hashCode(dto.code);
    const invite = await this.prisma.householdInvite.findUnique({ where: { codeHash }, include: { household: true } });
    if (!invite || invite.revokedAt || invite.expiresAt.getTime() <= Date.now() || invite.usedCount >= invite.maxUses) {
      throw new NotFoundException({ code: 'INVITE_INVALID', message: '邀请码无效、已过期或已用尽' });
    }
    const userBytes = this.userBytes(userId);
    const existing = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: invite.householdId, userId: userBytes } },
    });
    if (existing) throw new ConflictException({ code: 'ALREADY_MEMBER', message: '你已经是该家庭成员' });

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.householdInvite.updateMany({
        where: { id: invite.id, usedCount: invite.usedCount, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedCount: invite.usedCount + 1 },
      });
      if (claimed.count === 0) {
        throw new NotFoundException({ code: 'INVITE_INVALID', message: '邀请码无效、已过期或已用尽' });
      }
      await tx.householdMember.create({
        data: { id: newId(), householdId: invite.householdId, userId: userBytes, role: 'member' },
      });
    });
    this.audit.record('family.member.joined', { userId, householdId: bytesToUuid(invite.householdId) });
    const memberCount = await this.prisma.householdMember.count({ where: { householdId: invite.householdId } });
    return {
      id: bytesToUuid(invite.household.id), name: invite.household.name, role: 'member', memberCount,
      createdAt: invite.household.createdAt.toISOString(),
    };
  }

  async removeMember(userId: string, householdId: string, memberUserId: string): Promise<null> {
    const actor = await this.requireMembership(userId, householdId);
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new ForbiddenException({ code: 'HOUSEHOLD_MANAGER_REQUIRED', message: '仅家庭创建者或管理员可以执行此操作' });
    }
    if (memberUserId === userId) throw new ConflictException({ code: 'MEMBER_CANNOT_REMOVE_SELF', message: '不能移除自己，请使用退出家庭' });
    const target = toIdBytes(memberUserId);
    if (!target) throw familyNotFound();
    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: actor.id, userId: target } },
    });
    if (!membership || membership.role === 'owner') throw familyNotFound();
    if (actor.role === 'admin' && membership.role !== 'member') {
      throw new ForbiddenException({ code: 'ADMIN_CANNOT_MANAGE_ADMIN', message: '管理员只能移除普通成员' });
    }
    const result = await this.prisma.householdMember.deleteMany({ where: { householdId: actor.id, userId: target } });
    if (result.count === 0) throw familyNotFound();
    this.audit.record('family.member.removed', { userId, householdId, memberUserId });
    return null;
  }

  async updateMemberRole(
    userId: string,
    householdId: string,
    memberUserId: string,
    dto: UpdateHouseholdMemberRoleDto,
  ): Promise<HouseholdMemberDto> {
    const id = await this.requireOwner(userId, householdId);
    if (memberUserId === userId) {
      throw new ConflictException({ code: 'OWNER_ROLE_FIXED', message: '家庭创建者权限不能修改' });
    }
    const target = toIdBytes(memberUserId);
    if (!target) throw familyNotFound();
    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: id, userId: target } }, include: { user: true },
    });
    if (!membership || membership.role === 'owner') throw familyNotFound();
    const updated = await this.prisma.householdMember.update({
      where: { id: membership.id }, data: { role: dto.role }, include: { user: true },
    });
    this.audit.record('family.member.role_updated', { userId, householdId, memberUserId, role: dto.role });
    return {
      userId: memberUserId, email: updated.user.email, nickname: updated.user.nickname,
      role: updated.role, joinedAt: updated.joinedAt.toISOString(),
    };
  }

  async leave(userId: string, householdId: string): Promise<null> {
    const id = await this.requireMember(userId, householdId);
    const userBytes = this.userBytes(userId);
    const membership = await this.prisma.householdMember.findUnique({ where: { householdId_userId: { householdId: id, userId: userBytes } } });
    if (membership?.role === 'owner') throw new ConflictException({ code: 'OWNER_CANNOT_LEAVE', message: '家庭创建者不能退出家庭' });
    await this.prisma.householdMember.deleteMany({ where: { householdId: id, userId: userBytes } });
    this.audit.record('family.member.left', { userId, householdId });
    return null;
  }

  private async requireMember(userId: string, householdId: string): Promise<IdBytes> {
    return (await this.requireMembership(userId, householdId)).id;
  }

  private async requireMembership(userId: string, householdId: string): Promise<{ id: IdBytes; role: 'owner' | 'admin' | 'member' }> {
    const id = toIdBytes(householdId);
    const userBytes = this.userBytes(userId);
    if (!id) throw familyNotFound();
    const membership = await this.prisma.householdMember.findUnique({ where: { householdId_userId: { householdId: id, userId: userBytes } } });
    if (!membership) throw familyNotFound();
    return { id, role: membership.role };
  }

  private async requireManager(userId: string, householdId: string): Promise<IdBytes> {
    const membership = await this.requireMembership(userId, householdId);
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ForbiddenException({ code: 'HOUSEHOLD_MANAGER_REQUIRED', message: '仅家庭创建者或管理员可以执行此操作' });
    }
    return membership.id;
  }

  private async requireOwner(userId: string, householdId: string): Promise<IdBytes> {
    const id = await this.requireMember(userId, householdId);
    const household = await this.prisma.household.findUnique({ where: { id } });
    if (!household || bytesToUuid(household.ownerUserId) !== userId) {
      throw new ForbiddenException({ code: 'HOUSEHOLD_OWNER_REQUIRED', message: '仅家庭创建者可以执行此操作' });
    }
    return id;
  }

  private userBytes(userId: string): IdBytes {
    const bytes = toIdBytes(userId);
    if (!bytes) throw familyNotFound();
    return bytes;
  }

  private inviteCode(): string {
    return Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
  }

  private inviteVo(row: { id: IdBytes; expiresAt: Date; maxUses: number; usedCount: number; revokedAt: Date | null; createdAt: Date }): HouseholdInviteDto {
    return {
      id: bytesToUuid(row.id), expiresAt: row.expiresAt.toISOString(), maxUses: row.maxUses,
      usedCount: row.usedCount, revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    };
  }
}
