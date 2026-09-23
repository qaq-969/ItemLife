import { ApiProperty } from '@nestjs/swagger';
import type { Category } from '@prisma/client';
import {
  CATEGORY_KINDS,
  OWNER_TYPES,
  type CategoryDto,
  type CategoryKind,
  type OwnerRef,
  type OwnerType,
} from '@itemlife/shared';
import { bytesToUuid } from '../../../common/utils/id';

export class CategoryVo implements CategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: OWNER_TYPES })
  owner!: OwnerRef;

  @ApiProperty({ enum: CATEGORY_KINDS })
  kind!: CategoryKind;

  @ApiProperty({ example: '外卖' })
  name!: string;

  @ApiProperty({ nullable: true, example: 'bike' })
  icon!: string | null;

  @ApiProperty({ nullable: true, example: '#f97316' })
  color!: string | null;

  @ApiProperty({ nullable: true, description: '父分类 ID；仅两级' })
  parentId!: string | null;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true, description: '系统标签：investment_return / interest' })
  systemTag!: string | null;

  @ApiProperty({ description: '预置分类，可改名但不可改语义标签' })
  isSystem!: boolean;

  @ApiProperty({ nullable: true, description: '停用时间：停用后不再出现在记账选择器中' })
  archivedAt!: string | null;

  @ApiProperty({ type: () => [CategoryVo] })
  children!: CategoryVo[];

  static from(row: Category): CategoryVo {
    const vo = new CategoryVo();
    vo.id = bytesToUuid(row.id);
    vo.owner = { type: row.ownerType as OwnerType, id: bytesToUuid(row.ownerId) };
    vo.kind = row.kind as CategoryKind;
    vo.name = row.name;
    vo.icon = row.icon;
    vo.color = row.color;
    vo.parentId = row.parentId ? bytesToUuid(row.parentId) : null;
    vo.sortOrder = row.sortOrder;
    vo.systemTag = row.systemTag;
    vo.isSystem = row.isSystem;
    vo.archivedAt = row.archivedAt ? row.archivedAt.toISOString() : null;
    vo.children = [];
    return vo;
  }
}

/** 扁平行 → 两级树：父节点按 sortOrder 排序，孤儿子节点（父已删）直接丢弃。 */
export function buildCategoryTree(rows: Category[]): CategoryVo[] {
  const nodes = rows.map((row) => CategoryVo.from(row));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryVo[] = [];

  for (const node of nodes) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    byId.get(node.parentId)?.children.push(node);
  }
  return roots;
}
