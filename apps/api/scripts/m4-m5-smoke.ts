import assert from 'node:assert/strict';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';
import { FamilyService } from '../src/modules/family/family.service';
import { CostService } from '../src/modules/items/cost.service';
import { ItemsService } from '../src/modules/items/items.service';
import { BalanceService } from '../src/modules/transactions/balance.service';
import { OwnerScopeService } from '../src/common/scope/owner-scope.service';
import { bytesToUuid, newId } from '../src/common/utils/id';
import { createInMemoryPrisma } from './support/in-memory';

async function main(): Promise<void> {
  const prisma = createInMemoryPrisma();
  const audit = { record: () => undefined } as any;
  const scopes = new OwnerScopeService(prisma);
  const family = new FamilyService(prisma, audit);
  const balance = new BalanceService(prisma);
  const accounts = new AccountsService(prisma, scopes, balance);
  const cost = new CostService(prisma);
  const items = new ItemsService(prisma, scopes, cost, audit);
  const dashboard = new DashboardService(prisma, scopes, accounts, items);

  const ownerId = newId(); const memberId = newId(); const outsiderId = newId(); const lateId = newId();
  for (const [id, email, nickname] of [
    [ownerId, 'owner@example.com', '创建者'], [memberId, 'member@example.com', '成员'], [outsiderId, 'other@example.com', '其他人'],
    [lateId, 'late@example.com', '后来者'],
  ] as const) {
    await prisma.user.create({ data: { id, email, nickname, passwordHash: 'x' } });
  }
  const ownerUuid = bytesToUuid(ownerId); const memberUuid = bytesToUuid(memberId);
  const outsiderUuid = bytesToUuid(outsiderId); const lateUuid = bytesToUuid(lateId);

  const household = await family.create(ownerUuid, { name: '测试家庭' });
  assert.equal(household.role, 'owner');
  assert.equal((await family.list(ownerUuid)).length, 1);
  assert.ok(prisma.$tables.category.rows.some((row: any) => row.ownerType === 'household'));

  const invite = await family.createInvite(ownerUuid, household.id, {});
  assert.equal(invite.code?.length, 8);
  assert.ok(!prisma.$tables.householdInvite.rows[0].code);
  const joined = await family.join(memberUuid, { code: invite.code! });
  assert.equal(joined.role, 'member');
  assert.equal((await family.members(memberUuid, household.id)).length, 2);
  assert.equal((await family.list(memberUuid))[0]?.id, household.id);
  await assert.rejects(() => family.createInvite(memberUuid, household.id, {}), /创建者或管理员/);

  const renamed = await family.update(ownerUuid, household.id, { name: '新测试家庭' });
  assert.equal(renamed.name, '新测试家庭');
  const promoted = await family.updateMemberRole(ownerUuid, household.id, memberUuid, { role: 'admin' });
  assert.equal(promoted.role, 'admin');
  assert.equal((await family.list(memberUuid))[0]?.role, 'admin');

  const limited = await family.createInvite(memberUuid, household.id, { maxUses: 1 });
  await family.join(outsiderUuid, { code: limited.code! });
  await assert.rejects(() => family.join(lateUuid, { code: limited.code! }), /邀请码无效/);

  const removable = await family.createInvite(memberUuid, household.id, { maxUses: 1 });
  await family.join(lateUuid, { code: removable.code! });
  await family.removeMember(memberUuid, household.id, lateUuid);
  await assert.rejects(() => scopes.resolve(lateUuid, `household:${household.id}`), /数据域不存在/);
  await assert.rejects(() => family.updateMemberRole(memberUuid, household.id, outsiderUuid, { role: 'admin' }), /仅家庭创建者/);
  await family.updateMemberRole(ownerUuid, household.id, outsiderUuid, { role: 'admin' });
  await assert.rejects(() => family.removeMember(memberUuid, household.id, outsiderUuid), /管理员只能移除普通成员/);
  await family.updateMemberRole(ownerUuid, household.id, outsiderUuid, { role: 'member' });

  const revoked = await family.createInvite(ownerUuid, household.id, {});
  await family.revokeInvite(memberUuid, household.id, revoked.id);
  await assert.rejects(() => family.join(lateUuid, { code: revoked.code! }), /邀请码无效/);

  const householdBytes = prisma.$tables.household.rows[0].id;
  const accountId = newId();
  await prisma.account.create({ data: { id: accountId, ownerType: 'household', ownerId: householdBytes, name: '家庭银行卡', type: 'bank', initialBalanceMinor: 10_000n } });
  const categories = prisma.$tables.category.rows.filter((row: any) => row.ownerType === 'household');
  const expenseCategory = categories.find((row: any) => row.kind === 'expense' && !row.parentId)!;
  const interestCategory = categories.find((row: any) => row.systemTag === 'interest')!;
  const incomeCategory = categories.find((row: any) => row.kind === 'income' && !row.systemTag)!;

  const addTransaction = async (type: string, amount: number, occurredAt: string, categoryId: Uint8Array, systemTag: string | null = null) => {
    return prisma.transaction.create({ data: {
      id: newId(), ownerType: 'household', ownerId: householdBytes, type, amountMinor: BigInt(amount), accountId,
      categoryId, occurredAt: new Date(`${occurredAt}T12:00:00.000Z`), createdBy: ownerId, systemTag,
    } });
  };
  await addTransaction('income', 80_000, '2026-08-10', incomeCategory.id);
  await addTransaction('expense', 20_000, '2026-08-12', expenseCategory.id);
  await addTransaction('income', 100_000, '2026-09-03', incomeCategory.id);
  const purchaseTransaction = await addTransaction('expense', 30_000, '2026-09-04', expenseCategory.id);
  await addTransaction('income', 500, '2026-09-05', interestCategory.id, 'interest');
  const householdItem = await prisma.item.create({ data: {
    id: newId(), ownerType: 'household', ownerId: householdBytes, name: '家庭物品', purchaseDate: new Date('2026-09-04T00:00:00.000Z'), purchasePriceMinor: 40_000n,
  } });
  const accessory = await prisma.itemAccessory.create({ data: {
    id: newId(), itemId: householdItem.id, name: '家庭配件', unitPriceMinor: 1_000n, totalQty: 2, transactionId: purchaseTransaction.id,
  } });
  await prisma.accessoryUsage.create({ data: {
    id: newId(), accessoryId: accessory.id, itemId: householdItem.id, deltaQty: 1, usedQtyAfter: 1, actorUserId: ownerId,
  } });
  await prisma.transactionItem.create({ data: {
    id: newId(), transactionId: purchaseTransaction.id, itemId: householdItem.id, role: 'accessory', accessoryId: accessory.id, amountMinor: 2_000n,
  } });
  await prisma.inventoryRevert.create({ data: {
    id: newId(), itemId: householdItem.id, accessoryId: accessory.id, sourceTransactionId: purchaseTransaction.id,
    kind: 'correction', qty: 1, reason: '测试家庭删除', createdBy: ownerId,
  } });

  const query = { domain: `household:${household.id}`, from: '2026-09-01', to: '2026-09-30', granularity: 'day' as const };
  const overview = await dashboard.overview(memberUuid, query);
  assert.equal(overview.expenseMinor, 30_000);
  assert.equal(overview.incomeMinor, 100_500);
  assert.equal(overview.savingMinor, 70_500);
  assert.equal(overview.returnMinor, 500);
  assert.equal(overview.netWorthMinor, 140_500);
  assert.equal(overview.itemInvestment.payTotalMinor, 42_000);
  assert.equal(overview.expenseComparison.previousMinor, 20_000);

  const trend = await dashboard.trend(memberUuid, query);
  assert.equal(trend.points.reduce((sum, row) => sum + row.expenseMinor, 0), 30_000);
  assert.equal(trend.points.reduce((sum, row) => sum + row.incomeMinor, 0), 100_500);
  assert.equal(trend.points.at(-1)?.netWorthMinor, 140_500);
  const breakdown = await dashboard.breakdown(memberUuid, query);
  assert.equal(breakdown.categories[0]?.amountMinor, 30_000);
  assert.equal(breakdown.accounts[0]?.balanceMinor, 140_500);

  const personal = await dashboard.overview(memberUuid, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(personal.expenseMinor, 0);
  assert.equal(personal.itemInvestment.itemCount, 0);

  await family.removeMember(ownerUuid, household.id, memberUuid);
  await assert.rejects(() => scopes.resolve(memberUuid, `household:${household.id}`), /数据域不存在/);
  await assert.rejects(() => family.delete(ownerUuid, household.id, { confirmationName: '名称不符' }), /家庭名称不一致/);
  await family.delete(ownerUuid, household.id, { confirmationName: renamed.name });
  assert.equal((await family.list(ownerUuid)).length, 0);
  for (const table of ['household', 'householdMember', 'householdInvite', 'account', 'category', 'transaction', 'transactionItem', 'item', 'itemAccessory', 'accessoryUsage', 'inventoryRevert']) {
    assert.equal(prisma.$tables[table].rows.length, 0, `${table} 应随家庭删除清空`);
  }
  assert.equal(prisma.$tables.user.rows.length, 4);
  console.log('M4/M5 smoke: 46 assertions passed');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
