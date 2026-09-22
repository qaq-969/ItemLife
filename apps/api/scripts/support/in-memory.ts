/**
 * 冒烟脚本用的内存替身：仅实现 AuthModule 实际用到的查询形态，
 * 目的是在没有 MySQL / Redis 的环境下验证认证链路的真实行为（不是完整的 Prisma 仿真）。
 */

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function idEquals(left: Uint8Array | null | undefined, right: Uint8Array | null | undefined): boolean {
  if (!left || !right) return false;
  return toHex(left) === toHex(right);
}

function matchesId(actual: Uint8Array, expected: Uint8Array | { in: Uint8Array[] } | undefined): boolean {
  if (!expected) return true;
  if (expected instanceof Uint8Array) return idEquals(actual, expected);
  return expected.in.some((candidate) => idEquals(actual, candidate));
}

interface UserRow {
  id: Uint8Array;
  email: string;
  passwordHash: string;
  nickname: string | null;
  baseCurrency: string;
  mfaEnabled: boolean;
  totpSecretEnc: Buffer | null;
  totpConfirmedAt: Date | null;
  lastTotpStep: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface RefreshTokenRow {
  id: Uint8Array;
  userId: Uint8Array;
  tokenHash: string;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFrom: Uint8Array | null;
  createdAt: Date;
}

interface RecoveryCodeRow {
  id: Uint8Array;
  userId: Uint8Array;
  codeHash: string;
  usedAt: Date | null;
  createdAt: Date;
}

export function createInMemoryPrisma(): any {
  const users: UserRow[] = [];
  const refreshTokens: RefreshTokenRow[] = [];
  const recoveryCodes: RecoveryCodeRow[] = [];

  return {
    ping: async () => true,
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),

    user: {
      findUnique: async ({ where }: any) => {
        if (where.email !== undefined) return users.find((row) => row.email === where.email) ?? null;
        return users.find((row) => idEquals(row.id, where.id)) ?? null;
      },
      create: async ({ data }: any) => {
        const now = new Date();
        const row: UserRow = {
          id: data.id,
          email: data.email,
          passwordHash: data.passwordHash,
          nickname: data.nickname ?? null,
          baseCurrency: data.baseCurrency ?? 'CNY',
          mfaEnabled: data.mfaEnabled ?? false,
          totpSecretEnc: data.totpSecretEnc ?? null,
          totpConfirmedAt: data.totpConfirmedAt ?? null,
          lastTotpStep: data.lastTotpStep ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        users.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = users.find((candidate) => idEquals(candidate.id, where.id));
        if (!row) throw new Error('user not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },

    refreshToken: {
      create: async ({ data }: any) => {
        const row: RefreshTokenRow = {
          id: data.id,
          userId: data.userId,
          tokenHash: data.tokenHash,
          deviceName: data.deviceName ?? null,
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          expiresAt: data.expiresAt,
          revokedAt: null,
          rotatedFrom: data.rotatedFrom ?? null,
          createdAt: new Date(),
        };
        refreshTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: any) =>
        refreshTokens.find((row) => row.tokenHash === where.tokenHash) ?? null,
      findMany: async ({ where }: any) =>
        refreshTokens.filter((row) => matchesId(row.rotatedFrom ?? new Uint8Array(0), where.rotatedFrom?.in?.length ? { in: where.rotatedFrom.in } : undefined)),
      update: async ({ where, data }: any) => {
        const row = refreshTokens.find((candidate) => idEquals(candidate.id, where.id));
        if (!row) throw new Error('refresh token not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const targets = refreshTokens.filter((row) => {
          if (where.id !== undefined && !matchesId(row.id, where.id)) return false;
          if (where.userId !== undefined && !idEquals(row.userId, where.userId)) return false;
          if (where.revokedAt === null && row.revokedAt !== null) return false;
          return true;
        });
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      },
    },

    mfaRecoveryCode: {
      findFirst: async ({ where }: any) =>
        recoveryCodes.find(
          (row) =>
            idEquals(row.userId, where.userId) &&
            row.codeHash === where.codeHash &&
            (where.usedAt !== null || row.usedAt === null),
        ) ?? null,
      createMany: async ({ data }: any) => {
        data.forEach((item: any) =>
          recoveryCodes.push({
            id: item.id,
            userId: item.userId,
            codeHash: item.codeHash,
            usedAt: null,
            createdAt: new Date(),
          }),
        );
        return { count: data.length };
      },
      deleteMany: async ({ where }: any) => {
        const before = recoveryCodes.length;
        for (let index = recoveryCodes.length - 1; index >= 0; index -= 1) {
          if (idEquals(recoveryCodes[index]!.userId, where.userId)) recoveryCodes.splice(index, 1);
        }
        return { count: before - recoveryCodes.length };
      },
      update: async ({ where, data }: any) => {
        const row = recoveryCodes.find((candidate) => idEquals(candidate.id, where.id));
        if (!row) throw new Error('recovery code not found');
        Object.assign(row, data);
        return row;
      },
    },
  };
}

/** ioredis 最小子集：INCR / EXPIRE / PTTL / DEL / GET / SET / PING */
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
    set: async (key: string, value: string, _ex?: string, seconds?: number) => {
      store.set(key, { value, expiresAt: seconds ? Date.now() + seconds * 1000 : null });
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
