export interface OwnedValue {
  ownerId: number;
}

export type OwnerLookup<V> =
  | { status: 'ok'; value: V }
  | { status: 'missing' }
  | { status: 'forbidden' };

interface Entry<V> {
  value: V;
  expiresAt: number;
}

/** 小型内存 TTL + LRU；get 仅允许所有者刷新最近使用顺序。 */
export class TtlLruStore<V extends OwnedValue> {
  private readonly entries = new Map<string, Entry<V>>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  getOwned(key: string, ownerId: number): OwnerLookup<V> {
    const entry = this.entries.get(key);
    if (!entry) return { status: 'missing' };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { status: 'missing' };
    }
    if (entry.value.ownerId !== ownerId) return { status: 'forbidden' };
    this.entries.delete(key);
    this.entries.set(key, { ...entry, expiresAt: this.now() + this.ttlMs });
    return { status: 'ok', value: entry.value };
  }

  deleteOwned(key: string, ownerId: number): void {
    const entry = this.entries.get(key);
    if (entry?.value.ownerId === ownerId) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
