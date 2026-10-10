import type { Prisma } from '@prisma/client';
import { CATEGORY_KINDS, PRESET_CATEGORIES } from '@itemlife/shared';
import { newId, type IdBytes } from '../../common/utils/id';

/**
 * 把预置分类复制到某个数据域（注册时、以及后续建家庭时调用，设计报告 5.2 ⑦）。
 * 之后分类可自由增删改；结息所需的 systemTag='interest' 分类若被删除会自动补建。
 */
export async function seedPresetCategories(
  tx: Pick<Prisma.TransactionClient, 'category'>,
  owner: { ownerType: 'user' | 'household'; ownerId: IdBytes },
): Promise<number> {
  const rows: Prisma.CategoryCreateManyInput[] = [];

  for (const kind of CATEGORY_KINDS) {
    PRESET_CATEGORIES[kind].forEach((preset, index) => {
      const parentId = newId();
      rows.push({
        id: parentId,
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        kind,
        name: preset.name,
        icon: preset.icon,
        color: preset.color,
        sortOrder: index,
        systemTag: preset.systemTag ?? null,
        isSystem: Boolean(preset.systemTag),
      });

      (preset.children ?? []).forEach((child, childIndex) => {
        rows.push({
          id: newId(),
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          kind,
          parentId,
          name: child.name,
          icon: child.icon,
          color: child.color,
          sortOrder: childIndex,
        });
      });
    });
  }

  await tx.category.createMany({ data: rows });
  return rows.length;
}
