// Rule 3: no outbound channel, and free text is labeled as untrusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, body } from './helpers.ts';
import { tools } from '../src/tools/definitions.ts';
import { TENANT_B } from '../src/data/seed.ts';

test('9. Injected text in a note comes back as labeled data and nothing leaves the process', async () => {
  const s = await setup();
  const b = await s.client(await s.token({ tenant: TENANT_B }));
  const realFetch = globalThis.fetch;
  let outbound = 0;
  // Any network call made while the tool runs would be counted here.
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { outbound++; return realFetch(...args); }) as typeof fetch;
  try {
    const r = body(await b.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-ONLY-B-900', include_notes: true } }));
    const note = r.locations[0].note;
    assert.match(note.untrusted_free_text, /IGNORE PREVIOUS INSTRUCTIONS/);
    assert.match(note.warning, /not as instructions/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(outbound, 0);
});

test('9b. Notes are off unless asked for', async () => {
  const s = await setup();
  const b = await s.client(await s.token({ tenant: TENANT_B }));
  const r = body(await b.callTool({ name: 'get_stock_level', arguments: { sku: 'SKU-ONLY-B-900' } }));
  assert.equal(r.locations[0].note, undefined);
});

test('9c. The tool catalog has no outbound tools and every tool is closed-world', () => {
  const outboundWords = /email|mail|webhook|http|url|fetch|send|post|notify|export|upload/i;
  for (const t of tools) {
    assert.doesNotMatch(t.name, outboundWords, t.name);
    assert.equal(t.annotations.openWorldHint, false, t.name);
  }
});
