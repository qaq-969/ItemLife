import { Prisma } from '@prisma/client';
import type { IdBytes } from './id';

/** 永久清理一个个人或家庭数据域；调用方负责在同一事务内处理家庭关系或用户本身。 */
export async function deleteOwnerData(
  tx: Prisma.TransactionClient,
  ownerType: 'user' | 'household',
  ownerId: IdBytes,
): Promise<void> {
  const [items, transactions] = await Promise.all([
    tx.item.findMany({ where: { ownerType, ownerId }, select: { id: true } }),
    tx.transaction.findMany({ where: { ownerType, ownerId }, select: { id: true } }),
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
  await tx.category.updateMany({ where: { ownerType, ownerId }, data: { parentId: null } });
  await tx.category.deleteMany({ where: { ownerType, ownerId } });
  await tx.account.deleteMany({ where: { ownerType, ownerId } });
}
