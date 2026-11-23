import * as z from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { Principal } from '../auth/principal.ts';
import type { WarehouseStore } from '../data/store.ts';
import { config } from '../config.ts';
import { untrustedText } from './untrusted.ts';

export type HandlerResult = { status: 'ok'; data: unknown } | { status: 'not_found' } | { status: 'invalid'; message: string };

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** Hints for the client. The server never trusts them and never relies on them. */
  annotations: ToolAnnotations;
  /** Every scope listed here must be in the verified token. */
  scopes: string[];
  write: boolean;
  /** .strict(): unknown fields, such as tenant_id, are rejected, not ignored. */
  inputSchema: z.ZodObject;
  handler: (p: Principal, args: any, store: WarehouseStore) => HandlerResult;
}

const sku = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const locationId = z.string().min(1).max(32).regex(/^[A-Za-z0-9-]+$/);
const idempotencyKey = z.string().min(8).max(255)
  .describe('A unique string you create once per action and send again, unchanged, on every retry of that action.');

// NOTE: there is deliberately no tenant_id field anywhere below.
export const tools: ToolDef[] = [
  {
    name: 'get_stock_level',
    title: 'Get stock level',
    description: 'On-hand, allocated and available quantity for one SKU in your warehouse, optionally at one location.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['wms.stock.read'],
    write: false,
    inputSchema: z.object({
      sku,
      location_id: locationId.optional(),
      include_notes: z.boolean().default(false).describe('Include free-text receiving notes. Off by default.'),
    }).strict(),
    handler: (p, a, store) => {
      const rows = store.stockForSku(p.tenantId, a.sku, a.location_id);
      if (rows.length === 0) return { status: 'not_found' };
      return {
        status: 'ok',
        data: {
          sku: a.sku,
          locations: rows.map(r => ({
            location_id: r.locationId,
            on_hand: r.onHand,
            allocated: r.allocated,
            available: r.onHand - r.allocated,
            ...(a.include_notes ? { note: untrustedText(r.note) } : {}),
          })),
        },
      };
    },
  },
  {
    name: 'list_locations',
    title: 'List locations',
    description: `List storage locations in your warehouse, ${config.limits.listLocationsPageSize} per page.`,
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['wms.locations.read'],
    write: false,
    inputSchema: z.object({
      zone: z.string().max(16).optional(),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    handler: (p, a, store) => {
      const { items, total } = store.locations(p.tenantId, a.zone, a.offset, config.limits.listLocationsPageSize);
      const next = a.offset + items.length;
      return { status: 'ok', data: { locations: items, total, next_offset: next < total ? next : null } };
    },
  },
  {
    name: 'create_putaway_task',
    title: 'Create putaway task',
    description: 'Create a putaway task asking a worker to move received stock into a storage location. Does not move stock by itself.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopes: ['wms.tasks.write'],
    write: true,
    inputSchema: z.object({
      idempotency_key: idempotencyKey,
      sku,
      quantity: z.number().int().min(1).max(100_000),
      from_location_id: locationId,
      to_location_id: locationId,
    }).strict(),
    handler: (p, a, store) => {
      const from = store.location(p.tenantId, a.from_location_id);
      const to = store.location(p.tenantId, a.to_location_id);
      if (!from || !to) return { status: 'not_found' };
      if (to.type === 'dock') return { status: 'invalid', message: 'Cannot put away into a dock location.' };
      const task = store.createTask(p.tenantId, {
        kind: 'putaway', createdBy: p.userId, sku: a.sku, quantity: a.quantity,
        fromLocationId: from.id, toLocationId: to.id,
      });
      return { status: 'ok', data: { task_id: task.id, status: task.status } };
    },
  },
  {
    name: 'create_cycle_count_task',
    title: 'Create cycle count task',
    description: `Create a task to count up to ${config.limits.maxCountLocations} locations. Does not adjust inventory.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    scopes: ['wms.tasks.write'],
    write: true,
    inputSchema: z.object({
      idempotency_key: idempotencyKey,
      location_ids: z.array(locationId).min(1).max(config.limits.maxCountLocations),
    }).strict(),
    handler: (p, a, store) => {
      const ids: string[] = [...new Set<string>(a.location_ids)];
      if (ids.some(id => !store.location(p.tenantId, id))) return { status: 'not_found' };
      const task = store.createTask(p.tenantId, { kind: 'cycle_count', createdBy: p.userId, locationIds: ids });
      return { status: 'ok', data: { task_id: task.id, status: task.status, locations: ids.length } };
    },
  },
  {
    name: 'get_task',
    title: 'Get task',
    description: 'Look up a task you created earlier by its task_id.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    scopes: ['wms.tasks.read'],
    write: false,
    inputSchema: z.object({ task_id: z.string().min(1).max(32) }).strict(),
    handler: (p, a, store) => {
      // Possession of a task_id proves nothing. It is looked up inside the caller's tenant only.
      const t = store.task(p.tenantId, a.task_id);
      if (!t) return { status: 'not_found' };
      const { tenantId: _omit, ...visible } = t;
      return { status: 'ok', data: visible };
    },
  },
];

export const toolByName = new Map(tools.map(t => [t.name, t]));
