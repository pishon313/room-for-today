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
import { Outbox, type Op, type UnreadableOp } from "./outbox";
export type Kind =
  | "monthly"
  | "weekly"
  | "daily"
  | "routine"
  | "memo"
  | "bucket"
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
  createdAt?: number;
  completedAt?: string;
};
export type SaveIssue = {
  record: string;
  kind: "rejected" | "temporary" | "cleanup";
  code: string;
  detail: string;
};
export type PendingRecord = {
  record: string;
  item: Partial<Item>;
  changes: number;
  saving: boolean;
  issue?: SaveIssue;
};
type TrackedIssue = SaveIssue & { signature: string };
const persistentCodes = new Set([
  "permission-denied",
  "invalid-argument",
  "failed-precondition",
  "out-of-range",
  "unimplemented",
]);
function classifyError(error: unknown): Omit<SaveIssue, "record"> {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "unknown";
  return {
    kind: persistentCodes.has(code) ? "rejected" : "temporary",
    code,
    detail: error instanceof Error ? error.message : String(error),
  };
}
const signature = (ids: string[]) => ids.join("|");
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
  const retryRef = useRef<(record?: string) => void>(() => {});
  const discardRef = useRef<(record: string) => Promise<boolean>>(
    async () => false,
  );
  const discardUnreadableRef = useRef<(key: string) => Promise<boolean>>(
    async () => false,
  );
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
    [issues, setIssues] = useState<SaveIssue[]>([]),
    [unreadable, setUnreadable] = useState<UnreadableOp[]>([]),
    [confirmedIds, setConfirmedIds] = useState<string[]>([]),
    [savingRecords, setSavingRecords] = useState<string[]>([]),
    [storageError, setStorageError] = useState(""),
    [cleanupError, setCleanupError] = useState(""),
    [actionError, setActionError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loadDetail, setLoadDetail] = useState(""),
    [syncError, setSyncError] = useState(""),
    [slowWarning, setSlowWarning] = useState(""),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setCloud([]);
    setOps([]);
    setIssues([]);
    setUnreadable([]);
    setConfirmedIds([]);
    setSavingRecords([]);
    setReady(false);
    setConfirmed(false);
    setStorageError("");
    setCleanupError("");
    setActionError("");
    setLoadError("");
    setLoadDetail("");
    setSyncError("");
    setSlowWarning("");
    if (!uid || !db) return;
    const outbox = getOutbox(uid);
    const failures = new Map<string, TrackedIssue>();
    const discarding = new Set<string>();
    const uploading = new Set<string>();
    let alive = true;
    let running = false;
    let rerun = false;
    let forceAll = false;
    const forceRecords = new Set<string>();
    const publishIssues = () => {
      if (alive)
        setIssues(
          [...failures.values()].map(({ signature: _signature, ...issue }) =>
            issue,
          ),
        );
    };
    const refresh = () => {
      const snapshot = outbox.snapshot();
      const acknowledged = new Set(outbox.confirmedIds());
      const groups = new Map(batches(snapshot.filter((op) => !acknowledged.has(op.id))).map((group) => [group.record, group]));
      let changed = false;
      for (const [record, issue] of failures) {
        const group = groups.get(record);
        if (!group || issue.signature !== signature(group.ids)) {
          failures.delete(record);
          changed = true;
        }
      }
      if (alive) {
        setOps(snapshot);
        setUnreadable(outbox.readIssues());
        setConfirmedIds([...acknowledged]);
        if (!outbox.hasMemoryPending()) setStorageError("");
        if (!acknowledged.size) setCleanupError("");
        if (!snapshot.length && !outbox.readIssues().length) setActionError("");
      }
      if (changed) publishIssues();
      return snapshot;
    };
    const flush = async () => {
      if (running) {
        rerun = true;
        return;
      }
      if (!navigator.onLine) return;
      running = true;
      const retryEverything = forceAll;
      const retryThese = new Set(forceRecords);
      forceAll = false;
      forceRecords.clear();
      try {
        await navigator.locks.request("planner-sync:" + uid, async () => {
          if (!alive) return;
          setSyncError("");
          const uncleared = outbox.retryConfirmedCleanup();
          if (uncleared.length)
            setCleanupError("Cloud saving succeeded, but device storage could not clear its pending copy. Retry when storage is available.");
          for (const initial of batches(refresh().filter((op) => !outbox.confirmedIds().includes(op.id)))) {
            if (!alive) break;
            const op = batches(outbox.snapshot().filter((queued) => !outbox.confirmedIds().includes(queued.id))).find(
              (group) => group.record === initial.record,
            );
            if (!op || discarding.has(op.record)) continue;
            const previous = failures.get(op.record);
            if (
              previous?.kind === "rejected" &&
              previous.signature === signature(op.ids) &&
              !retryEverything &&
              !retryThese.has(op.record)
            )
              continue;
            uploading.add(op.record);
            setSavingRecords([op.record]);
            const slow = setTimeout(() => {
              if (alive)
                setSlowWarning("The server has not confirmed this save yet.");
            }, 12000);
            try {
              await setDoc(
                doc(db!, "users", uid, "items", op.record),
                { ...op.patch, updatedAt: serverTimestamp() },
                { merge: true },
              );
              const uncleared = outbox.acknowledge(op.ids);
              if (uncleared.length)
                setCleanupError("Cloud saving succeeded, but device storage could not clear its pending copy. Retry when storage is available.");
              failures.delete(op.record);
              publishIssues();
            } catch (error) {
              failures.set(op.record, {
                record: op.record,
                ...classifyError(error),
                signature: signature(op.ids),
              });
              publishIssues();
            } finally {
              clearTimeout(slow);
              uploading.delete(op.record);
              if (alive) {
                setSlowWarning("");
                setSavingRecords([]);
                refresh();
              }
            }
          }
        });
      } catch {
        if (alive)
          setSyncError("Couldn’t start syncing. Your edits remain on this device.");
      } finally {
        running = false;
        if (rerun && alive) {
          rerun = false;
          void flush();
        }
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
    retryRef.current = (record) => {
      if (record) forceRecords.add(record);
      else forceAll = true;
      void flush();
    };
    discardRef.current = async (record) => {
      if (uploading.has(record)) return false;
      discarding.add(record);
      try {
        return await navigator.locks.request("planner-sync:" + uid, () => {
          try {
            const discarded = outbox.discardRecord(record);
            failures.delete(record);
            publishIssues();
            setActionError("");
            return discarded > 0;
          } finally {
            refresh();
          }
        });
      } catch {
        if (alive)
          setActionError("Couldn’t discard these edits from device storage. Please try again.");
        return false;
      } finally {
        discarding.delete(record);
      }
    };
    discardUnreadableRef.current = async (key) => {
      try {
        return await navigator.locks.request("planner-sync:" + uid, () => {
          const discarded = outbox.discardUnreadable(key);
          refresh();
          setActionError(discarded ? "" : "Couldn’t discard this unreadable device entry. Please try again.");
          return discarded;
        });
      } catch {
        if (alive)
          setActionError("Couldn’t discard this unreadable device entry. Please try again.");
        return false;
      }
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
        setLoadError("");
        setLoadDetail("");
      },
      (e) => {
        if (!alive) return;
        setLoadError("Couldn’t load your cloud plans.");
        setLoadDetail(e.message);
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
      retryRef.current = () => {};
      discardRef.current = async () => false;
      discardUnreadableRef.current = async () => false;
    };
  }, [uid, restart]);
  const patch = (record: string, data: Partial<Item>) => {
    if (!uid) return;
    const outbox = getOutbox(uid);
    const durable = outbox.enqueue(record, data);
    setOps(outbox.snapshot());
    if (!durable) {
      setStorageError(
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
      ...(kind === "bucket" ? { createdAt: Date.now(), completedAt: "" } : {}),
      ...extra,
    });
    return id;
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ops.length || unreadable.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ops.length, unreadable.length]);
  const confirmedSet = new Set(confirmedIds);
  const activeOps = ops.filter((op) => !confirmedSet.has(op.id));
  const pendingRecords: PendingRecord[] = batches(ops).map((group) => ({
    record: group.record,
    item: {
      ...cloud.find((item) => item.id === group.record),
      ...group.patch,
      id: group.record,
    },
    changes: group.ids.length,
    saving: savingRecords.includes(group.record),
    issue: issues.find((issue) => issue.record === group.record) ||
      (group.ids.every((id) => confirmedSet.has(id))
        ? {
            record: group.record,
            kind: "cleanup" as const,
            code: "device-storage",
            detail: "This edit reached the cloud, but its pending device copy could not be removed.",
          }
        : undefined),
  }));
  const error = issues.length
    ? `${issues.length} item${issues.length === 1 ? "" : "s"} couldn’t be saved. Your edits remain on this device.`
    : unreadable.length
      ? "Some pending edits couldn’t be read from device storage. Review them before leaving."
      : cleanupError || actionError || storageError || syncError || loadError;
  return {
    items: project(cloud, activeOps),
    patch,
    add,
    ready,
    error,
    loadError,
    loadDetail,
    storageError,
    cleanupError,
    actionError,
    syncError,
    slowWarning,
    issues,
    unreadable,
    pendingRecords,
    pendingCount: ops.length + unreadable.length,
    status: !uid
      ? "Sign in to save"
      : loadError
        ? "Couldn’t load"
        : error
        ? "Couldn’t save"
        : !online
          ? `Offline · ${ops.length + unreadable.length} pending`
          : ops.length || unreadable.length
            ? "Saving…"
            : confirmed
              ? "Saved"
              : "Connecting…",
    retry: (record?: string) => {
      if (loadError) setRestart((n) => n + 1);
      else retryRef.current(record);
    },
    discard: (record: string) => discardRef.current(record),
    discardUnreadable: (key: string) => discardUnreadableRef.current(key),
  };
}
