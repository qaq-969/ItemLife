/**
 * 离线冒烟用的 Prisma 内存替身引擎（不是完整的 Prisma 仿真）。
 *
 * 设计要点：where 匹配完全由「运行时值类型」驱动（Uint8Array 比字节、Date 比时间戳、
 * 其它按原始值），因此新增模型时只需声明默认值与关系，不必再为每个模型写一套解析代码。
 * 覆盖本仓库用到的查询形态：where / orderBy / take / skip / cursor / include / select /
 * create / createMany / update / updateMany / deleteMany / count / findFirst / findUnique / groupBy。
 */

export type Row = Record<string, any>;

/** 原始表集合：关系解析器据此直接读取其它表的行（`tables.account.rows`） */
export type TableMap = Record<string, MemoryTable>;

export interface TableSpec {
  /** 建表默认值：Prisma schema 里的 @default 在这里补齐 */
  defaults?: (data: Row) => Row;
  /** 关系解析：include 时按需展开 */
  relations?: Record<string, (row: Row, tables: TableMap) => unknown>;
}

export type AnyDb = Record<string, any>;

const toHex = (value: Uint8Array): string => Buffer.from(value).toString('hex');
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

function compareValues(left: any, right: any): number {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    const a = toHex(left);
    const b = toHex(right);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  const a = left as number | string;
  const b = right as number | string;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function matchValue(actual: any, expected: any): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected instanceof Uint8Array) return actual instanceof Uint8Array && toHex(actual) === toHex(expected);
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();

  if (typeof expected === 'object') {
    if ('in' in expected) return asArray(expected.in).some((value) => matchValue(actual, value));
    if ('notIn' in expected) return !asArray(expected.notIn).some((value) => matchValue(actual, value));
    if ('equals' in expected) return matchValue(actual, expected.equals);
    if ('not' in expected) return !matchValue(actual, expected.not);
    if ('lt' in expected || 'lte' in expected || 'gt' in expected || 'gte' in expected) {
      if (actual === null) return false;
      if ('lt' in expected && compareValues(actual, expected.lt) >= 0) return false;
      if ('lte' in expected && compareValues(actual, expected.lte) > 0) return false;
      if ('gt' in expected && compareValues(actual, expected.gt) <= 0) return false;
      if ('gte' in expected && compareValues(actual, expected.gte) < 0) return false;
      return true;
    }
    if ('contains' in expected) return String(actual ?? '').includes(String(expected.contains));
    if ('startsWith' in expected) return String(actual ?? '').startsWith(String(expected.startsWith));
  }
  return actual === expected;
}

export function matchWhere(row: Row, where: any, table?: MemoryTable, tables?: TableMap): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return asArray(value).every((clause) => matchWhere(row, clause, table, tables));
    if (key === 'OR') return asArray(value).some((clause) => matchWhere(row, clause, table, tables));
    if (key === 'NOT') return !asArray(value).every((clause) => matchWhere(row, clause, table, tables));

    // 关系过滤（如 itemLinks: { some: { itemId } }）：借关系解析器取关联行再递归匹配
    if (table && tables && typeof value === 'object' && value !== null) {
      const relation = table.spec.relations?.[key];
      if (relation && ('some' in value || 'every' in value || 'none' in value)) {
        const related = asArray(relation(row, tables) ?? []) as Row[];
        if ('some' in value) return related.some((item) => matchWhere(item, value.some));
        if ('every' in value) return related.every((item) => matchWhere(item, value.every));
        return related.length === 0;
      }
    }

    // 复合唯一键（如 householdId_userId）：字段名不在行上时按子字段逐项匹配
    if (!(key in row) && value && typeof value === 'object' && !(value instanceof Uint8Array) && !(value instanceof Date)) {
      return Object.entries(value).every(([subKey, subValue]) => matchValue(row[subKey], subValue));
    }
    return matchValue(row[key], value);
  });
}

function normalizeOrderBy(orderBy: any): Array<[string, 'asc' | 'desc']> {
  return asArray(orderBy).flatMap((clause) => Object.entries(clause ?? {})) as Array<[string, 'asc' | 'desc']>;
}

function project(row: Row | null, select?: Row): Row | null {
  if (!row) return null;
  if (!select) return row;
  const out: Row = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) out[key] = row[key];
  }
  return out;
}

export class MemoryTable {
  readonly rows: Row[] = [];

  constructor(
    readonly name: string,
    readonly spec: TableSpec = {},
  ) {}

  insert(data: Row): Row {
    const row: Row = { ...(this.spec.defaults?.(data) ?? {}), ...data };
    this.rows.push(row);
    return row;
  }

  where(where: any, tables?: TableMap): Row[] {
    return this.rows.filter((row) => matchWhere(row, where, this, tables));
  }
}

export function createTable(name: string, spec: TableSpec = {}): MemoryTable {
  return new MemoryTable(name, spec);
}

function createDelegate(tableName: string, table: MemoryTable, tables: TableMap, db: AnyDb): AnyDb {
  const sortRows = (rows: Row[], orderBy: any): Row[] =>
    [...rows].sort((left, right) => {
      for (const [field, direction] of normalizeOrderBy(orderBy)) {
        const diff = compareValues(left[field], right[field]);
        if (diff !== 0) return direction === 'desc' ? -diff : diff;
      }
      return 0;
    });

  const expand = (row: Row | null, include: Row | undefined): Row | null => {
    if (!row || !include) return row;
    const out: Row = { ...row };
    for (const [field, spec] of Object.entries(include)) {
      const resolver = table.spec.relations?.[field];
      if (!resolver || spec === false) continue;
      const related = resolver(row, tables);
      const nestedSelect = spec && typeof spec === 'object' ? spec.select : undefined;
      out[field] = Array.isArray(related)
        ? related.map((item) => project(item, nestedSelect))
        : project(related ?? null, nestedSelect);
    }
    return out;
  };

  return {
    create: async ({ data, include }: any) => expand(table.insert(data), include),

    createMany: async ({ data }: any) => {
      asArray(data).forEach((item) => table.insert(item));
      return { count: asArray(data).length };
    },

    findFirst: async ({ where, orderBy, select, include }: any) => {
      const rows = orderBy ? sortRows(table.where(where, tables), orderBy) : table.where(where, tables);
      return project(expand(rows[0] ?? null, include), select);
    },

    findUnique: async ({ where, select, include }: any) => {
      const row = table.where(where, tables)[0] ?? null;
      return project(expand(row, include), select);
    },

    findMany: async ({ where, orderBy, take, skip, cursor, select, include }: any) => {
      let rows = orderBy ? sortRows(table.where(where, tables), orderBy) : table.where(where, tables);

      if (cursor) {
        const [field, value] = Object.entries(cursor)[0]!;
        const index = rows.findIndex((row) => matchValue(row[field], value));
        // Prisma 语义：结果从游标行开始，skip 再去掉前 N 行（配合 skip:1 = 游标行本身）
        rows = index >= 0 ? rows.slice(index + (skip ?? 0)) : [];
      } else if (skip) {
        rows = rows.slice(skip);
      }
      if (take !== undefined) rows = rows.slice(0, take);

      return rows.map((row) => project(expand(row, include), select));
    },

    count: async ({ where }: any = {}) => table.where(where, tables).length,

    update: async ({ where, data, select, include }: any) => {
      const row = table.where(where, tables)[0];
      if (!row) throw new Error(`[${tableName}] update 目标不存在`);
      Object.assign(row, data, { updatedAt: new Date() });
      return project(expand(row, include), select);
    },

    updateMany: async ({ where, data }: any) => {
      const rows = table.where(where, tables);
      rows.forEach((row) => Object.assign(row, data, { updatedAt: new Date() }));
      return { count: rows.length };
    },

    deleteMany: async ({ where }: any) => {
      const targets = new Set(table.where(where, tables));
      for (let index = table.rows.length - 1; index >= 0; index -= 1) {
        if (targets.has(table.rows[index]!)) table.rows.splice(index, 1);
      }
      return { count: targets.size };
    },

    groupBy: async ({ by, where, _sum, _count }: any) => {
      const fields: string[] = asArray(by);
      const groups = new Map<string, Row>();

      for (const row of table.where(where, tables)) {
        const key = fields.map((field) => (row[field] instanceof Uint8Array ? toHex(row[field]) : String(row[field]))).join('|');
        let group = groups.get(key);
        if (!group) {
          group = {};
          for (const field of fields) group[field] = row[field];
          groups.set(key, group);
        }
        if (_sum) {
          group._sum ??= {};
          for (const field of Object.keys(_sum)) {
            group._sum[field] = BigInt(group._sum[field] ?? 0n) + BigInt(row[field] ?? 0n);
          }
        }
        if (_count) group._count = { _all: (group._count?._all ?? 0) + 1 };
      }
      return [...groups.values()];
    },
  };
}

export function buildMemoryPrisma(tables: TableMap): AnyDb {
  const db: AnyDb = {
    ping: async () => true,
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    // 同时支持数组形式（批量）与回调形式（交互式事务）
    $transaction: async (argument: any) => {
      if (typeof argument === 'function') return argument(db);
      return Promise.all(argument);
    },
    /** 测试脚手架：可直接读写底层行，用于造历史数据（如模拟一个月前开的账户） */
    $tables: tables,
  };

  for (const [name, table] of Object.entries(tables)) {
    db[name] = createDelegate(name, table, tables, db);
  }
  return db;
}
