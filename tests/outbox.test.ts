import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Outbox, pending } from "../src/outbox";
import { batches, project } from "../src/store";

let storage: Record<string, string>;
let full: boolean;
beforeEach(() => {
  storage = {};
  full = false;
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => {
      if (full) throw new Error("quota exceeded");
      storage[key] = value;
    } },
    removeItem: { value: (key: string) => { delete storage[key]; } },
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
