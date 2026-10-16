import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Outbox, pending } from "../src/outbox";
import { batches, project } from "../src/store";

let storage: Record<string, string>;
let full: boolean;
let removalFails: boolean;
beforeEach(() => {
  storage = {};
  full = false;
  removalFails = false;
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => {
      if (full) throw new Error("quota exceeded");
      storage[key] = value;
    } },
    removeItem: { value: (key: string) => {
      if (removalFails) throw new Error("device storage removal failed");
      delete storage[key];
    } },
  });
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("retains storage failures through refresh, later edits and cloud acknowledgement", () => {
  const queue = new Outbox("alice");
  queue.enqueue("note", { kind: "memo", title: "original" });
  full = true;
  expect(queue.enqueue("note", { title: "unsaved thought" })).toBe(false);
  expect(project([], queue.snapshot())[0].title).toBe("unsaved thought");
  full = false;
  queue.enqueue("note", { body: "another edit" });
  const batch = batches(queue.snapshot())[0];
  expect(batch.patch).toMatchObject({ title: "unsaved thought", body: "another edit" });
  queue.acknowledge(batch.ids);
  expect(queue.snapshot()).toEqual([]);
});

it("orders same-millisecond edits despite reverse UUID order and a backwards clock", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce("ffffffff-ffff-4fff-8fff-ffffffffffff")
    .mockReturnValueOnce("00000000-0000-4000-8000-000000000000");
  const queue = new Outbox("alice");
  queue.enqueue("note", { title: "first" });
  queue.enqueue("note", { title: "latest" });
  expect(batches(pending("alice"))[0].patch.title).toBe("latest");
  vi.spyOn(Date, "now").mockReturnValue(1);
  new Outbox("alice").enqueue("note", { title: "after reload" });
  expect(batches(pending("alice"))[0].patch.title).toBe("after reload");
});

it("does not replay persisted edits acknowledged by another tab", () => {
  const queue = new Outbox("alice");
  queue.enqueue("note", { title: "old title" });
  const otherTab = new Outbox("alice");
  otherTab.acknowledge(otherTab.snapshot().map((op) => op.id));
  expect(queue.snapshot()).toEqual([]);
});

it("keeps edits made during an upload and separates accounts", () => {
  const queue = new Outbox("alice");
  full = true;
  queue.enqueue("note", { title: "first" });
  const uploading = queue.snapshot();
  queue.enqueue("note", { title: "newer" });
  queue.acknowledge(uploading.map((op) => op.id));
  expect(batches(queue.snapshot())[0].patch.title).toBe("newer");
  expect(new Outbox("bob").snapshot()).toEqual([]);
});

it("discards only the selected record, including memory-only edits", () => {
  const queue = new Outbox("alice");
  queue.enqueue("memo", { body: "durable unsaved body" });
  queue.enqueue("task", { title: "keep this task" });
  full = true;
  expect(queue.enqueue("memo", { body: "memory-only latest body" })).toBe(false);
  full = false;
  expect(queue.discardRecord("memo")).toBe(2);
  expect(queue.snapshot()).toMatchObject([
    { record: "task", patch: { title: "keep this task" } },
  ]);
});

it("acknowledges memory-only writes even when device removal fails, while retaining durable ones", () => {
  const queue = new Outbox("alice");
  queue.enqueue("stored", { title: "durable" });
  const durableId = queue.snapshot()[0].id;
  full = true;
  expect(queue.enqueue("memory", { title: "memory-only" })).toBe(false);
  const memoryId = queue.snapshot().find((op) => op.record === "memory")!.id;
  removalFails = true;
  expect(queue.acknowledge([memoryId])).toEqual([]);
  expect(queue.snapshot().map((op) => op.record)).toEqual(["stored"]);
  expect(queue.acknowledge([durableId])).toEqual([durableId]);
  expect(queue.snapshot().map((op) => op.record)).toEqual(["stored"]);
  removalFails = false;
  expect(queue.acknowledge([durableId])).toEqual([]);
  expect(queue.snapshot()).toEqual([]);
});

it("does not mark an unsaved edit confirmed when explicit discard cannot remove it", () => {
  const queue = new Outbox("alice");
  queue.enqueue("memo", { body: "keep this unsaved text" });
  const id = queue.snapshot()[0].id;
  removalFails = true;
  expect(() => queue.discardRecord("memo")).toThrow();
  expect(queue.confirmedIds()).not.toContain(id);
  expect(queue.snapshot()).toMatchObject([
    { id, record: "memo", patch: { body: "keep this unsaved text" } },
  ]);
  removalFails = false;
  expect(queue.discardRecord("memo")).toBe(1);
  expect(queue.snapshot()).toEqual([]);
});

it("retains memory-only edits when a durable edit for the same item cannot be discarded", () => {
  const queue = new Outbox("alice");
  queue.enqueue("memo", { body: "durable draft" });
  const durableId = queue.snapshot()[0].id;
  full = true;
  expect(queue.enqueue("memo", { body: "newer memory-only draft" })).toBe(false);
  const memoryId = queue.snapshot().find((op) => op.id !== durableId)!.id;
  full = false;
  removalFails = true;
  expect(() => queue.discardRecord("memo")).toThrow();
  expect(queue.snapshot().map((op) => op.id)).toEqual([durableId, memoryId]);
  expect(queue.confirmedIds()).toEqual([]);
  removalFails = false;
  expect(queue.discardRecord("memo")).toBe(2);
  expect(queue.snapshot()).toEqual([]);
});

it("isolates a corrupt durable entry and discards only that entry", () => {
  const badKey = "planner-pending:alice:corrupt";
  storage[badKey] = "{not-json";
  const queue = new Outbox("alice");
  expect(queue.enqueue("good", { title: "keep this valid edit" })).toBe(true);
  expect(queue.snapshot()).toMatchObject([
    { record: "good", patch: { title: "keep this valid edit" } },
  ]);
  expect(queue.readIssues()).toEqual([
    { key: badKey, raw: "{not-json", detail: expect.any(String) },
  ]);
  expect(queue.discardUnreadable(badKey)).toBe(true);
  expect(queue.snapshot()).toHaveLength(1);
  expect(queue.readIssues()).toEqual([]);
});
