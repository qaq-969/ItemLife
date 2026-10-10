import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { newId } from '../src/common/utils/id';

/**
 * 种子数据（仅开发 / 演示环境）：
 * - 预置一个可登录的开发账号（默认已关闭 MFA，便于本地联调）
 * - 附带默认分类与三个常用账户
 * 生产环境请勿执行（脚本自身会拒绝）。
 */
const DEFAULT_CATEGORIES: Array<{ name: string; kind: 'expense' | 'income'; icon: string; color: string; systemTag?: string }> = [
  { name: '餐饮', kind: 'expense', icon: 'utensils', color: '#f97316' },
  { name: '日用百货', kind: 'expense', icon: 'basket', color: '#0ea5e9' },
  { name: '交通', kind: 'expense', icon: 'bus', color: '#6366f1' },
  { name: '居住', kind: 'expense', icon: 'home', color: '#14b8a6' },
  { name: '数码家电', kind: 'expense', icon: 'laptop', color: '#8b5cf6' },
  { name: '医疗健康', kind: 'expense', icon: 'heart-pulse', color: '#ef4444' },
  { name: '工资', kind: 'income', icon: 'wallet', color: '#22c55e' },
  { name: '投资收益', kind: 'income', icon: 'trending-up', color: '#10b981', systemTag: 'investment_return' },
  { name: '利息收益', kind: 'income', icon: 'percent', color: '#059669', systemTag: 'interest' },
];

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed] 生产环境不允许写入演示数据，已退出');
    process.exit(1);
  }

  const email = process.env.SEED_DEMO_EMAIL ?? 'dev@itemlife.local';
  const password = process.env.SEED_DEMO_PASSWORD ?? 'dev12345678';
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const userId = newId();
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      id: userId,
      email,
      passwordHash,
      nickname: '开发演示账号',
      mfaEnabled: false,
    },
  });
  console.log(`[seed] 用户就绪：${user.email}（密码：${password}）`);

  const existingCategories = await prisma.category.count({
    where: { ownerType: 'user', ownerId: user.id },
  });
  if (existingCategories === 0) {
    await prisma.category.createMany({
      data: DEFAULT_CATEGORIES.map((c, index) => ({
        id: newId(),
        ownerType: 'user' as const,
        ownerId: user.id,
        kind: c.kind,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sortOrder: index,
        systemTag: c.systemTag ?? null,
        isSystem: Boolean(c.systemTag),
      })),
    });
    console.log(`[seed] 已写入 ${DEFAULT_CATEGORIES.length} 个默认分类`);
  }

  const existingAccounts = await prisma.account.count({
    where: { ownerType: 'user', ownerId: user.id },
  });
  if (existingAccounts === 0) {
    await prisma.account.createMany({
      data: [
        { id: newId(), ownerType: 'user' as const, ownerId: user.id, name: '现金', type: 'cash' as const, initialBalanceMinor: 50000n, sortOrder: 0 },
        { id: newId(), ownerType: 'user' as const, ownerId: user.id, name: '招商银行储蓄卡', type: 'bank' as const, initialBalanceMinor: 2000000n, interestRateBp: 175, interestFreq: 'monthly' as const, sortOrder: 1 },
        { id: newId(), ownerType: 'user' as const, ownerId: user.id, name: '支付宝', type: 'payment' as const, initialBalanceMinor: 300000n, sortOrder: 2 },
      ],
    });
    console.log('[seed] 已写入 3 个示例账户（其中储蓄卡配置了 1.75% 年化、按月结息）');
  }
}

main()
  .catch((error) => {
    console.error('[seed] 失败：', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
