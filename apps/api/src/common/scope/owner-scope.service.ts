import { Injectable, NotFoundException } from '@nestjs/common';
import type { OwnerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { bytesToUuid, toIdBytes, type IdBytes } from '../utils/id';

/** 已解析的数据域：所有账户 / 分类 / 流水 / 物品查询都必须带上它作为过滤条件。 */
export interface OwnerScope {
  ownerType: OwnerType;
  ownerId: IdBytes;
  /** 稳定字符串形式（日志与幂等键用） */
  key: string;
}

/** 越权与「不存在」返回同一个 404，避免通过状态码探测他人家庭是否存在（设计报告 8.3）。 */
export function scopeNotFound(): NotFoundException {
  return new NotFoundException({ code: 'SCOPE_NOT_FOUND', message: '数据域不存在或无权访问' });
}

/** 由记录自带的归属字段直接构造数据域（后台任务如自动结息无请求上下文）。 */
export function ownerScopeOf(ownerType: OwnerType, ownerId: IdBytes): OwnerScope {
  return { ownerType, ownerId, key: `${ownerType}:${bytesToUuid(ownerId)}` };
}

@Injectable()
export class OwnerScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 个人数据域（默认） */
  personal(userId: string): OwnerScope {
    const ownerId = toIdBytes(userId);
    if (!ownerId) throw scopeNotFound();
    return ownerScopeOf('user', ownerId);
  }

  /** 解析 `?domain=user` / `?domain=household:<id>`；非成员与不存在的家庭一律 404 */
  async resolve(userId: string, domain?: string | null): Promise<OwnerScope> {
    const raw = (domain ?? 'user').trim();
    if (raw === '' || raw === 'user') return this.personal(userId);

    const [type, id] = raw.split(':');
    if (type !== 'household' || !id) throw scopeNotFound();

    const householdId = toIdBytes(id);
    const memberUserId = toIdBytes(userId);
    if (!householdId || !memberUserId) throw scopeNotFound();

    const membership = await this.prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId, userId: memberUserId } },
      select: { id: true },
    });
    if (!membership) throw scopeNotFound();

    return ownerScopeOf('household', householdId);
  }

  /** 请求体里的 `owner: { type, id? }` 与 `?domain=` 等价，表单类接口用它 */
  resolveFromBody(userId: string, owner?: { type?: string; id?: string } | null): Promise<OwnerScope> {
    if (!owner || owner.type === 'user') return Promise.resolve(this.personal(userId));
    if (owner.type !== 'household' || !owner.id) throw scopeNotFound();
    return this.resolve(userId, `household:${owner.id}`);
  }

  /**
   * 已知记录自带的归属字段（如按 id 改分类 / 删流水时），校验调用者是否有权访问：
   * 个人域必须是本人，家庭域必须是成员；不满足一律 404，不暴露记录是否存在。
   *
   * `onDenied` 让调用方把「无权」与「记录不存在」收敛成同一个资源级错误码
   * （如 TRANSACTION_NOT_FOUND），否则两者返回不同 code 就能被用来探测他人记录是否存在。
   */
  async resolveOwned(
    userId: string,
    ownerType: OwnerType,
    ownerId: IdBytes,
    onDenied: () => Error = scopeNotFound,
  ): Promise<OwnerScope> {
    if (ownerType === 'household') {
      try {
        return await this.resolve(userId, `household:${bytesToUuid(ownerId)}`);
      } catch (error) {
        if (error instanceof NotFoundException) throw onDenied();
        throw error;
      }
    }
    const scope = this.personal(userId);
    if (bytesToUuid(scope.ownerId) !== bytesToUuid(ownerId)) throw onDenied();
    return scope;
  }

  /** 归属过滤条件（Prisma where 片段） */
  filter(scope: OwnerScope): { ownerType: OwnerType; ownerId: IdBytes } {
    return { ownerType: scope.ownerType, ownerId: scope.ownerId };
  }
}
