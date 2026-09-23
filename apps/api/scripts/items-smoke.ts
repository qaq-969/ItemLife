/**
 * 物品与配件（M3）离线冒烟：内存替换 Prisma / Redis，真实跑通路由 + 守卫 + 管道 + 服务。
 *
 * 覆盖验收标准（设计报告 12）：录入「牙刷 + 12 刷头用 2 个」后，
 * 总支付 / 当前持有成本 / 日均持有成本与 8.2 节公式完全一致，且配件消耗有审计记录；
 * 另含成本演进台阶、批次删除保护、超量校验、看板一致性、按物品过滤流水、数据域越权 404。
 * 运行：pnpm --filter @itemlife/api smoke:items
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/common/redis/redis.module';
import { addDaysUtc, toDateOnlyString } from '../src/common/utils/date';
import { bytesToUuid, newId } from '../src/common/utils/id';
import { createInMemoryPrisma, createInMemoryRedis } from './support/in-memory';
import type { MemoryTable } from './support/mini-prisma';

const EMAIL = 'items@itemlife.local';
const OTHER_EMAIL = 'intruder@itemlife.local';
const PASSWORD = 'Smoke-Test-2026!';

/** 牙刷购买日：99 天前 → 持有天数 100（购买当天算 1 天）。 */
const PURCHASE_OFFSET_DAYS = -99;
/** 首批刷头使用的日期：49 天前（用于校验成本演进台阶）。 */
const FIRST_USE_OFFSET_DAYS = -49;

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
        'X-Forwarded-For': `10.0.3.${(ipCounter += 1) % 250}`,
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
  const today = toDateOnlyString(new Date());
  const purchaseDate = toDateOnlyString(addDaysUtc(new Date(), PURCHASE_OFFSET_DAYS));

  console.log('\n[1] 物品建档：牙刷 + 12 刷头用 2 个（验收用例）');
  const toothbrush = await request('POST', '/items', {
    body: {
      name: '电动牙刷',
      purchaseDate,
      purchasePriceMinor: 40_000,
      note: '口腔护理',
      accessories: [
        { name: '替换刷头', unitPriceMinor: 2_000, totalQty: 12, usedQty: 2 },
      ],
    },
    token,
  });
  check('新建物品（含配件批次与初始已用数）', toothbrush.status === 201, JSON.stringify(toothbrush.body).slice(0, 240));
  const toothbrushId = toothbrush.body.data.id;
  const cost = toothbrush.body.data.cost;
  // 40000 + 12×2000 = 64000；40000 + 2×2000 = 44000；44000 ÷ 100 天 = 440；10×2000 = 20000
  check(
    '① 总支付 64000 分（本体 400 + 刷头 12×20）',
    cost.payTotalMinor === 64_000,
    JSON.stringify(cost),
  );
  check('② 当前持有成本 44000 分（400 + 已用 2×20）', cost.holdCostMinor === 44_000, String(cost.holdCostMinor));
  check('③ 日均持有成本 440 分/天（44000 ÷ 100 天）', cost.dailyHoldCostMinor === 440, String(cost.dailyHoldCostMinor));
  check('持有天数 = 今天 − 购买日 + 1 = 100', cost.heldDays === 100, String(cost.heldDays));
  check('④ 剩余库存价值 20000 分（10 个 × 20）', cost.remainingStockMinor === 20_000, String(cost.remainingStockMinor));
  check('⑤ 未填预期寿命 → 预计日均成本为 null', cost.projectedDailyMinor === null, String(cost.projectedDailyMinor));

  const detail = await request('GET', `/items/${toothbrushId}`, { token });
  const accessory = detail.body.data.accessories[0];
  check('配件批次剩余数量 = 12 − 2 = 10', accessory.remainingQty === 10, JSON.stringify(accessory));
  check('配件购入日期默认跟随物品购买日', accessory.purchasedAt === purchaseDate, String(accessory.purchasedAt));
  check(
    '初始已用 2 个写入审计（deltaQty=2 / usedQtyAfter=2）',
    detail.body.data.usages.length === 1 &&
      detail.body.data.usages[0].deltaQty === 2 &&
      detail.body.data.usages[0].usedQtyAfter === 2,
    JSON.stringify(detail.body.data.usages),
  );
  check('审计记录带操作人', detail.body.data.usages[0].actorName === EMAIL, String(detail.body.data.usages[0].actorName));

  console.log('\n[2] 预期寿命 → 预计日均成本');
  const lifespan = await request('PATCH', `/items/${toothbrushId}`, { body: { expectedLifespanDays: 400 }, token });
  check(
    '预计日均 = 64000 ÷ 400 = 160 分/天',
    lifespan.status === 200 && lifespan.body.data.cost.projectedDailyMinor === 160,
    JSON.stringify(lifespan.body.data.cost),
  );

  console.log('\n[3] 使用 / 撤销配件：指标联动与超量校验');
  const accessoryId = accessory.id;
  const consumed = await request('POST', `/accessories/${accessoryId}/consume`, { body: { qty: 3 }, token });
  check(
    '使用 3 个：usedQtyAfter = 5',
    consumed.status === 201 && consumed.body.data.deltaQty === 3 && consumed.body.data.usedQtyAfter === 5,
    JSON.stringify(consumed.body).slice(0, 200),
  );
  const afterConsume = await request('GET', `/items/${toothbrushId}`, { token });
  check(
    '持有成本随之上升：44000 + 3×2000 = 50000（日均 500）',
    afterConsume.body.data.cost.holdCostMinor === 50_000 && afterConsume.body.data.cost.dailyHoldCostMinor === 500,
    JSON.stringify(afterConsume.body.data.cost),
  );
  check('剩余库存价值降到 14000', afterConsume.body.data.cost.remainingStockMinor === 14_000);

  const overConsume = await request('POST', `/accessories/${accessoryId}/consume`, { body: { qty: 8 }, token });
  check(
    '超过剩余数量被拒（400 ACCESSORY_QTY_EXCEEDED）',
    overConsume.status === 400 && overConsume.body.code === 'ACCESSORY_QTY_EXCEEDED',
    JSON.stringify(overConsume.body),
  );

  const restored = await request('POST', `/accessories/${accessoryId}/restore`, { body: { qty: 1 }, token });
  check(
    '撤销 1 个：deltaQty = −1，usedQtyAfter = 4',
    restored.status === 201 && restored.body.data.deltaQty === -1 && restored.body.data.usedQtyAfter === 4,
    JSON.stringify(restored.body).slice(0, 200),
  );
  const overRestore = await request('POST', `/accessories/${accessoryId}/restore`, { body: { qty: 5 }, token });
  check(
    '撤销超过已用被拒（400 ACCESSORY_RESTORE_EXCEEDED）',
    overRestore.status === 400 && overRestore.body.code === 'ACCESSORY_RESTORE_EXCEEDED',
    JSON.stringify(overRestore.body),
  );

  const audited = await request('GET', `/items/${toothbrushId}`, { token });
  const usages = audited.body.data.usages;
  check(
    '审计共 3 条（建档 2 / 使用 3 / 撤销 1），失败的两次未落库',
    usages.length === 3 &&
      [...usages.map((row: any) => row.deltaQty)].sort((a, b) => a - b).join(',') === '-1,2,3',
    JSON.stringify(usages.map((row: any) => row.deltaQty)),
  );
  check(
    '每条审计都留存变更后的数量（2 → 5 → 4）',
    [...usages.map((row: any) => row.usedQtyAfter)].sort((a, b) => a - b).join(',') === '2,4,5',
    JSON.stringify(usages.map((row: any) => row.usedQtyAfter)),
  );
  const usageTimes = usages.map((row: any) => new Date(row.createdAt).getTime());
  check(
    '审计按时间倒序返回（最近在前）',
    usageTimes.every((time: number, index: number) => index === 0 || usageTimes[index - 1] >= time),
    JSON.stringify(usageTimes),
  );
  check(
    '撤销后持有成本回落：44000 + 4×2000 = 48000（日均 480）',
    audited.body.data.cost.holdCostMinor === 48_000 && audited.body.data.cost.dailyHoldCostMinor === 480,
    JSON.stringify(audited.body.data.cost),
  );

  console.log('\n[4] 成本演进台阶');
  // 把首批消耗「回溯」到 49 天前，验证折线按日聚合成台阶而不是一条直线
  const firstUsage = tables.accessoryUsage.rows.find(
    (row: any) => row.deltaQty === 2 && bytesToUuid(row.accessoryId) === accessoryId,
  );
  if (!firstUsage) throw new Error('找不到初始使用记录');
  firstUsage.createdAt = addDaysUtc(new Date(), FIRST_USE_OFFSET_DAYS);

  const timeline = await request('GET', `/items/${toothbrushId}`, { token });
  const points = timeline.body.data.costTimeline;
  const expectedLast = { date: today, holdCostMinor: 48_000 };
  check(
    '台阶共 3 点：购买 40000 → 49 天前用到 44000 → 今天 48000',
    points.length === 3 &&
      points[0].date === purchaseDate &&
      points[0].holdCostMinor === 40_000 &&
      points[1].date === toDateOnlyString(addDaysUtc(new Date(), FIRST_USE_OFFSET_DAYS)) &&
      points[1].holdCostMinor === 44_000 &&
      points[2].date === expectedLast.date &&
      points[2].holdCostMinor === expectedLast.holdCostMinor,
    JSON.stringify(points),
  );

  console.log('\n[5] 批次入库与删除保护');
  const umbrella = await request('POST', '/items', {
    body: { name: '折叠伞', purchaseDate: today, purchasePriceMinor: 3_600 },
    token,
  });
  const umbrellaId = umbrella.body.data.id;
  check('新建无配件的物品', umbrella.status === 201 && umbrella.body.data.accessoryCount === 0, JSON.stringify(umbrella.body).slice(0, 200));

  const spareBatch = await request('POST', `/items/${umbrellaId}/accessories`, {
    body: { name: '备用伞套', unitPriceMinor: 3_000, totalQty: 2 },
    token,
  });
  check('追加配件批次（默认购入日 = 今天）', spareBatch.status === 201 && spareBatch.body.data.purchasedAt === today, JSON.stringify(spareBatch.body).slice(0, 200));
  const spareId = spareBatch.body.data.id;
  const withSpare = await request('GET', `/items/${umbrellaId}`, { token });
  check(
    '批次入库后总支付 = 3600 + 2×3000 = 9600，持有成本不变（未使用不计入）',
    withSpare.body.data.cost.payTotalMinor === 9_600 && withSpare.body.data.cost.holdCostMinor === 3_600,
    JSON.stringify(withSpare.body.data.cost),
  );

  const removeUnused = await request('DELETE', `/accessories/${spareId}`, { token });
  check('未使用过的批次可删除', removeUnused.status === 200, JSON.stringify(removeUnused.body));

  const brushBatch = await request('POST', `/items/${umbrellaId}/accessories`, {
    body: { name: '伞柄套', unitPriceMinor: 1_000, totalQty: 4 },
    token,
  });
  const brushBatchId = brushBatch.body.data.id;
  await request('POST', `/accessories/${brushBatchId}/consume`, { body: { qty: 1 }, token });
  const removeUsed = await request('DELETE', `/accessories/${brushBatchId}`, { token });
  check(
    '已使用的批次不可删除（409 ACCESSORY_IN_USE）',
    removeUsed.status === 409 && removeUsed.body.code === 'ACCESSORY_IN_USE',
    JSON.stringify(removeUsed.body),
  );

  console.log('\n[6] 物品看板');
  const overview = await request('GET', '/items/overview', { token });
  const data = overview.body.data;
  // 牙刷：支付 64000 / 持有 48000 / 库存 16000；折叠伞：7600 / 4600（1×1000）/ 3000
  check(
    '总投入 = 64000 + 7600 = 71600 分',
    overview.status === 200 && data.payTotalMinor === 71_600,
    JSON.stringify(data).slice(0, 240),
  );
  check('持有成本合计 = 48000 + 4600 = 52600 分', data.holdCostMinor === 52_600, String(data.holdCostMinor));
  check('配件库存价值合计 = 16000 + 3000 = 19000 分', data.remainingStockMinor === 19_000, String(data.remainingStockMinor));
  check('在册 2 件 / 在役 2 件', data.itemCount === 2 && data.inUseCount === 2, `${data.itemCount}/${data.inUseCount}`);
  check('成本排行按日均持有成本倒序（折叠伞 4600 > 牙刷 480）', data.topCostly[0].id === umbrellaId, JSON.stringify(data.topCostly.map((row: any) => row.name)));
  check(
    '排行项自带成本指标（列表页免二次请求）',
    data.topCostly[0].cost.dailyHoldCostMinor === 4_600 && data.topCostly[1].cost.dailyHoldCostMinor === 480,
    JSON.stringify(data.topCostly.map((row: any) => row.cost.dailyHoldCostMinor)),
  );

  console.log('\n[7] 与记账打通：分摊 + 按物品过滤');
  const cash = await request('POST', '/accounts', { body: { name: '现金', type: 'cash', initialBalanceMinor: 100_000 }, token });
  const purchase = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 3_600,
      accountId: cash.body.data.id,
      items: [{ itemId: umbrellaId, amountMinor: 3_600 }],
      note: '买伞',
    },
    token,
  });
  check('记一笔分摊到物品', purchase.status === 201 && purchase.body.data.items[0].itemId === umbrellaId, JSON.stringify(purchase.body).slice(0, 200));

  const filtered = await request('GET', `/transactions?itemId=${umbrellaId}`, { token });
  check(
    '流水列表按 itemId 过滤只返回该物品的流水',
    filtered.body.data.total === 1 && filtered.body.data.items[0].id === purchase.body.data.id,
    JSON.stringify(filtered.body.data).slice(0, 240),
  );
  const unfiltered = await request('GET', '/transactions', { token });
  check('不加过滤仍返回全部流水', unfiltered.body.data.total === 1, String(unfiltered.body.data.total));

  const umbrellaDetail = await request('GET', `/items/${umbrellaId}`, { token });
  check(
    '物品详情带出关联流水',
    umbrellaDetail.body.data.transactions.length === 1 &&
      umbrellaDetail.body.data.transactions[0].note === '买伞',
    JSON.stringify(umbrellaDetail.body.data.transactions).slice(0, 240),
  );

  console.log('\n[8] 入参校验');
  const badQty = await request('POST', '/items', {
    body: {
      name: '坏数据',
      purchaseDate: today,
      purchasePriceMinor: 100,
      accessories: [{ name: '超标', unitPriceMinor: 100, totalQty: 1, usedQty: 2 }],
    },
    token,
  });
  check('初始已用 > 总数被拒（400 ACCESSORY_QTY_EXCEEDED）', badQty.status === 400 && badQty.body.code === 'ACCESSORY_QTY_EXCEEDED', JSON.stringify(badQty.body));

  const badDate = await request('POST', '/items', { body: { name: '坏日期', purchaseDate: '2026/01/01', purchasePriceMinor: 100 }, token });
  check('非法购买日被拒（400 校验失败）', badDate.status === 400, JSON.stringify(badDate.body).slice(0, 160));

  const badCategory = await request('POST', '/items', {
    body: { name: '坏分类', purchaseDate: today, purchasePriceMinor: 100, categoryId: '0191aaaa-1111-7111-8111-111111111111' },
    token,
  });
  check('不存在的分类返回 404 CATEGORY_NOT_FOUND', badCategory.status === 404 && badCategory.body.code === 'CATEGORY_NOT_FOUND', JSON.stringify(badCategory.body));

  const negativeAmount = await request('POST', '/accessories/' + accessoryId + '/consume', { body: { qty: 0 }, token });
  check('消耗数量必须 ≥ 1（400）', negativeAmount.status === 400, JSON.stringify(negativeAmount.body).slice(0, 160));

  console.log('\n[9] 数据域隔离与越权');
  const stranger = await registerAndLogin(OTHER_EMAIL);
  const strangerItems = await request('GET', '/items', { token: stranger });
  check('他人物品列表为空', strangerItems.body.data.items.length === 0 && strangerItems.body.data.total === 0);
  const stealDetail = await request('GET', `/items/${toothbrushId}`, { token: stranger });
  check('看他人物品返回 404 ITEM_NOT_FOUND（不区分不存在与无权）', stealDetail.status === 404 && stealDetail.body.code === 'ITEM_NOT_FOUND', JSON.stringify(stealDetail.body));
  const stealEdit = await request('PATCH', `/items/${toothbrushId}`, { body: { name: '篡改' }, token: stranger });
  check('改他人物品返回 404', stealEdit.status === 404 && stealEdit.body.code === 'ITEM_NOT_FOUND');
  const stealConsume = await request('POST', `/accessories/${accessoryId}/consume`, { body: { qty: 1 }, token: stranger });
  check('用他人配件返回 404 ACCESSORY_NOT_FOUND', stealConsume.status === 404 && stealConsume.body.code === 'ACCESSORY_NOT_FOUND', JSON.stringify(stealConsume.body));

  const householdId = seedHousehold(tables, userIdOf(tables, EMAIL), '物品之家');
  const householdItem = await request('POST', '/items', {
    body: { name: '家庭净水器', purchaseDate: today, purchasePriceMinor: 120_000, owner: { type: 'household', id: householdId } },
    token,
  });
  check('家庭数据域可建物品', householdItem.status === 201 && householdItem.body.data.owner.type === 'household', JSON.stringify(householdItem.body).slice(0, 200));
  const householdList = await request('GET', `/items?domain=household:${householdId}`, { token });
  check('按 domain 查询家庭物品（含成本指标）', householdList.body.data.items.length === 1 && householdList.body.data.items[0].cost.payTotalMinor === 120_000, JSON.stringify(householdList.body.data.items.map((row: any) => row.name)));
  const personalList = await request('GET', '/items', { token });
  check('个人域看不到家庭物品', personalList.body.data.items.every((row: any) => row.owner.type === 'user'));
  const intruder = await request('GET', `/items?domain=household:${householdId}`, { token: stranger });
  check('非成员访问家庭数据域返回 404 SCOPE_NOT_FOUND', intruder.status === 404 && intruder.body.code === 'SCOPE_NOT_FOUND', JSON.stringify(intruder.body));

  console.log('\n[10] 游标分页与软删除');
  const firstPage = await request('GET', '/items?limit=1', { token });
  check('limit=1 返回 nextCursor', firstPage.body.data.items.length === 1 && Boolean(firstPage.body.data.nextCursor), JSON.stringify(firstPage.body.data).slice(0, 200));
  const secondPage = await request('GET', `/items?limit=1&cursor=${encodeURIComponent(firstPage.body.data.nextCursor)}`, { token });
  const ids = new Set([firstPage.body.data.items[0].id, secondPage.body.data.items[0].id]);
  check('第二页拿到另一件物品（无重复）', ids.size === 2 && secondPage.body.data.total === 2, JSON.stringify([...ids]));

  const removed = await request('DELETE', `/items/${umbrellaId}`, { token });
  check('删除物品（软删）', removed.status === 200, JSON.stringify(removed.body));
  const goneDetail = await request('GET', `/items/${umbrellaId}`, { token });
  check('删除后详情 404', goneDetail.status === 404 && goneDetail.body.code === 'ITEM_NOT_FOUND');
  const afterDelete = await request('GET', '/items', { token });
  check('删除后列表不再返回', afterDelete.body.data.items.length === 1 && afterDelete.body.data.total === 1, String(afterDelete.body.data.total));
  const afterDeleteOverview = await request('GET', '/items/overview', { token });
  check('删除后看板只剩 1 件在册', afterDeleteOverview.body.data.itemCount === 1 && afterDeleteOverview.body.data.payTotalMinor === 64_000, JSON.stringify(afterDeleteOverview.body.data).slice(0, 200));
  const historyKept = await request('GET', `/transactions?itemId=${umbrellaId}`, { token });
  check('物品删除不影响历史流水查询（分摊记录保留）', historyKept.body.data.total === 1, String(historyKept.body.data.total));

  console.log('\n[11] 记一笔的物品归属：内联新建 / 用途角色 / 批次绑定');
  const cupTx = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 10_400,
      accountId: cash.body.data.id,
      note: '超市采购',
      items: [
        { newItem: { key: 'cup', name: '保温杯', expectedLifespanDays: 365 }, role: 'body', amountMinor: 8_000 },
        {
          itemRef: 'cup',
          role: 'accessory',
          amountMinor: 2_400,
          newAccessory: { name: '杯刷', totalQty: 12 },
        },
      ],
    },
    token,
  });
  check(
    '内联新建物品 + 同笔流水补配件，一次落库',
    cupTx.status === 201 && cupTx.body.data.items.length === 2,
    JSON.stringify(cupTx.body).slice(0, 240),
  );
  const cupId = cupTx.body.data.items.find((row: any) => row.role === 'body')?.itemId;
  const cupDetail = await request('GET', `/items/${cupId}`, { token });
  const cup = cupDetail.body.data;
  check(
    '物品购买日取流水发生日、本体价取本行分摊',
    cup.purchaseDate === today && cup.purchasePriceMinor === 8_000,
    JSON.stringify({ purchaseDate: cup.purchaseDate, purchasePriceMinor: cup.purchasePriceMinor }),
  );
  check(
    '① 总支付 = 8000 + 12×200 = 10400；② 持有成本 = 8000（配件未用不计入）',
    cup.cost.payTotalMinor === 10_400 && cup.cost.holdCostMinor === 8_000,
    JSON.stringify(cup.cost),
  );
  check(
    '⑤ 预计日均 = 10400 ÷ 365 = 28 分/天',
    cup.cost.projectedDailyMinor === 28,
    String(cup.cost.projectedDailyMinor),
  );
  const cupBatch = cup.accessories[0];
  check(
    '当场新建批次：单价 = 2400 ÷ 12 = 200，并指回本笔流水',
    cupBatch.unitPriceMinor === 200 && cupBatch.totalQty === 12 && cupBatch.transactionId === cupTx.body.data.id,
    JSON.stringify(cupBatch),
  );
  check(
    '分摊行带出用途角色与批次 ID',
    cupTx.body.data.items[1].accessoryId === cupBatch.id && cupTx.body.data.items[1].role === 'accessory',
    JSON.stringify(cupTx.body.data.items[1]),
  );
  const cupInlineRow = tables.item.rows.find((row: any) => bytesToUuid(row.id) === cupId);
  check(
    '本体采购流水指针已写入，供详情页跳转',
    Boolean(cupInlineRow) && bytesToUuid(cupInlineRow!.purchaseTransactionId) === cupTx.body.data.id,
    JSON.stringify(cupInlineRow?.purchaseTransactionId),
  );
  check(
    '折线从购买日起步，末点 = 当前持有成本 8000',
    cup.costTimeline.at(-1).holdCostMinor === 8_000 && cup.costTimeline[0].date === today,
    JSON.stringify(cup.costTimeline),
  );

  const feeTx = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 500,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, role: 'fee', amountMinor: 500 }],
      note: '换电池',
    },
    token,
  });
  const afterFee = await request('GET', `/items/${cupId}`, { token });
  check(
    '附加费用（fee）全额计入：总支付 10900 / 持有成本 8500',
    feeTx.status === 201 &&
      afterFee.body.data.cost.payTotalMinor === 10_900 &&
      afterFee.body.data.cost.holdCostMinor === 8_500,
    JSON.stringify(afterFee.body.data.cost),
  );

  const linkTx = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 2_000,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, amountMinor: 1_000 }],
      note: '带餐盒',
    },
    token,
  });
  const afterLink = await request('GET', `/items/${cupId}`, { token });
  check(
    '未写用途默认「仅关联」：成本不变，仍为 10900 / 8500',
    afterLink.body.data.cost.payTotalMinor === 10_900 && afterLink.body.data.cost.holdCostMinor === 8_500,
    JSON.stringify(afterLink.body.data.cost),
  );
  check(
    '未分摊金额 = 流水金额 − Σ分摊 = 2000 − 1000',
    afterLink.body.data.cost.unallocatedMinor === 1_000,
    String(afterLink.body.data.cost.unallocatedMinor),
  );

  const refill = await request('POST', `/items/${cupId}/accessories`, {
    body: { name: '滤芯', unitPriceMinor: 200, totalQty: 5 },
    token,
  });
  const refillId = refill.body.data.id;
  const mismatch = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 900,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, role: 'accessory', accessoryId: refillId, amountMinor: 900 }],
    },
    token,
  });
  check(
    '批次「单价×总数 ≠ 分摊金额」硬拦 409',
    mismatch.status === 409 && mismatch.body.code === 'ACCESSORY_AMOUNT_MISMATCH',
    JSON.stringify(mismatch.body),
  );

  const refillTx = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 1_000,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, role: 'accessory', accessoryId: refillId, amountMinor: 1_000 }],
      note: '补滤芯',
    },
    token,
  });
  const afterRefill = await request('GET', `/items/${cupId}`, { token });
  check(
    '金额一致时挂账成功：批次指回本笔流水',
    refillTx.status === 201 && afterRefill.body.data.accessories.some((row: any) => row.id === refillId && row.transactionId === refillTx.body.data.id),
    JSON.stringify(afterRefill.body.data.accessories),
  );
  check(
    '恒等式成立：持有成本 8500 = 总支付 11900 − 剩余库存 3400',
    afterRefill.body.data.cost.payTotalMinor === 11_900 &&
      afterRefill.body.data.cost.holdCostMinor === 8_500 &&
      afterRefill.body.data.cost.remainingStockMinor === 3_400,
    JSON.stringify(afterRefill.body.data.cost),
  );

  const rebind = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 1_000,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, role: 'accessory', accessoryId: refillId, amountMinor: 1_000 }],
    },
    token,
  });
  check(
    '同一批次不能挂到第二笔流水（409 ACCESSORY_ALREADY_BOUND）',
    rebind.status === 409 && rebind.body.code === 'ACCESSORY_ALREADY_BOUND',
    JSON.stringify(rebind.body),
  );

  const indivisible = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100,
      accountId: cash.body.data.id,
      items: [
        {
          itemId: cupId,
          role: 'accessory',
          amountMinor: 100,
          newAccessory: { name: '除不尽', totalQty: 3 },
        },
      ],
    },
    token,
  });
  check(
    '新建批次金额除不尽被拒（409 ACCESSORY_AMOUNT_MISMATCH）',
    indivisible.status === 409 && indivisible.body.code === 'ACCESSORY_AMOUNT_MISMATCH',
    JSON.stringify(indivisible.body),
  );

  await request('DELETE', `/transactions/${feeTx.body.data.id}`, { token });
  const afterDeleteFee = await request('GET', `/items/${cupId}`, { token });
  check(
    '软删流水不再计入成本（fee 撤销：持有成本回到 8000）',
    afterDeleteFee.body.data.cost.holdCostMinor === 8_000 && afterDeleteFee.body.data.cost.payTotalMinor === 11_400,
    JSON.stringify(afterDeleteFee.body.data.cost),
  );

  const toFee = await request('PATCH', `/transactions/${linkTx.body.data.id}`, {
    body: { items: [{ itemId: cupId, role: 'fee', amountMinor: 1_000 }] },
    token,
  });
  const afterPatch = await request('GET', `/items/${cupId}`, { token });
  check(
    '编辑流水可改用途：link → fee 后持有成本变为 9000',
    toFee.status === 200 && afterPatch.body.data.cost.holdCostMinor === 9_000,
    JSON.stringify(afterPatch.body.data.cost),
  );
  check(
    '编辑后未分摊金额随新分摊重算（2000 − 1000）',
    afterPatch.body.data.cost.unallocatedMinor === 1_000,
    String(afterPatch.body.data.cost.unallocatedMinor),
  );

  console.log('\n[12] 归属入参校验');
  const noBatch = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, role: 'accessory', amountMinor: 100 }],
    },
    token,
  });
  check(
    '配件用途未挂批次被拒（400 ACCESSORY_BATCH_REQUIRED）',
    noBatch.status === 400 && noBatch.body.code === 'ACCESSORY_BATCH_REQUIRED',
    JSON.stringify(noBatch.body),
  );

  const badRole = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100,
      accountId: cash.body.data.id,
      items: [{ newItem: { name: '无名之物' }, role: 'link', amountMinor: 100 }],
    },
    token,
  });
  check(
    '新建物品只能是本体或附加费用（400 ALLOCATION_ROLE_INVALID）',
    badRole.status === 400 && badRole.body.code === 'ALLOCATION_ROLE_INVALID',
    JSON.stringify(badRole.body),
  );

  const unknownRef = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100,
      accountId: cash.body.data.id,
      items: [{ newItem: { name: '孤零零' }, amountMinor: 50 }, { itemRef: 'nobody', role: 'fee', amountMinor: 50 }],
    },
    token,
  });
  check(
    'itemRef 指向不存在的临时键被拒（400 ITEM_REF_UNKNOWN）',
    unknownRef.status === 400 && unknownRef.body.code === 'ITEM_REF_UNKNOWN',
    JSON.stringify(unknownRef.body),
  );

  const twoTargets = await request('POST', '/transactions', {
    body: {
      type: 'expense',
      amountMinor: 100,
      accountId: cash.body.data.id,
      items: [{ itemId: cupId, itemRef: 'cup', amountMinor: 100 }],
    },
    token,
  });
  check(
    '同一行同时给 itemId 与 itemRef 被拒（400 ALLOCATION_TARGET_INVALID）',
    twoTargets.status === 400 && twoTargets.body.code === 'ALLOCATION_TARGET_INVALID',
    JSON.stringify(twoTargets.body),
  );

  const inlineOnEdit = await request('PATCH', `/transactions/${cupTx.body.data.id}`, {
    body: { items: [{ newItem: { name: '编辑期新建' }, amountMinor: 100 }] },
    token,
  });
  check(
    '编辑流水不允许内联新建（400 INLINE_CREATE_NOT_ALLOWED）',
    inlineOnEdit.status === 400 && inlineOnEdit.body.code === 'INLINE_CREATE_NOT_ALLOWED',
    JSON.stringify(inlineOnEdit.body),
  );

  const transferItems = await request('POST', '/transactions', {
    body: {
      type: 'transfer_out',
      amountMinor: 100,
      accountId: cash.body.data.id,
      toAccountId: cash.body.data.id,
      items: [{ itemId: cupId, amountMinor: 100 }],
    },
    token,
  });
  check(
    '转账仍不接受物品分摊（400 TRANSFER_ITEM_FORBIDDEN）',
    transferItems.status === 400 && transferItems.body.code === 'TRANSFER_ITEM_FORBIDDEN',
    JSON.stringify(transferItems.body),
  );

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n=== 物品冒烟结果：${passed}/${results.length} 通过 ===`);
  await app.close();
  if (passed !== results.length) {
    results.filter((row) => !row.ok).forEach((row) => console.log(`  ✗ ${row.name} —— ${row.detail ?? ''}`));
    process.exit(1);
  }
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
