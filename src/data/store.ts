/**
 * A fake, in-memory warehouse. Every function takes tenantId FIRST and only
 * ever looks inside that tenant's partition. There is no "all tenants" query.
 * In a real database the same idea is a tenant column on every table plus
 * row-level security, so a forgotten WHERE clause still cannot cross tenants.
 */
export interface StockRow { sku: string; locationId: string; onHand: number; allocated: number; note: string }
export interface Location { id: string; zone: string; type: 'pick' | 'reserve' | 'dock' }
export interface Task {
  id: string; tenantId: string; createdBy: string;
  kind: 'putaway' | 'cycle_count'; status: 'open';
  sku?: string; quantity?: number; fromLocationId?: string; toLocationId?: string;
  locationIds?: string[]; createdAt: string;
}

interface Partition { stock: StockRow[]; locations: Location[]; tasks: Map<string, Task> }

export class WarehouseStore {
  private partitions = new Map<string, Partition>();
  private seq = 0;

  seedTenant(tenantId: string, data: { stock: StockRow[]; locations: Location[] }) {
    this.partitions.set(tenantId, { ...structuredClone(data), tasks: new Map() });
  }

  private p(tenantId: string): Partition {
    const part = this.partitions.get(tenantId);
    if (!part) throw new Error('Unknown tenant');
    return part;
  }

  stockForSku(tenantId: string, sku: string, locationId?: string): StockRow[] {
    return this.p(tenantId).stock.filter(r => r.sku === sku && (!locationId || r.locationId === locationId));
  }

  locations(tenantId: string, zone: string | undefined, offset: number, limit: number) {
    const all = this.p(tenantId).locations.filter(l => !zone || l.zone === zone);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  location(tenantId: string, id: string): Location | undefined {
    return this.p(tenantId).locations.find(l => l.id === id);
  }

  createTask(tenantId: string, t: Omit<Task, 'id' | 'tenantId' | 'status' | 'createdAt'>): Task {
    const task: Task = { ...t, id: `task_${(++this.seq).toString().padStart(6, '0')}`, tenantId, status: 'open', createdAt: new Date().toISOString() };
    this.p(tenantId).tasks.set(task.id, task);
    return task;
  }

  /** Looks up a task handle INSIDE the caller's tenant only. A handle from another tenant is simply not found. */
  task(tenantId: string, id: string): Task | undefined {
    return this.p(tenantId).tasks.get(id);
  }

  countTasks(tenantId: string): number {
    return this.p(tenantId).tasks.size;
  }
}
