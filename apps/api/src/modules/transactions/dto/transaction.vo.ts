import { ApiProperty } from '@nestjs/swagger';
import type {
  AccountBrief,
  AccountType,
  AllocationRole,
  CategoryBrief,
  TransactionDto,
  TransactionItemAllocation,
  TransactionType,
} from '@itemlife/shared';
import { bytesToUuid } from '../../../common/utils/id';

/** 列表查询时随行返回的关系快照（Prisma include 的结果）。 */
export interface TransactionRelations {
  account?: { id: Uint8Array; name: string; type: AccountType } | null;
  category?: { id: Uint8Array; name: string; icon: string | null; color: string | null } | null;
  itemLinks?: Array<{
    id: Uint8Array;
    itemId: Uint8Array;
    parentId: Uint8Array | null;
    name: string | null;
    amountMinor: bigint | null;
    role: AllocationRole;
    accessoryId: Uint8Array | null;
    item?: { name: string; deletedAt: Date | null };
    accessory: {
      name: string;
      unitPriceMinor: bigint;
      firstUnitExtraMinor: bigint;
      totalQty: number;
      usedQty: number;
      revertedQty: number;
    } | null;
  }>;
}

/** 与 Prisma 行结构解耦：只要求调用方提供这几个字段。 */
export interface TransactionRow extends TransactionRelations {
  id: Uint8Array;
  ownerType: 'user' | 'household';
  ownerId: Uint8Array;
  type: string;
  amountMinor: bigint;
  currency: string;
  accountId: Uint8Array;
  categoryId: Uint8Array | null;
  occurredAt: Date;
  note: string | null;
  systemTag: string | null;
  transferGroupId: Uint8Array | null;
  createdAt: Date;
}

export class TransactionVo implements TransactionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: { type: 'user', id: '0191…' } })
  owner!: { type: 'user' | 'household'; id: string };

  @ApiProperty({ enum: ['income', 'expense', 'transfer_in', 'transfer_out'] })
  type!: TransactionType;

  @ApiProperty({ description: '金额（分），恒为正数' })
  amountMinor!: number;

  @ApiProperty({ example: 'CNY' })
  currency!: string;

  @ApiProperty()
  accountId!: string;

  @ApiProperty({ example: { id: '0191…', name: '招商银行', type: 'bank' } })
  account!: AccountBrief;

  @ApiProperty({ nullable: true })
  categoryId!: string | null;

  @ApiProperty({ nullable: true, example: { id: '0191…', name: '餐饮', icon: 'utensils', color: '#f97316' } })
  category!: CategoryBrief | null;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true, description: '系统标签：interest（自动结息）' })
  systemTag!: string | null;

  @ApiProperty({ nullable: true })
  transferGroupId!: string | null;

  @ApiProperty({ description: '物品分摊；amountMinor=null 表示继承整笔金额' })
  items!: TransactionItemAllocation[];

  @ApiProperty()
  createdAt!: string;

  static from(row: TransactionRow): TransactionVo {
    const vo = new TransactionVo();
    vo.id = bytesToUuid(row.id);
    vo.owner = { type: row.ownerType, id: bytesToUuid(row.ownerId) };
    vo.type = row.type as TransactionType;
    vo.amountMinor = Number(row.amountMinor);
    vo.currency = row.currency;
    vo.accountId = bytesToUuid(row.accountId);
    vo.account = {
      id: bytesToUuid(row.accountId),
      name: row.account?.name ?? '',
      // account 是必填关系，include 后必然存在；缺省仅用于降级不炸接口
      type: (row.account?.type ?? 'cash') as AccountType,
    };
    vo.categoryId = row.categoryId ? bytesToUuid(row.categoryId) : null;
    vo.category = row.category
      ? {
          id: bytesToUuid(row.category.id),
          name: row.category.name,
          icon: row.category.icon,
          color: row.category.color,
        }
      : null;
    vo.occurredAt = row.occurredAt.toISOString();
    vo.note = row.note;
    vo.systemTag = row.systemTag;
    vo.transferGroupId = row.transferGroupId ? bytesToUuid(row.transferGroupId) : null;
    vo.items = (row.itemLinks ?? []).map((link) => ({
      id: bytesToUuid(link.id),
      itemId: bytesToUuid(link.itemId),
      parentId: link.parentId ? bytesToUuid(link.parentId) : null,
      name: link.accessory?.name ?? (link.role === 'fee' ? link.name || '附加费用' : link.item?.name ?? link.name ?? '物品'),
      itemName: link.item?.name ?? link.name ?? '物品',
      itemDeletedAt: link.item?.deletedAt?.toISOString() ?? null,
      amountMinor: link.amountMinor === null ? null : Number(link.amountMinor),
      role: link.role,
      accessoryId: link.accessoryId ? bytesToUuid(link.accessoryId) : null,
      quantity: link.accessory?.totalQty ?? null,
      unitPriceMinor: link.accessory ? Number(link.accessory.unitPriceMinor) : null,
      firstUnitExtraMinor: Number(link.accessory?.firstUnitExtraMinor ?? 0n),
      usedQty: link.accessory?.usedQty ?? null,
      revertedQty: link.accessory?.revertedQty ?? null,
    }));
    vo.createdAt = row.createdAt.toISOString();
    return vo;
  }
}
