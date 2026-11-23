// Scopes, rate limits, and the audit row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, body } from './helpers.ts';
import { TENANT_A } from '../src/data/seed.ts';

test('A read-only token cannot call a write tool, and the denial is audited', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ scope: 'wms.stock.read wms.locations.read' }));
  const r = await a.callTool({ name: 'create_cycle_count_task', arguments: { idempotency_key: 'count-0009', location_ids: ['A-01-01'] } });
  assert.equal(body(r).error, 'insufficient_scope');
  assert.equal(s.deps.store.countTasks(TENANT_A), 0);
  assert.equal(s.audit.rows.at(-1)!.status, 'denied');
});

test('Every call writes 1 audit row with the agreed fields and no raw arguments', async () => {
  const s = await setup();
  const a = await s.client(await s.token({ sub: 'user-42' }));
  await a.callTool({ name: 'list_locations', arguments: { zone: 'A' } });
  await a.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-SHARED-100' } });
  assert.equal(s.audit.rows.length, 2);
  for (const row of s.audit.rows) {
    assert.deepEqual(Object.keys(row).sort(), ['argHash', 'at', 'clientId', 'idempotencyKey', 'latencyMs', 'replay', 'status', 'tenantId', 'tool', 'userId']);
    assert.equal(row.tenantId, TENANT_A);
    assert.equal(row.userId, 'user-42');
    assert.match(row.argHash, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(row), /SKU-SHARED-100/);
  }
});

test('A looping agent is rate limited per tenant, user, and tool', async () => {
  const s = await setup({ perMinute: 3 });
  const a = await s.client(await s.token());
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await a.callTool({ name: 'list_locations', arguments: {} });
    statuses.push(r.isError ? body(r).error : 'ok');
  }
  assert.deepEqual(statuses, ['ok', 'ok', 'ok', 'rate_limited', 'rate_limited']);
});

test('list_locations pages instead of dumping everything', async () => {
  const s = await setup();
  const a = await s.client(await s.token());
  const r = body(await a.callTool({ name: 'list_locations', arguments: {} }));
  assert.equal(r.total, 4);
  assert.equal(r.next_offset, null);
});
