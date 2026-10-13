import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { today } from "./dates";
import { Outbox, type Op } from "./outbox";
export type Kind =
  | "monthly"
  | "weekly"
  | "daily"
  | "routine"
  | "memo"
  | "completion"
  | "schedule";
export type Item = {
  id: string;
  kind: Kind;
  period: string;
  title: string;
  body: string;
  time: string;
  done: boolean;
  days: number[];
  deleted: boolean;
  startDate?: string;
};
export function batches(ops: Op[]) {
  const groups = new Map<
    string,
    { record: string; patch: Partial<Item>; ids: string[] }
  >();
  for (const op of ops) {
    const g = groups.get(op.record) || {
      record: op.record,
      patch: {},
      ids: [],
    };
    g.patch = { ...g.patch, ...op.patch };
    g.ids.push(op.id);
    groups.set(op.record, g);
  }
  return [...groups.values()];
}
export function project(cloud: Item[], ops: Op[]) {
  const map = new Map(cloud.map((x) => [x.id, x]));
  for (const o of ops)
    map.set(o.record, {
      ...map.get(o.record),
      ...o.patch,
      id: o.record,
    } as Item);
  return [...map.values()].filter((x) => !x.deleted);
}
export function usePlanner(uid: string | undefined) {
  const outboxes = useRef(new Map<string, Outbox>());
  const getOutbox = (account: string) => {
    let outbox = outboxes.current.get(account);
    if (!outbox) {
      outbox = new Outbox(account);
      outboxes.current.set(account, outbox);
    }
    return outbox;
  };
  const [restart, setRestart] = useState(0);
  const [cloud, setCloud] = useState<Item[]>([]),
    [ops, setOps] = useState<Op[]>([]),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setCloud([]);
    setOps([]);
    setReady(false);
    setConfirmed(false);
    setError("");
    if (!uid || !db) return;
    const outbox = getOutbox(uid);
    let alive = true;
    let running = false;
    const refresh = () => {
      if (alive) setOps(outbox.snapshot());
    };
    const flush = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        await navigator.locks.request("planner-sync:" + uid, async () => {
          for (const op of batches(outbox.snapshot())) {
            if (!alive) break;
            const slow = setTimeout(() => {
              if (alive)
                setError(
                  "Couldn’t confirm saving. Your edits remain pending; reconnect or retry.",
                );
            }, 12000);
            try {
              await setDoc(
                doc(db!, "users", uid, "items", op.record),
                { ...op.patch, updatedAt: serverTimestamp() },
                { merge: true },
              );
            } finally {
              clearTimeout(slow);
            }
            outbox.acknowledge(op.ids);
            if (alive) {
              setError("");
              refresh();
              window.dispatchEvent(new Event("planner-queue"));
            }
          }
        });
      } catch (e) {
        if (alive)
          setError(
            "Couldn’t save. Your edits are kept on this device. " +
              (e instanceof Error ? e.message : ""),
          );
      } finally {
        running = false;
      }
    };
    let debounce: ReturnType<typeof setTimeout>;
    const changed = () => {
      refresh();
      clearTimeout(debounce);
      debounce = setTimeout(() => void flush(), 700);
    };
    const network = () => {
      setOnline(navigator.onLine);
      changed();
    };
    const unsub = onSnapshot(
      collection(db, "users", uid, "items"),
      { includeMetadataChanges: true },
      (snap) => {
        if (!alive) return;
        setCloud(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Item));
        setReady(true);
        setConfirmed(
          !snap.metadata.fromCache && !snap.metadata.hasPendingWrites,
        );
      },
      (e) => {
        setError("Couldn’t load cloud plans: " + e.message);
        setReady(false);
      },
    );
    refresh();
    void flush();
    window.addEventListener("storage", changed);
    window.addEventListener("planner-queue", changed);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    const timer = setInterval(() => void flush(), 15000);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
      clearTimeout(debounce);
      window.removeEventListener("storage", changed);
      window.removeEventListener("planner-queue", changed);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [uid, restart]);
  const patch = (record: string, data: Partial<Item>) => {
    if (!uid) return;
    const outbox = getOutbox(uid);
    const durable = outbox.enqueue(record, data);
    setOps(outbox.snapshot());
    if (!durable) {
      setError(
        "Couldn’t save to device storage. Keep this page open and copy your text before closing; cloud saving will retry.",
      );
    }
    window.dispatchEvent(new Event("planner-queue"));
  };
  const add = (kind: Kind, period: string, extra: Partial<Item> = {}) => {
    const id = crypto.randomUUID();
    patch(id, {
      kind,
      period,
      title: "",
      body: "",
      time: "",
      done: false,
      days: [0, 1, 2, 3, 4],
      deleted: false,
      ...(kind === "routine" ? { startDate: today() } : {}),
      ...extra,
    });
    return id;
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ops.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ops.length]);
  return {
    items: project(cloud, ops),
    patch,
    add,
    ready,
    error,
    pendingCount: ops.length,
    status: !uid
      ? "Sign in to save"
      : error
        ? "Couldn’t save"
        : !online
          ? `Offline · ${ops.length} pending`
          : ops.length
            ? "Saving…"
            : confirmed
              ? "Saved"
              : "Connecting…",
    retry: () => setRestart((n) => n + 1),
  };
}
