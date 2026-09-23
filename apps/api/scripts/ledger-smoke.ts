/**
 * 记账核心（M2）离线冒烟：内存替换 Prisma / Redis，真实跑通路由 + 守卫 + 管道 + 服务。
 *
 * 覆盖验收标准：转账后两账户余额联动 / 删除流水后余额回滚 /
 * 分类增删改排序与停用 / 结息重跑不重复入账；另含分摊校验、游标分页、区间小计、
 * 幂等键、数据域隔离与越权 404。
 * 运行：pnpm --filter @itemlife/api smoke:ledger
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import { addDaysUtc, startOfDayUtc, toDateOnlyString } from '../src/common/utils/date';
import { bytesToUuid, newId } from '../src/common/utils/id';
import { createInMemoryPrisma, createInMemoryRedis } from './support/in-memory';
import type { MemoryTable } from './support/mini-prisma';

const EMAIL = 'ledger@itemlife.local';
const OTHER_EMAIL = 'stranger@itemlife.local';
const PASSWORD = 'Smoke-Test-2026!';
const DAY = 86_400_000;

interface JsonResponse {
  status: number;
  body: any;
  setCookie: string[];
}

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` —— ${detail}`}`);
}

async function main(): Promise<void> {
  process.env.TRUST_PROXY = '1';
  const memory = createInMemoryPrisma();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(memory)
    .overrideProvider(REDIS_CLIENT)
    .useValue(createInMemoryRedis())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>(undefined, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/v1`;

  let ipCounter = 0;
  const request = async (
    method: string,
    path: string,
    options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ): Promise<JsonResponse> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': `10.0.2.${(ipCounter += 1) % 250}`,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body, setCookie: response.headers.getSetCookie() };
  };

  const registerAndLogin = async (email: string): Promise<string> => {
    await request('POST', '/auth/register', { body: { email, password: PASSWORD } });
    const login = await request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    const token = login.body?.data?.accessToken;
    if (!token) throw new Error(`登录失败：${JSON.stringify(login.body)}`);
    return token;
  };

  const token = await registerAndLogin(EMAIL);
  const tables = memory.$tables as Record<string, MemoryTable>;

  console.log('\n[1] 注册即获得预置分类');
  const tree = await request('GET', '/categories', { token });
  check('GET /categories 返回分类树', tree.status === 200 && Array.isArray(tree.body.data), JSON.stringify(tree.body).slice(0, 200));
  const expenseTree = tree.body.data.filter((node: any) => node.kind === 'expense');
  const incomeTree = tree.body.data.filter((node: any) => node.kind === 'income');
  check('支出与收入两棵独立的树', expenseTree.length === 10 && incomeTree.length === 5, `expense=${expenseTree.length} income=${incomeTree.length}`);
  const catering = expenseTree.find((node: any) => node.name === '餐饮');
  check('预置分类带二级子分类', catering?.children?.length === 5, JSON.stringify(catering?.children?.map((c: any) => c.name)));
  const interestCategory = incomeTree.find((node: any) => node.systemTag === 'interest');
  check('利息收益分类带 systemTag=interest', Boolean(interestCategory), JSON.stringify(incomeTree.map((n: any) => n.systemTag)));
  const kindOnly = await request('GET', '/categories?kind=expense', { token });
  check('按 kind 过滤只返回支出树', kindOnly.body.data.every((node: any) => node.kind === 'expense'));

  console.log('\n[2] 分类增删改排序（移动端可用）');
  const created = await request('POST', '/categories', { body: { kind: 'expense', name: '宠物', icon: 'cat', color: '#ff8800' }, token });
  check('新建顶层分类', created.status === 201 && created.body.data.name === '宠物', JSON.stringify(created.body).slice(0, 200));
  const petId = created.body.data.id;
  const duplicated = await request('POST', '/categories', { body: { kind: 'expense', name: '宠物' }, token });
  check('同级重名返回 409 CATEGORY_NAME_TAKEN', duplicated.status === 409 && duplicated.body.code === 'CATEGORY_NAME_TAKEN', JSON.stringify(duplicated.body));

  const child = await request('POST', '/categories', { body: { kind: 'expense', name: '猫粮', parentId: petId }, token });
  check('在顶层分类下建二级分类', child.status === 201 && child.body.data.parentId === petId, JSON.stringify(child.body).slice(0, 200));
  const childId = child.body.data.id;
  const deepLeaf = await request('POST', '/categories', { body: { kind: 'expense', name: '深了', parentId: childId }, token });
  check('第三级被拒（400 CATEGORY_DEPTH_EXCEEDED）', deepLeaf.status === 400 && deepLeaf.body.code === 'CATEGORY_DEPTH_EXCEEDED', JSON.stringify(deepLeaf.body));

  const renamed = await request('PATCH', `/categories/${petId}`, { body: { name: '宠物用品', color: '#22cc88' }, token });
  check('改名与改色生效', renamed.status === 200 && renamed.body.data.name === '宠物用品' && renamed.body.data.color === '#22cc88');

  const reorderTargets = expenseTree.filter((node: any) => ['餐饮', '交通'].includes(node.name));
  const reordered = await request('PUT', '/categories/order', {
    body: {
      items: [
        { id: reorderTargets.find((n: any) => n.name === '交通').id, sortOrder: 0 },
        { id: reorderTargets.find((n: any) => n.name === '餐饮').id, sortOrder: 1 },
      ],
    },
    token,
  });
  const firstTwo = reordered.body.data.filter((node: any) => node.kind === 'expense').slice(0, 2).map((n: any) => n.name);
  check('批量排序落库（交通排到餐饮之前）', reordered.status === 200 && firstTwo.join(',') === '交通,餐饮', JSON.stringify(firstTwo));

  const archived = await request('PATCH', `/categories/${petId}`, { body: { archived: true }, token });
  const hiddenTree = await request('GET', '/categories?kind=expense', { token });
  check('停用后不再出现在记账选择器中', archived.status === 200 && !hiddenTree.body.data.some((node: any) => node.id === petId));
  const withArchived = await request('GET', '/categories?kind=expense&includeArchived=true', { token });
  const archivedNode = withArchived.body.data.find((node: any) => node.id === petId);
  check('includeArchived=true 可显示停用分类及子分类', Boolean(archivedNode?.archivedAt) && Boolean(archivedNode?.children?.[0]?.archivedAt));
  // 前端选择器会把布尔值显式序列化成字符串（false），必须与「省略参数」等价
  const explicitFalse = await request('GET', '/categories?kind=expense&includeArchived=false', { token });
  check('includeArchived=false 与省略参数等价（不返回停用分类）', !explicitFalse.body.data.some((node: any) => node.id === petId));
  await request('PATCH', `/categories/${petId}`, { body: { archived: false }, token });

  const removedCategory = await request('DELETE', `/categories/${petId}`, { token });
  const afterRemove = await request('GET', '/categories?kind=expense', { token });
  check('无流水的分类可删除（连带子分类）', removedCategory.status === 200 && !afterRemove.body.data.some((node: any) => node.id === petId));

  console.log('\n[3] 账户与派生余额');
  const cash = await request('POST', '/accounts', { body: { name: '现金', type: 'cash', initialBalanceMinor: 50_000 }, token });
  const bank = await request('POST', '/accounts', { body: { name: '招商银行储蓄卡', type: 'bank', initialBalanceMinor: 2_000_000 }, token });
  check('新建两个账户', cash.status === 201 && bank.status === 201, JSON.stringify(cash.body).slice(0, 160));
  const cashId = cash.body.data.id;
  const bankId = bank.body.data.id;
  check('新账户余额等于初始余额', cash.body.data.balanceMinor === 50_000 && bank.body.data.balanceMinor === 2_000_000);

  const halfConfig = await request('POST', '/accounts', { body: { name: '半配置', type: 'bank', interestRateBp: 175 }, token });
  check('只给利率不给周期被拒（400 INTEREST_CONFIG_INCOMPLETE）', halfConfig.status === 400 && halfConfig.body.code === 'INTEREST_CONFIG_INCOMPLETE', JSON.stringify(halfConfig.body));
  const sameName = await request('POST', '/accounts', { body: { name: '现金', type: 'cash' }, token });
  check('账户重名返回 409 ACCOUNT_NAME_TAKEN', sameName.status === 409 && sameName.body.code === 'ACCOUNT_NAME_TAKEN');

  const savings = await request('POST', '/accounts', {
    body: { name: '余额宝', type: 'investment', initialBalanceMinor: 1_000_000, interestRateBp: 175, interestFreq: 'monthly' },
    token,
  });
  check('计息账户创建成功（年化 175bp 按月结息）', savings.status === 201 && savings.body.data.interestRateBp === 175, JSON.stringify(savings.body).slice(0, 200));
  const savingsId = savings.body.data.id;

  console.log('\n[4] 记一笔（含分类校验与多物品分摊）');
  const expense = await request('POST', '/transactions', {
    body: { type: 'expense', amountMinor: 3_800, accountId: cashId, categoryId: catering.id, note: '午饭' },
    token,
  });
  check('支出记账成功', expense.status === 201 && expense.body.data.type === 'expense', JSON.stringify(expense.body).slice(0, 200));
  const expenseId = expense.body.data.id;
  check('响应带账户与分类快照', expense.body.data.account?.name === '现金' && expense.body.data.category?.name === '餐饮');

  const wrongKind = await request('POST', '/transactions', {
    body: { type: 'income', amountMinor: 100, accountId: cashId, categoryId: catering.id },
    token,
  });
  check('收支类型与分类不符被拒（400 CATEGORY_KIND_MISMATCH）', wrongKind.status === 400 && wrongKind.body.code === 'CATEGORY_KIND_MISMATCH');

  const balanced = await request('GET', '/accounts', { token });
  const cashAfterExpense = balanced.body.data.find((account: any) => account.id === cashId);
  check('支出后余额自动扣减（50000 − 3800 = 46200）', cashAfterExpense.balanceMinor === 46_200, String(cashAfterExpense.balanceMinor));

  const itemA = seedItem(tables, '机械键盘');
  const itemB = seedItem(tables, '显示器');
  const allocations = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100_000,
      accountId: bankId,
      categoryId: catering.id,
      items: [
        { itemId: itemA, amountMinor: 60_000 },
        { itemId: itemB, amountMinor: 40_000 },
      ],
    },
    token,
  });
  check('多物品分摊记账成功（Σ分摊 = 金额）', allocations.status === 201 && allocations.body.data.items.length === 2, JSON.stringify(allocations.body).slice(0, 240));

  const overAllocated = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100_000,
      accountId: bankId,
      items: [
        { itemId: itemA, amountMinor: 80_000 },
        { itemId: itemB, amountMinor: 30_000 },
      ],
    },
    token,
  });
  check('分摊合计超过金额被拒（400 ALLOCATION_EXCEEDS_AMOUNT）', overAllocated.status === 400 && overAllocated.body.code === 'ALLOCATION_EXCEEDS_AMOUNT', JSON.stringify(overAllocated.body));

  const missingAllocation = await request('POST', '/transactions', {
    body: { type: 'expense', amountMinor: 100_000, accountId: bankId, items: [{ itemId: itemA }, { itemId: itemB, amountMinor: 1_000 }] },
    token,
  });
  check('多物品漏填金额被拒（400 ALLOCATION_AMOUNT_REQUIRED）', missingAllocation.status === 400 && missingAllocation.body.code === 'ALLOCATION_AMOUNT_REQUIRED');

  const singleInherit = await request('POST', '/transactions', {
    body: { type: 'expense', amountMinor: 5_000, accountId: cashId, items: [{ itemId: itemA }] },
    token,
  });
  check('单物品可留空继承整笔金额（amountMinor = null）', singleInherit.status === 201 && singleInherit.body.data.items[0].amountMinor === null);

  console.log('\n[5] 转账：两账户余额联动');
  const transfer = await request('POST', '/transactions', {
    body: { type: 'transfer_out', amountMinor: 30_000, accountId: cashId, toAccountId: bankId, note: '取现转入' },
    token,
  });
  check('转账成功并返回转出腿', transfer.status === 201 && transfer.body.data.type === 'transfer_out' && Boolean(transfer.body.data.transferGroupId), JSON.stringify(transfer.body).slice(0, 200));
  const transferGroupId = transfer.body.data.transferGroupId;

  const afterTransfer = await request('GET', '/accounts', { token });
  const cashRow = afterTransfer.body.data.find((account: any) => account.id === cashId);
  const bankRow = afterTransfer.body.data.find((account: any) => account.id === bankId);
  check('转出账户余额减少（46200 − 30000 − 5000 = 11200）', cashRow.balanceMinor === 11_200, String(cashRow.balanceMinor));
  check('转入账户余额增加（2000000 − 100000 + 30000 = 1930000）', bankRow.balanceMinor === 1_930_000, String(bankRow.balanceMinor));

  const transferPair = await request('GET', `/transactions?type=transfer_in`, { token });
  check('转账写入成对的两条腿（共享 transferGroupId）', transferPair.body.data.items.length === 1 && transferPair.body.data.items[0].transferGroupId === transferGroupId);

  const sameAccount = await request('POST', '/transactions', {
    body: { type: 'transfer_out', amountMinor: 100, accountId: cashId, toAccountId: cashId },
    token,
  });
  check('转出转入同一账户被拒（400 TRANSFER_SAME_ACCOUNT）', sameAccount.status === 400 && sameAccount.body.code === 'TRANSFER_SAME_ACCOUNT');
  const transferWithCategory = await request('POST', '/transactions', {
    body: { type: 'transfer_out', amountMinor: 100, accountId: cashId, toAccountId: bankId, categoryId: catering.id },
    token,
  });
  check('转账带分类被拒（400 TRANSFER_CATEGORY_FORBIDDEN）', transferWithCategory.status === 400 && transferWithCategory.body.code === 'TRANSFER_CATEGORY_FORBIDDEN');

  console.log('\n[6] 修改与删除：余额回滚');
  const updated = await request('PATCH', `/transactions/${expenseId}`, { body: { amountMinor: 5_000, note: '午饭 + 咖啡' }, token });
  check('改金额后余额随之变化（46200 − (5000 − 3800) − 30000 − 5000 = 10000）', updated.status === 200, JSON.stringify(updated.body).slice(0, 160));
  const afterUpdate = await request('GET', '/accounts', { token });
  check('改动立即反映在派生余额上', afterUpdate.body.data.find((a: any) => a.id === cashId).balanceMinor === 10_000, String(afterUpdate.body.data.find((a: any) => a.id === cashId).balanceMinor));

  const deletedTransfer = await request('DELETE', `/transactions/${transfer.body.data.id}`, { token });
  const legsLeft = await request('GET', '/transactions?type=transfer_in', { token });
  check('删除转账连带删除成对的另一条腿', deletedTransfer.status === 200 && legsLeft.body.data.total === 0, JSON.stringify(legsLeft.body).slice(0, 160));

  const afterRollback = await request('GET', '/accounts', { token });
  check('删除转账后两账户余额回滚（现金 40000 / 银行 1900000）',
    afterRollback.body.data.find((a: any) => a.id === cashId).balanceMinor === 40_000 &&
      afterRollback.body.data.find((a: any) => a.id === bankId).balanceMinor === 1_900_000,
    JSON.stringify(afterRollback.body.data.map((a: any) => [a.name, a.balanceMinor])));

  const removeUsedAccount = await request('DELETE', `/accounts/${cashId}`, { token });
  check('有流水的账户不可删除（409 ACCOUNT_IN_USE）', removeUsedAccount.status === 409 && removeUsedAccount.body.code === 'ACCOUNT_IN_USE');

  const removeUsedCategory = await request('DELETE', `/categories/${catering.id}`, { token });
  check('有流水的分类不可删除（409 CATEGORY_IN_USE）', removeUsedCategory.status === 409 && removeUsedCategory.body.code === 'CATEGORY_IN_USE');

  console.log('\n[7] 流水列表：筛选 / 游标分页 / 区间小计');
  const keyword = await request('GET', '/transactions?keyword=咖啡', { token });
  check('按备注模糊筛选', keyword.body.data.items.length === 1 && keyword.body.data.items[0].id === expenseId, JSON.stringify(keyword.body).slice(0, 200));

  const paged = await request('GET', '/transactions?limit=2', { token });
  const pagedTotal = paged.body.data.total;
  check('游标分页返回 nextCursor', paged.body.data.items.length === 2 && Boolean(paged.body.data.nextCursor), JSON.stringify(paged.body).slice(0, 200));

  const seen = new Set<string>(paged.body.data.items.map((item: any) => item.id));
  let cursor = paged.body.data.nextCursor;
  let pages = 1;
  while (cursor && pages < 10) {
    const next = await request('GET', `/transactions?limit=2&cursor=${encodeURIComponent(cursor)}`, { token });
    next.body.data.items.forEach((item: any) => seen.add(item.id));
    cursor = next.body.data.nextCursor;
    pages += 1;
  }
  check(`翻完全部 ${pages} 页无重复无遗漏（共 ${seen.size} 条 / total ${pagedTotal}）`, seen.size === pagedTotal && pages === Math.ceil(pagedTotal / 2));

  const range = await request('GET', '/transactions?from=2000-01-01&to=2100-01-01&limit=100', { token });
  const summary = await request('GET', '/transactions/summary?from=2000-01-01&to=2100-01-01', { token });
  const expectedExpense = range.body.data.items.filter((item: any) => item.type === 'expense').reduce((sum: number, item: any) => sum + item.amountMinor, 0);
  check('区间小计 = 区间内支出合计', summary.body.data.expenseMinor === expectedExpense, `${JSON.stringify(summary.body.data)} vs ${expectedExpense}`);
  check('转账不计入收支小计', summary.body.data.incomeMinor === 0, JSON.stringify(summary.body.data));

  console.log('\n[8] Idempotency-Key 防重复提交');
  const idempotentBody = { type: 'expense', amountMinor: 1_200, accountId: cashId, note: '幂等测试' };
  const firstPost = await request('POST', '/transactions', { body: idempotentBody, token, headers: { 'Idempotency-Key': 'smoke-key-1' } });
  const secondPost = await request('POST', '/transactions', { body: idempotentBody, token, headers: { 'Idempotency-Key': 'smoke-key-1' } });
  check('相同幂等键返回同一条流水', firstPost.body.data.id === secondPost.body.data.id, `${firstPost.body.data.id} vs ${secondPost.body.data.id}`);
  const duplicatedNote = await request('GET', '/transactions?keyword=幂等测试', { token });
  check('未产生重复流水', duplicatedNote.body.data.total === 1, String(duplicatedNote.body.data.total));

  console.log('\n[9] 结息：预览 / 入账 / 重跑不重复入账');
  const savingsRow = tables.account.rows.find((row) => row.name === '余额宝');
  const anchor = startOfDayUtc(new Date(Date.now() - 40 * DAY));
  savingsRow.createdAt = anchor; // 模拟一个月前开户，使本期已满
  savingsRow.interestPostedAt = null;

  const preview = await request('GET', `/interest/preview?accountId=${savingsId}`, { token });
  const previewRow = preview.body.data[0];
  check('结息预览：区间自开户次日到今日共 40 天', preview.status === 200 && previewRow.days === 40 && previewRow.from === toDateOnlyString(addDaysUtc(anchor, 1)), JSON.stringify(previewRow));
  check('结息预览：100 万元本金 × 1.75% 年化 40 天 = 1918 分', previewRow.interestMinor === 1_918, String(previewRow.interestMinor));
  check('预览不写入流水', tables.transaction.rows.filter((row) => row.systemTag === 'interest').length === 0);

  const posted = await request('POST', '/interest/post', { body: { accountId: savingsId }, token });
  check('手动结息生成利息收益流水', posted.status === 200 && Boolean(posted.body.data.transactionId), JSON.stringify(posted.body).slice(0, 240));

  const interestTxn = tables.transaction.rows.find((row) => row.systemTag === 'interest');
  check('利息流水挂在 systemTag=interest 的分类下', Boolean(tables.category.rows.find((row) => row.id === interestTxn.categoryId && row.systemTag === 'interest')));
  const balanceAfterInterest = await request('GET', '/accounts', { token });
  check('利息入账后余额增加（1000000 + 1918）', balanceAfterInterest.body.data.find((a: any) => a.id === savingsId).balanceMinor === 1_001_918, String(balanceAfterInterest.body.data.find((a: any) => a.id === savingsId).balanceMinor));

  const repost = await request('POST', '/interest/post', { body: { accountId: savingsId }, token });
  check('立刻重跑不重复入账（400 INTEREST_PERIOD_EMPTY）', repost.status === 400 && repost.body.code === 'INTEREST_PERIOD_EMPTY', JSON.stringify(repost.body));
  check('利息流水仍然只有一条', tables.transaction.rows.filter((row) => row.systemTag === 'interest').length === 1);

  const notDue = await request('POST', '/interest/run', { token });
  check('未满一个周期时自动结息跳过该账户', notDue.body.data.every((row: any) => row.accountId !== savingsId), JSON.stringify(notDue.body.data));

  savingsRow.interestPostedAt = startOfDayUtc(new Date(Date.now() - 45 * DAY)); // 再把上次结息日推到一个半月前
  const rerun = await request('POST', '/interest/run', { token });
  check('到期后自动结息补结（共 2 条利息流水）', tables.transaction.rows.filter((row) => row.systemTag === 'interest').length === 2, JSON.stringify(rerun.body.data).slice(0, 240));
  const rerunAgain = await request('POST', '/interest/run', { token });
  check('再次自动结息不产生新流水（幂等标记生效）', rerunAgain.body.data.length === 0 && tables.transaction.rows.filter((row) => row.systemTag === 'interest').length === 2);

  console.log('\n[10] 数据域隔离与越权');
  const stranger = await registerAndLogin(OTHER_EMAIL);
  const strangerView = await request('GET', '/transactions', { token: stranger });
  check('他人流水列表为空', strangerView.body.data.items.length === 0 && strangerView.body.data.total === 0);
  const stealTransaction = await request('PATCH', `/transactions/${expenseId}`, { body: { note: '篡改' }, token: stranger });
  check('改他人流水返回 404（不区分不存在与无权）', stealTransaction.status === 404 && stealTransaction.body.code === 'TRANSACTION_NOT_FOUND', JSON.stringify(stealTransaction.body));
  const stealAccount = await request('PATCH', `/accounts/${cashId}`, { body: { name: '篡改' }, token: stranger });
  check('改他人账户返回 404', stealAccount.status === 404 && stealAccount.body.code === 'ACCOUNT_NOT_FOUND');
  const stealCategory = await request('PATCH', `/categories/${catering.id}`, { body: { name: '篡改' }, token: stranger });
  check('改他人分类返回 404', stealCategory.status === 404 && stealCategory.body.code === 'CATEGORY_NOT_FOUND');

  const householdId = seedHousehold(tables, userIdOf(tables, EMAIL), '冒烟之家');
  const householdAccount = await request('POST', '/accounts', {
    body: { name: '家庭公共账户', type: 'bank', initialBalanceMinor: 500_000, owner: { type: 'household', id: householdId } },
    token,
  });
  check('家庭数据域可建账户', householdAccount.status === 201 && householdAccount.body.data.owner.type === 'household', JSON.stringify(householdAccount.body).slice(0, 200));

  const householdList = await request('GET', `/accounts?domain=household:${householdId}`, { token });
  check('按 domain 查询家庭账户', householdList.body.data.length === 1 && householdList.body.data[0].name === '家庭公共账户');
  const personalList = await request('GET', '/accounts', { token });
  check('个人域看不到家庭账户', personalList.body.data.every((account: any) => account.owner.type === 'user'));

  const intruder = await request('GET', `/accounts?domain=household:${householdId}`, { token: stranger });
  check('非成员访问家庭数据域返回 404 SCOPE_NOT_FOUND', intruder.status === 404 && intruder.body.code === 'SCOPE_NOT_FOUND', JSON.stringify(intruder.body));

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n=== 记账冒烟结果：${passed}/${results.length} 通过 ===`);
  await app.close();
  if (passed !== results.length) {
    results.filter((row) => !row.ok).forEach((row) => console.log(`  ✗ ${row.name} —— ${row.detail ?? ''}`));
    process.exit(1);
  }
}

/** 直接往内存库里塞一个物品（物品接口在 M3，M2 只消费它做分摊校验）。 */
function seedItem(tables: Record<string, MemoryTable>, name: string): string {
  const user = tables.user.rows[0]!;
  const id = newId();
  tables.item.insert({
    id,
    ownerType: 'user',
    ownerId: user.id,
    name,
    purchaseDate: startOfDayUtc(new Date()),
    purchasePriceMinor: 0n,
    currency: 'CNY',
    status: 'in_use',
  });
  return bytesToUuid(id);
}

function seedHousehold(tables: Record<string, MemoryTable>, ownerUserId: Uint8Array, name: string): string {
  const id = newId();
  tables.household.insert({ id, name, ownerUserId });
  tables.householdMember.insert({ id: newId(), householdId: id, userId: ownerUserId, role: 'owner' });
  return bytesToUuid(id);
}

function userIdOf(tables: Record<string, MemoryTable>, email: string): Uint8Array {
  const row = tables.user.rows.find((candidate) => candidate.email === email);
  if (!row) throw new Error(`找不到用户：${email}`);
  return row.id;
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error('\n[冒烟异常]', error);
    process.exit(1);
  }
})();
