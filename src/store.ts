import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
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
};
type Op = { id: string; record: string; patch: Partial<Item>; at: number };
const prefix = (uid: string) => "planner-pending:" + uid + ":";
export const pending = (uid: string): Op[] =>
  Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix(uid)))
    .map((k) => JSON.parse(localStorage.getItem(k)!))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
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
    let alive = true;
    let running = false;
    const refresh = () => {
      if (alive) setOps(pending(uid));
    };
    const flush = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        await navigator.locks.request("planner-sync:" + uid, async () => {
          for (const op of batches(pending(uid))) {
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
            for (const id of op.ids) localStorage.removeItem(prefix(uid) + id);
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
    const op: Op = {
      id: crypto.randomUUID(),
      record,
      patch: data,
      at: Date.now(),
    };
    try {
      localStorage.setItem(prefix(uid) + op.id, JSON.stringify(op));
      setOps(pending(uid));
      window.dispatchEvent(new Event("planner-queue"));
    } catch {
      setOps((prev) => [...prev, op]);
      setError(
        "Couldn’t save: device storage is full. Keep this page open and copy your text before closing.",
      );
    }
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
