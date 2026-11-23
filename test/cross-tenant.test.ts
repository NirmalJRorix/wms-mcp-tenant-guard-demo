// The tests the blog post lists, run against a real MCP client and the real handler.
// Tenant A and Tenant B are fake. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, body } from './helpers.ts';
import { TENANT_A, TENANT_B } from '../src/data/seed.ts';

for (const era of ['modern', 'legacy'] as const) {
  test(`[${era}] 1. Tenant A token cannot read a SKU that only Tenant B has`, async () => {
    const s = await setup();
    const a = await s.client(await s.token({ tenant: TENANT_A }), era);
    const r = await a.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-ONLY-B-900' } });
    assert.equal(r.isError, true);
    assert.equal(body(r).error, 'not_found');
    assert.doesNotMatch(JSON.stringify(r), /999|R-20-01/); // Tenant B's quantity and location never appear
  });

  test(`[${era}] 1b. A SKU both tenants stock returns only the caller's rows`, async () => {
    const s = await setup();
    const a = await s.client(await s.token({ tenant: TENANT_A }), era);
    const b = await s.client(await s.token({ tenant: TENANT_B }), era);
    const ra = body(await a.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-SHARED-100', include_notes: true } }));
    const rb = body(await b.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-SHARED-100' } }));
    assert.deepEqual(ra.locations.map((l: any) => l.location_id), ['A-01-01']);
    assert.deepEqual(rb.locations.map((l: any) => l.location_id), ['B-05-01']);
    assert.doesNotMatch(JSON.stringify(ra), /Tenant B secret note/);
  });
}

test('2. An extra tenant_id argument is rejected, not ignored', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ tenant: TENANT_A }));
  const r = await a.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-SHARED-100', tenant_id: TENANT_B } });
  assert.equal(r.isError, true);
  assert.match(JSON.stringify(r), /tenant_id/);
  assert.doesNotMatch(JSON.stringify(r), /B-05-01/);
});

test('2b. The advertised schemas forbid extra fields and contain no tenant field', async () => {
  const s = await setup();
  const a = await s.client(await s.token());
  for (const t of (await a.listTools()).tools) {
    assert.equal((t.inputSchema as any).additionalProperties, false, t.name);
    assert.ok(!Object.keys((t.inputSchema as any).properties ?? {}).some(k => /tenant/i.test(k)), t.name);
  }
});

test('3. Tenant B cannot use a task handle that belongs to Tenant A', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ tenant: TENANT_A }));
  const b = await s.client(await s.token({ tenant: TENANT_B }));
  const created = body(await a.callTool({ name: 'create_cycle_count_task', arguments: { idempotency_key: 'count-0001', location_ids: ['A-01-01'] } }));
  const stolen = await b.callTool({ name: 'get_task', arguments: { task_id: created.task_id } });
  const neverExisted = await b.callTool({ name: 'get_task', arguments: { task_id: 'task_999999' } });
  assert.equal(body(stolen).error, 'not_found');
  assert.deepEqual(body(stolen), body(neverExisted)); // same answer: the error leaks nothing
  const row = s.audit.rows.at(-2)!;
  assert.equal(row.tenantId, TENANT_B);
  assert.equal(row.status, 'not_found');
});

test('4. A token issued for a different server (audience) gets 401 before any MCP parsing', async () => {
  const s = await setup();
  const res = await s.rawPost(await s.token({ aud: 'https://some-other-api.example.test' }));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata=/);
  assert.equal(s.audit.rows.length, 0);
});

test('5. Expired, missing, and tenant-less tokens get 401', async () => {
  const s = await setup();
  assert.equal((await s.rawPost(await s.token({ exp: Math.floor(Date.now() / 1000) - 60 }))).status, 401);
  assert.equal((await s.rawPost(null)).status, 401);
  assert.equal((await s.rawPost(await s.token({ omitTenant: true }))).status, 401);
});

test('6. Same idempotency key twice creates exactly 1 task and returns the same result', async () => {
  const s = await setup();
  const a = await s.client(await s.token());
  const args = { idempotency_key: 'putaway-0001', sku: 'SKU-ONLY-A-200', quantity: 24, from_location_id: 'DOCK-1', to_location_id: 'R-10-01' };
  const first = body(await a.callTool({ name: 'create_putaway_task', arguments: args }));
  const retry = body(await a.callTool({ name: 'create_putaway_task', arguments: args }));
  assert.deepEqual(retry, first);
  assert.equal(s.deps.store.countTasks(TENANT_A), 1);
  assert.equal(s.audit.rows.at(-1)!.replay, true);
});

test('7. Same key with a different quantity is an error, not a second task', async () => {
  const s = await setup();
  const a = await s.client(await s.token());
  const args = { idempotency_key: 'putaway-0002', sku: 'SKU-ONLY-A-200', quantity: 24, from_location_id: 'DOCK-1', to_location_id: 'R-10-01' };
  await a.callTool({ name: 'create_putaway_task', arguments: args });
  const r = await a.callTool({ name: 'create_putaway_task', arguments: { ...args, quantity: 48 } });
  assert.equal(body(r).error, 'idempotency_key_reused');
  assert.equal(s.deps.store.countTasks(TENANT_A), 1);
});

test('8. The same key used by Tenant A and Tenant B creates 2 separate tasks', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ tenant: TENANT_A }));
  const b = await s.client(await s.token({ tenant: TENANT_B }));
  const ra = body(await a.callTool({ name: 'create_cycle_count_task', arguments: { idempotency_key: 'same-key-123', location_ids: ['A-01-01'] } }));
  const rb = body(await b.callTool({ name: 'create_cycle_count_task', arguments: { idempotency_key: 'same-key-123', location_ids: ['B-05-01'] } }));
  assert.notEqual(ra.task_id, rb.task_id);
  assert.equal(s.deps.store.countTasks(TENANT_A), 1);
  assert.equal(s.deps.store.countTasks(TENANT_B), 1);
});

test('8b. Tenant A cannot create a task against Tenant B locations', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ tenant: TENANT_A }));
  const r = await a.callTool({ name: 'create_cycle_count_task', arguments: { idempotency_key: 'count-cross-1', location_ids: ['B-05-01'] } });
  assert.equal(body(r).error, 'not_found');
  assert.equal(s.deps.store.countTasks(TENANT_B), 0);
});
