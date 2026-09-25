/** 需先启动 Docker：验证批次删除会同步使用记录、流水金额和账户余额。 */
const base = process.env.ITEMLIFE_BASE_URL ?? 'http://localhost/api/v1';
const email = `accessory-delete-${Date.now()}@itemlife.local`;
const password = 'Accessory-Delete-2026!';

async function raw(method, path, body, token) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, data: json.data, body: json };
}

async function req(method, path, body, token) {
  const result = await raw(method, path, body, token);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${method} ${path} ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.data;
}

await req('POST', '/auth/register', { email, password });
const token = (await req('POST', '/auth/login', { email, password })).accessToken;
const categories = await req('GET', '/categories?kind=expense', undefined, token);
const categoryId = categories[0].children?.[0]?.id ?? categories[0].id;
const account = await req('POST', '/accounts', { name: '批次删除验证', type: 'cash', initialBalanceMinor: 100000 }, token);
const transaction = await req('POST', '/transactions', {
  type: 'expense',
  amountMinor: 8000,
  accountId: account.id,
  categoryId,
  items: [
    { key: 'body', newItem: { key: 'item', name: '电动牙刷' }, name: '电动牙刷', role: 'body', amountMinor: 6000 },
    { key: 'head', parentKey: 'body', itemRef: 'item', name: '刷头', role: 'accessory', amountMinor: 2000, newAccessory: { name: '刷头', totalQty: 2 } },
  ],
}, token);
const itemId = transaction.items.find((row) => row.role === 'body').itemId;
const accessoryId = transaction.items.find((row) => row.role === 'accessory').accessoryId;
const forbiddenAdd = await raw('POST', `/items/${itemId}/accessories`, { name: '绕过记账新增', unitPriceMinor: 100, totalQty: 1 }, token);
if (forbiddenAdd.status !== 404) throw new Error(`物品页追加批次接口仍可用: ${forbiddenAdd.status}`);

await req('POST', `/accessories/${accessoryId}/consume`, { qty: 2 }, token);
await req('POST', `/accessories/${accessoryId}/restore`, { qty: 1 }, token);
await req('DELETE', `/accessories/${accessoryId}`, { reason: '验证删除批次联动' }, token);

const detail = await req('GET', `/items/${itemId}`, undefined, token);
const transactions = await req('GET', '/transactions?limit=50', undefined, token);
const remaining = transactions.items.find((row) => row.id === transaction.id);
const accounts = await req('GET', '/accounts', undefined, token);
const balance = accounts.find((row) => row.id === account.id)?.balanceMinor;

if (detail.accessories.some((row) => row.id === accessoryId)) throw new Error('删除后批次仍显示');
if (detail.usages.some((row) => row.accessoryId === accessoryId)) throw new Error('删除后使用或恢复记录仍显示');
if (!remaining || remaining.amountMinor !== 6000) throw new Error(`共享流水未保留或金额错误: ${remaining?.amountMinor}`);
if (remaining.items.some((row) => row.accessoryId === accessoryId)) throw new Error('流水中仍存在已删除批次');
if (balance !== 94000) throw new Error(`账户余额未实时重算: ${balance}`);

console.log('批次删除联动验证通过：追加接口关闭，流水 8000 → 6000，批次与使用记录均已移除。');
