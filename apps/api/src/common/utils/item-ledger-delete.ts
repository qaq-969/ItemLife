import type { Prisma } from '@prisma/client';
import { bytesToUuid, newId, type IdBytes } from './id';

export interface ItemLedgerDeleteResult {
  itemCount: number;
  allocationCount: number;
  adjustedTransactionCount: number;
}

/**
 * 删除物品时只移除各流水中属于这些物品的分摊，并按移除金额下调流水总额。
 * 共享流水的其他物品继续保留；金额减到 0 时才软删除整笔流水。
 */
export async function deleteItemsAndAdjustLedger(
  tx: Prisma.TransactionClient,
  itemIds: IdBytes[],
  deletedAt: Date,
  actorId: IdBytes,
  reason: string,
): Promise<ItemLedgerDeleteResult> {
  if (itemIds.length === 0) return { itemCount: 0, allocationCount: 0, adjustedTransactionCount: 0 };

  const uniqueItems = [...new Map(itemIds.map((id) => [bytesToUuid(id), id])).values()];
  const items = await tx.item.findMany({
    where: { id: { in: uniqueItems }, deletedAt: null },
    select: { id: true, purchaseTransactionId: true },
  });
  if (items.length === 0) return { itemCount: 0, allocationCount: 0, adjustedTransactionCount: 0 };

  const liveItemIds = items.map((item) => item.id);
  const links = await tx.transactionItem.findMany({
    where: { itemId: { in: liveItemIds } },
    select: { id: true, transactionId: true, amountMinor: true },
  });
  const transactionIds = [...new Map(links.map((link) => [bytesToUuid(link.transactionId), link.transactionId])).values()];
  const transactions = transactionIds.length
    ? await tx.transaction.findMany({
        where: { id: { in: transactionIds }, deletedAt: null },
        select: { id: true, amountMinor: true },
      })
    : [];
  const transactionById = new Map(transactions.map((transaction) => [bytesToUuid(transaction.id), transaction]));
  const removedByTransaction = new Map<string, number>();
  for (const link of links) {
    const key = bytesToUuid(link.transactionId);
    const transaction = transactionById.get(key);
    if (!transaction) continue;
    const amount = link.amountMinor === null ? Number(transaction.amountMinor) : Number(link.amountMinor);
    removedByTransaction.set(key, (removedByTransaction.get(key) ?? 0) + amount);
  }

  const linkIds = links.map((link) => link.id);
  if (linkIds.length > 0) {
    await tx.transactionItem.updateMany({ where: { parentId: { in: linkIds } }, data: { parentId: null } });
    await tx.transactionItem.deleteMany({ where: { id: { in: linkIds } } });
  }

  const accessories = await tx.itemAccessory.findMany({
    where: { itemId: { in: liveItemIds }, deletedAt: null },
    select: { id: true },
  });
  if (accessories.length > 0) {
    await tx.itemAccessory.updateMany({
      where: { id: { in: accessories.map((accessory) => accessory.id) } },
      data: { deletedAt },
    });
  }

  for (const item of items) {
    await tx.inventoryRevert.create({
      data: {
        id: newId(),
        itemId: item.id,
        sourceTransactionId: item.purchaseTransactionId,
        kind: 'dispose',
        reason,
        createdBy: actorId,
      },
    });
  }
  await tx.item.updateMany({
    where: { id: { in: liveItemIds } },
    data: { deletedAt, status: 'retired' },
  });

  let adjustedTransactionCount = 0;
  for (const [key, removedAmount] of removedByTransaction) {
    const transaction = transactionById.get(key);
    if (!transaction) continue;
    const amountMinor = Math.max(0, Number(transaction.amountMinor) - removedAmount);
    await tx.transaction.update({
      where: { id: transaction.id },
      data: amountMinor === 0 ? { amountMinor: 0n, deletedAt } : { amountMinor: BigInt(amountMinor) },
    });
    adjustedTransactionCount += 1;
  }

  return { itemCount: items.length, allocationCount: links.length, adjustedTransactionCount };
}
