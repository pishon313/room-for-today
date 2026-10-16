import type { Item } from "./store";

export type Op = { id: string; record: string; patch: Partial<Item>; at: number };
export type UnreadableOp = { key: string; raw: string; detail: string };
const prefix = (uid: string) => "planner-pending:" + uid + ":";
function inspectPending(uid: string): { ops: Op[]; unreadable: UnreadableOp[] } {
  const ops: Op[] = [];
  const unreadable: UnreadableOp[] = [];
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix(uid)));
  } catch (error) {
    return {
      ops,
      unreadable: [{ key: "", raw: "", detail: String(error) }],
    };
  }
  for (const key of keys) {
    let raw = "";
    try {
      const value = localStorage.getItem(key);
      if (value === null) continue; // Another tab may have acknowledged it.
      raw = value;
      const op: unknown = JSON.parse(value);
      if (
        typeof op !== "object" || op === null ||
        typeof (op as Op).id !== "string" ||
        typeof (op as Op).record !== "string" ||
        typeof (op as Op).patch !== "object" ||
        (op as Op).patch === null || Array.isArray((op as Op).patch) ||
        typeof (op as Op).at !== "number" ||
        !Number.isFinite((op as Op).at) ||
        key !== prefix(uid) + (op as Op).id
      ) throw new Error("Pending edit has an invalid format.");
      ops.push(op as Op);
    } catch (error) {
      unreadable.push({ key, raw, detail: String(error) });
    }
  }
  ops.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { ops, unreadable };
}
export const pending = (uid: string): Op[] => inspectPending(uid).ops;

// Retain failed device writes across refreshes and retries until cloud acknowledgement.
export class Outbox {
  private memory = new Map<string, Op>();
  private confirmed = new Set<string>();
  private unreadable: UnreadableOp[] = [];
  private lastAt = 0;
  constructor(private uid: string) {}

  snapshot(): Op[] {
    const inspected = inspectPending(this.uid);
    this.unreadable = inspected.unreadable;
    const merged = new Map(inspected.ops.map((op) => [op.id, op]));
    for (const op of this.memory.values()) merged.set(op.id, op);
    return [...merged.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  }

  readIssues(): UnreadableOp[] {
    return [...this.unreadable];
  }

  hasMemoryPending(): boolean {
    return this.memory.size > 0;
  }

  confirmedIds(): string[] {
    return [...this.confirmed];
  }

  retryConfirmedCleanup(): string[] {
    return this.acknowledge(this.confirmedIds());
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

  private removeLocal(ids: string[], cloudConfirmed: boolean): string[] {
    const failed: string[] = [];
    for (const id of ids) {
      // A memory-only edit has no durable key, and may be saved even when
      // browser storage itself is blocked.
      if (this.memory.delete(id)) {
        this.confirmed.delete(id);
        continue;
      }
      if (cloudConfirmed) this.confirmed.add(id);
      try {
        localStorage.removeItem(prefix(this.uid) + id);
        this.confirmed.delete(id);
      } catch {
        failed.push(id);
      }
    }
    return failed;
  }

  acknowledge(ids: string[]): string[] {
    return this.removeLocal(ids, true);
  }

  discardRecord(record: string): number {
    const ids = this.snapshot()
      .filter((op) => op.record === record)
      .map((op) => op.id);
    // Clear durable keys first. If browser storage refuses removal, keep any
    // memory-only edits intact so a failed discard cannot lose their content.
    const durable = ids.filter((id) => !this.memory.has(id));
    const memoryOnly = ids.filter((id) => this.memory.has(id));
    const failed = this.removeLocal(durable, false);
    if (failed.length) throw new Error("Couldn’t clear this item from device storage.");
    this.removeLocal(memoryOnly, false);
    return ids.length;
  }

  discardUnreadable(key: string): boolean {
    if (!key.startsWith(prefix(this.uid))) return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}
