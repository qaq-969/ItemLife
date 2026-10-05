/**
 * 冒烟脚本用的内存替身：用 mini-prisma 引擎按 Prisma schema 建表，
 * 目的是在没有 MySQL / Redis 的环境下验证真实业务链路（认证 + 记账核心）的行为。
 */
import { buildMemoryPrisma, createTable, type AnyDb } from './mini-prisma';

const now = (): Date => new Date();

export function createInMemoryPrisma(): AnyDb {
  const tables = {
    user: createTable('user', {
      defaults: () => ({
        nickname: null,
        baseCurrency: 'CNY',
        mfaEnabled: false,
        totpSecretEnc: null,
        totpConfirmedAt: null,
        lastTotpStep: null,
        siteRole: 'user',
        disabledAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
      relations: {
        registrationInvite: (row, tables) => tables.siteInvite.rows.find((invite: any) => same(invite.usedBy, row.id)) ?? null,
      },
    }),

    siteSettings: createTable('siteSettings', {
      defaults: () => ({ registrationOpen: true, updatedAt: now() }),
    }),

    siteInvite: createTable('siteInvite', {
      defaults: () => ({ remark: null, usedAt: null, usedBy: null, revokedAt: null, createdAt: now() }),
      relations: {
        creator: (row, tables) => tables.user.rows.find((user: any) => same(user.id, row.createdBy)) ?? null,
      },
    }),

    refreshToken: createTable('refreshToken', {
      defaults: () => ({
        deviceName: null,
        ip: null,
        userAgent: null,
        revokedAt: null,
        rotatedFrom: null,
        createdAt: now(),
      }),
    }),

    mfaRecoveryCode: createTable('mfaRecoveryCode', {
      defaults: () => ({ usedAt: null, createdAt: now() }),
    }),

    household: createTable('household', {
      defaults: () => ({ createdAt: now(), updatedAt: now() }),
      relations: {
        members: (row, tables) =>
          tables.householdMember.rows.filter((member: any) => same(member.householdId, row.id)),
      },
    }),

    householdMember: createTable('householdMember', {
      defaults: () => ({ role: 'member', joinedAt: now() }),
      relations: {
        household: (row, tables) => tables.household.rows.find((household: any) => same(household.id, row.householdId)) ?? null,
        user: (row, tables) => tables.user.rows.find((user: any) => same(user.id, row.userId)) ?? null,
      },
    }),

    householdInvite: createTable('householdInvite', {
      defaults: () => ({ maxUses: 5, usedCount: 0, revokedAt: null, createdAt: now() }),
      relations: {
        household: (row, tables) => tables.household.rows.find((household: any) => same(household.id, row.householdId)) ?? null,
        creator: (row, tables) => tables.user.rows.find((user: any) => same(user.id, row.createdBy)) ?? null,
      },
    }),

    account: createTable('account', {
      defaults: () => ({
        currency: 'CNY',
        initialBalanceMinor: 0n,
        interestRateBp: null,
        interestFreq: null,
        interestPostedAt: null,
        sortOrder: 0,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
    }),

    category: createTable('category', {
      defaults: () => ({
        icon: null,
        color: null,
        parentId: null,
        sortOrder: 0,
        systemTag: null,
        isSystem: false,
        archivedAt: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
      relations: {
        children: (row, tables) => tables.category.rows.filter((child: any) => same(child.parentId, row.id)),
      },
    }),

    transaction: createTable('transaction', {
      defaults: () => ({
        currency: 'CNY',
        categoryId: null,
        note: null,
        systemTag: null,
        transferGroupId: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
      relations: {
        account: (row, tables) =>
          tables.account.rows.find((account: any) => same(account.id, row.accountId)) ?? null,
        category: (row, tables) =>
          tables.category.rows.find((category: any) => same(category.id, row.categoryId)) ?? null,
        itemLinks: (row, tables) =>
          tables.transactionItem.rows.filter((link: any) => same(link.transactionId, row.id)),
        accessoryBatches: (row, tables) =>
          tables.itemAccessory.rows.filter((accessory: any) => same(accessory.transactionId, row.id)),
        purchasedItems: (row, tables) =>
          tables.item.rows.filter((item: any) => same(item.purchaseTransactionId, row.id)),
      },
    }),

    transactionItem: createTable('transactionItem', {
      defaults: () => ({ parentId: null, name: null, amountMinor: null, role: 'link', accessoryId: null, createdAt: now() }),
      relations: {
        transaction: (row, tables) =>
          tables.transaction.rows.find((transaction: any) => same(transaction.id, row.transactionId)) ?? null,
        item: (row, tables) => tables.item.rows.find((item: any) => same(item.id, row.itemId)) ?? null,
        accessory: (row, tables) =>
          tables.itemAccessory.rows.find((accessory: any) => same(accessory.id, row.accessoryId)) ?? null,
      },
    }),

    item: createTable('item', {
      defaults: () => ({
        categoryId: null,
        currency: 'CNY',
        expectedLifespanDays: null,
        status: 'in_use',
        note: null,
        purchaseTransactionId: null,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      }),
      relations: {
        accessories: (row, tables) =>
          tables.itemAccessory.rows.filter((accessory: any) => same(accessory.itemId, row.id)),
        accessoryUsages: (row, tables) =>
          tables.accessoryUsage.rows.filter((usage: any) => same(usage.itemId, row.id)),
        purchaseTransaction: (row, tables) =>
          tables.transaction.rows.find((transaction: any) => same(transaction.id, row.purchaseTransactionId)) ?? null,
      },
    }),

    itemAccessory: createTable('itemAccessory', {
      defaults: () => ({
        usedQty: 0,
        revertedQty: 0,
        firstUnitExtraMinor: 0n,
        transactionId: null,
        deletedAt: null,
        purchasedAt: now(),
        createdAt: now(),
        updatedAt: now(),
      }),
      relations: {
        item: (row, tables) => tables.item.rows.find((item: any) => same(item.id, row.itemId)) ?? null,
        transaction: (row, tables) =>
          tables.transaction.rows.find((transaction: any) => same(transaction.id, row.transactionId)) ?? null,
        transactionLinks: (row, tables) =>
          tables.transactionItem.rows.filter((link: any) => same(link.accessoryId, row.id)),
        usages: (row, tables) =>
          tables.accessoryUsage.rows.filter((usage: any) => same(usage.accessoryId, row.id)),
      },
    }),

    accessoryUsage: createTable('accessoryUsage', {
      defaults: () => ({ actorUserId: null, createdAt: now() }),
      relations: {
        accessory: (row, tables) =>
          tables.itemAccessory.rows.find((accessory: any) => same(accessory.id, row.accessoryId)) ?? null,
        actor: (row, tables) => tables.user.rows.find((user: any) => same(user.id, row.actorUserId)) ?? null,
      },
    }),

    inventoryRevert: createTable('inventoryRevert', {
      defaults: () => ({
        accessoryId: null,
        sourceTransactionId: null,
        kind: 'dispose',
        qty: null,
        createdAt: now(),
      }),
    }),
  };

  tables.siteSettings.insert({ id: 1 });

  return buildMemoryPrisma(tables);
}

function same(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right) return false;
  return Buffer.from(left).equals(Buffer.from(right));
}

/** ioredis 最小子集：INCR / EXPIRE / PTTL / DEL / GET / SET(EX, NX) / PING */
export function createInMemoryRedis(): any {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  const read = (key: string): string | null => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };

  return {
    ping: async () => 'PONG',
    quit: async () => 'OK',
    get: async (key: string) => read(key),
    set: async (key: string, value: string, ...rest: unknown[]) => {
      const args = rest.map((item) => String(item).toUpperCase());
      const exIndex = args.indexOf('EX');
      const ttlSeconds = exIndex >= 0 ? Number(rest[exIndex + 1]) : null;
      if (args.includes('NX') && read(key) !== null) return null;

      store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      return 'OK';
    },
    del: async (...keys: string[]) => {
      let removed = 0;
      keys.forEach((key) => {
        if (store.delete(key)) removed += 1;
      });
      return removed;
    },
    incr: async (key: string) => {
      const current = Number(read(key) ?? '0') + 1;
      const entry = store.get(key);
      store.set(key, { value: String(current), expiresAt: entry?.expiresAt ?? null });
      return current;
    },
    expire: async (key: string, seconds: number) => {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    pttl: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      const remaining = entry.expiresAt - Date.now();
      if (remaining <= 0) {
        store.delete(key);
        return -2;
      }
      return remaining;
    },
  };
}
