import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Category, Prisma } from '@prisma/client';
import type { CategoryKind, SystemTag } from '@itemlife/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OwnerScopeService, type OwnerScope } from '../../common/scope/owner-scope.service';
import { bytesToUuid, newId, toIdBytes, type IdBytes } from '../../common/utils/id';
import type { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto';
import type { ListCategoriesQueryDto } from './dto/category-list.dto';
import { buildCategoryTree, CategoryVo } from './dto/category.vo';

/** 只依赖 category 委托：PrismaService 与事务客户端都能满足（预置写入要在事务里跑）。 */
export type CategoryClient = Pick<Prisma.TransactionClient, 'category'>;

export function categoryNotFound(): NotFoundException {
  return new NotFoundException({ code: 'CATEGORY_NOT_FOUND', message: '分类不存在或无权访问' });
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: OwnerScopeService,
  ) {}

  async list(userId: string, query: ListCategoriesQueryDto): Promise<CategoryVo[]> {
    const scope = await this.scopes.resolve(userId, query.domain);
    return this.treeOf(scope, query.kind, Boolean(query.includeArchived));
  }

  async create(userId: string, dto: CreateCategoryDto): Promise<CategoryVo> {
    const scope = await this.scopes.resolveFromBody(userId, dto.owner);
    const parentId = this.parseId(dto.parentId);
    if (parentId) await this.assertParentUsable(scope, parentId, dto.kind, null);

    const name = dto.name.trim();
    await this.assertNameFree(scope, dto.kind, parentId, name, null);

    const row = await this.prisma.category.create({
      data: {
        id: newId(),
        ...this.scopes.filter(scope),
        kind: dto.kind,
        name,
        icon: dto.icon ?? null,
        color: dto.color ?? null,
        parentId,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(this.prisma, scope, dto.kind, parentId)),
      },
    });
    return CategoryVo.from(row);
  }

  async update(userId: string, id: string, dto: UpdateCategoryDto): Promise<CategoryVo> {
    const { row, scope } = await this.requireCategory(userId, id);
    const parentId = dto.parentId === undefined ? row.parentId : this.parseId(dto.parentId);

    if (parentId && !sameId(parentId, row.parentId)) {
      await this.assertParentUsable(scope, parentId, row.kind as CategoryKind, row.id);
    }

    const name = dto.name?.trim();
    if (name && name !== row.name) {
      await this.assertNameFree(scope, row.kind as CategoryKind, parentId, name, row.id);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.category.update({
        where: { id: row.id },
        data: {
          ...(name ? { name } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.parentId !== undefined ? { parentId } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.archived === undefined ? {} : { archivedAt: dto.archived ? new Date() : null }),
        },
      });

      // 停用 / 恢复父分类时连带其子分类，避免出现「父不在、子还在」的悬空树
      if (dto.archived !== undefined && !row.parentId) {
        await tx.category.updateMany({
          where: { ...this.scopes.filter(scope), parentId: row.id, deletedAt: null },
          data: { archivedAt: dto.archived ? new Date() : null },
        });
      }
      return result;
    });

    return CategoryVo.from(updated);
  }

  /** 删除：分类已被流水引用时只能停用（设计报告 5.2 ⑦），这里统一转为 409 提示 */
  async remove(userId: string, id: string): Promise<null> {
    const { row, scope } = await this.requireCategory(userId, id);
    const children = await this.prisma.category.findMany({
      where: { ...this.scopes.filter(scope), parentId: row.id, deletedAt: null },
      select: { id: true },
    });
    const ids = [row.id, ...children.map((child) => child.id)];

    const used = await this.prisma.transaction.count({
      where: { ...this.scopes.filter(scope), categoryId: { in: ids }, deletedAt: null },
    });
    if (used > 0) {
      throw new ConflictException({
        code: 'CATEGORY_IN_USE',
        message: `该分类下有 ${used} 笔流水，删除会丢失账目溯源；请改用「停用」`,
      });
    }

    await this.prisma.category.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    return null;
  }

  /** 移动端拖拽排序 / 跨组移动：单请求批量落库，落库后回传整棵树 */
  async reorder(userId: string, dto: ReorderCategoriesDto): Promise<CategoryVo[]> {
    const scope = await this.scopes.resolveFromBody(userId, dto.owner);
    const wanted = new Map<string, IdBytes>();
    for (const item of dto.items) {
      const id = toIdBytes(item.id);
      if (!id) throw categoryNotFound();
      wanted.set(bytesToUuid(id), id);
    }

    const rows = await this.prisma.category.findMany({
      where: { ...this.scopes.filter(scope), id: { in: [...wanted.values()] }, deletedAt: null },
    });
    if (rows.length !== wanted.size) throw categoryNotFound();

    const updates: Array<Prisma.PrismaPromise<unknown>> = [];
    for (const item of dto.items) {
      const id = wanted.get(item.id);
      if (!id) throw categoryNotFound();

      if (item.parentId) {
        const parentId = this.parseId(item.parentId);
        if (!parentId) throw categoryNotFound();
        if (bytesToUuid(parentId) === item.id) throw selfParent();
        if (wanted.has(bytesToUuid(parentId))) {
          // 拖到本次同批移动的分类之下会形成两级以上的树
          throw new BadRequestException({ code: 'CATEGORY_DEPTH_EXCEEDED', message: '分类最多两级' });
        }
        await this.assertParentUsable(scope, parentId, rowKind(rows, item.id), null);
      }

      updates.push(
        this.prisma.category.update({
          where: { id },
          data: {
            sortOrder: item.sortOrder,
            ...(item.parentId === undefined ? {} : { parentId: this.parseId(item.parentId) }),
          },
        }),
      );
    }
    await this.prisma.$transaction(updates);

    return this.treeOf(scope, undefined, false);
  }

  /**
   * 结息等系统写入需要按 systemTag 找到归类分类；用户删掉预置分类时自动补建（幂等）。
   * 传入事务客户端，保证与调用方的写入同生共死。
   */
  async ensureSystemCategory(
    tx: CategoryClient,
    scope: OwnerScope,
    tag: SystemTag,
    fallback: { name: string; icon: string; color: string },
  ): Promise<IdBytes> {
    const existing = await tx.category.findFirst({
      where: { ...this.scopes.filter(scope), systemTag: tag, kind: 'income', deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.category.create({
      data: {
        id: newId(),
        ...this.scopes.filter(scope),
        kind: 'income',
        name: fallback.name,
        icon: fallback.icon,
        color: fallback.color,
        systemTag: tag,
        isSystem: true,
        sortOrder: await this.nextSortOrder(tx, scope, 'income', null),
      },
    });
    return created.id;
  }

  private async treeOf(scope: OwnerScope, kind?: CategoryKind, includeArchived = false): Promise<CategoryVo[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        ...this.scopes.filter(scope),
        deletedAt: null,
        ...(kind ? { kind } : {}),
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return buildCategoryTree(rows);
  }

  /** 按 id 定位分类，同时反查其数据域并校验调用者权限（越权与不存在同为 404）。 */
  private async requireCategory(
    userId: string,
    id: string,
  ): Promise<{ row: Category; scope: OwnerScope }> {
    const bytes = toIdBytes(id);
    const row = bytes
      ? await this.prisma.category.findFirst({ where: { id: bytes, deletedAt: null } })
      : null;
    if (!row) throw categoryNotFound();
    return { row, scope: await this.scopes.resolveOwned(userId, row.ownerType, row.ownerId, categoryNotFound) };
  }

  private async assertParentUsable(
    scope: OwnerScope,
    parentId: IdBytes,
    kind: CategoryKind,
    selfId: IdBytes | null,
  ): Promise<void> {
    if (selfId && sameId(selfId, parentId)) throw selfParent();

    const parent = await this.prisma.category.findFirst({
      where: { ...this.scopes.filter(scope), id: parentId, deletedAt: null },
    });
    if (!parent) {
      throw new BadRequestException({ code: 'PARENT_CATEGORY_INVALID', message: '父分类不存在' });
    }
    if (parent.parentId) {
      throw new BadRequestException({ code: 'CATEGORY_DEPTH_EXCEEDED', message: '分类最多两级' });
    }
    if (parent.kind !== kind) {
      throw new BadRequestException({ code: 'PARENT_CATEGORY_INVALID', message: '父分类必须同为收入或同为支出' });
    }
    if (parent.archivedAt) {
      throw new BadRequestException({ code: 'PARENT_CATEGORY_ARCHIVED', message: '父分类已停用，请先恢复' });
    }
  }

  private async assertNameFree(
    scope: OwnerScope,
    kind: CategoryKind,
    parentId: IdBytes | null,
    name: string,
    excludeId: IdBytes | null,
  ): Promise<void> {
    const existing = await this.prisma.category.findFirst({
      where: { ...this.scopes.filter(scope), kind, parentId, name, deletedAt: null },
      select: { id: true },
    });
    if (existing && !sameId(existing.id, excludeId)) {
      throw new ConflictException({ code: 'CATEGORY_NAME_TAKEN', message: '同级下已有同名分类' });
    }
  }

  private async nextSortOrder(
    client: CategoryClient,
    scope: OwnerScope,
    kind: CategoryKind,
    parentId: IdBytes | null,
  ): Promise<number> {
    const last = await client.category.findFirst({
      where: { ...this.scopes.filter(scope), kind, parentId, deletedAt: null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return last ? last.sortOrder + 1 : 0;
  }

  private parseId(value: string | null | undefined): IdBytes | null {
    if (value === null || value === undefined) return null;
    const bytes = toIdBytes(value);
    if (!bytes) throw new BadRequestException({ code: 'INVALID_ID', message: 'ID 格式不正确' });
    return bytes;
  }
}

function sameId(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right) return false;
  return bytesToUuid(left) === bytesToUuid(right);
}

function rowKind(rows: Category[], id: string): CategoryKind {
  const row = rows.find((candidate) => bytesToUuid(candidate.id) === id);
  return (row?.kind ?? 'expense') as CategoryKind;
}

function selfParent(): BadRequestException {
  return new BadRequestException({ code: 'CATEGORY_SELF_PARENT', message: '父分类不能是自己' });
}
