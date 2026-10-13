import type { Item } from "./store";

export type Op = { id: string; record: string; patch: Partial<Item>; at: number };
const prefix = (uid: string) => "planner-pending:" + uid + ":";
export const pending = (uid: string): Op[] =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix(uid)))
    .map((k) => JSON.parse(localStorage.getItem(k)!))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

// Retain failed device writes across refreshes and retries until cloud acknowledgement.
export class Outbox {
  private memory = new Map<string, Op>();
  private lastAt = 0;
  constructor(private uid: string) {}

  snapshot(): Op[] {
    let stored: Op[] = [];
    try {
      stored = pending(this.uid);
    } catch {
      // Memory edits can still be uploaded when browser storage is unavailable.
    }
    const merged = new Map(stored.map((op) => [op.id, op]));
    for (const op of this.memory.values()) merged.set(op.id, op);
    return [...merged.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }

  enqueue(record: string, patch: Partial<Item>): boolean {
    const latest = this.snapshot().reduce((at, op) => Math.max(at, op.at), this.lastAt);
    const op: Op = {
      id: crypto.randomUUID(), record, patch,
      at: Math.max(Date.now(), latest + 1),
    };
    this.lastAt = op.at;
    this.memory.set(op.id, op);
    try {
      localStorage.setItem(prefix(this.uid) + op.id, JSON.stringify(op));
      this.memory.delete(op.id);
      return true;
    } catch {
      return false;
    }
  }

  acknowledge(ids: string[]) {
    for (const id of ids) {
      localStorage.removeItem(prefix(this.uid) + id);
      this.memory.delete(id);
    }
  }
}
