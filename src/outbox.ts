import type { Item } from "./store";

// Untagged entries were written by older releases without server replay evidence.
// They must be reviewed before being sent again.
export type Op = { id: string; record: string; patch: Partial<Item>; at: number; protocol?: 2 };
export type UnreadableOp = { key: string; raw: string; detail: string };
const prefix = (uid: string) => "planner-pending:" + uid + ":";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, part]) => [key, canonical(part)]),
    );
  return value;
}

// The marker is immutable. Its hash binds a stable operation ID to exactly one
// record and patch, so a colliding or modified queued entry cannot be cleared.
export async function operationPayloadHash(op: Pick<Op, "record" | "patch">): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([op.record, canonical(op.patch)]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
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
        ((op as Op).protocol !== undefined && (op as Op).protocol !== 2) ||
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
      protocol: 2,
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

  // An old entry might already have reached the cloud. Only an explicit user
  // action can reinterpret it as a new edit. Persist the v2 tag before upload;
  // if storage rejects the change, the old entry stays quarantined.
  promoteRecord(record: string): boolean {
    let successful = true;
    for (const op of this.snapshot().filter((queued) => queued.record === record && queued.protocol !== 2)) {
      const upgraded: Op = { ...op, protocol: 2 };
      if (this.memory.has(op.id)) {
        this.memory.set(op.id, upgraded);
        continue;
      }
      try {
        localStorage.setItem(prefix(this.uid) + op.id, JSON.stringify(upgraded));
      } catch {
        successful = false;
      }
    }
    return successful;
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
