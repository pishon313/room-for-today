import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { beforeAll, afterAll, it } from "vitest";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-planner",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
  // Fixed record IDs below must start clean even when this suite is rerun
  // against an already-running local emulator.
  await env.clearFirestore();
});
afterAll(async () => {
  await env.cleanup();
});
const record = () => ({
  kind: "daily",
  period: "2026-10-03",
  title: "Private task",
  body: "",
  time: "",
  days: [],
  done: false,
  deleted: false,
  updatedAt: serverTimestamp(),
});
const scheduleRecord = (period: string) => ({
  ...record(),
  kind: "schedule",
  period,
  title: "routine-id",
  days: [0, 2, 4],
});
const bucketRecord = () => ({
  ...record(),
  kind: "bucket",
  period: "",
  title: "See the northern lights",
  createdAt: 1791072000000,
  completedAt: "",
});
const payloadHash = "a".repeat(64);
// A planner write and its replay marker must commit together. Keep all
// existing validation cases using this pair so they test their actual rules.
function pairedWrite(
  firestore: Firestore,
  uid: string,
  reference: DocumentReference,
  patch: Record<string, unknown>,
  opId = crypto.randomUUID(),
) {
  const batch = writeBatch(firestore);
  batch.set(reference, { ...patch, lastOpId: opId, updatedAt: serverTimestamp() }, { merge: true });
  batch.set(doc(firestore, "users", uid, "appliedOps", opId), {
    record: reference.id,
    payloadHash,
    appliedAt: serverTimestamp(),
  });
  return batch.commit();
}
it("allows owner edits and rejects hard deletion, another account, and anonymous access", async () => {
  const alice = env.authenticatedContext("alice").firestore();
  const own = doc(alice, "users/alice/items/test");
  await assertSucceeds(pairedWrite(alice, "alice", own, record()));
  await assertSucceeds(getDoc(own));
  await assertSucceeds(
    pairedWrite(alice, "alice", own, { title: "Edited" }),
  );
  await assertFails(deleteDoc(own));
  for (const context of [
    env.authenticatedContext("bob"),
    env.unauthenticatedContext(),
  ]) {
    await assertFails(
      getDoc(doc(context.firestore(), "users/alice/items/test")),
    );
    await assertFails(
      pairedWrite(context.firestore(), "alice", doc(context.firestore(), "users/alice/items/new"), record()),
    );
    await assertFails(
      getDocs(collection(context.firestore(), "users/alice/items")),
    );
  }
});
it("rejects invalid fields and resurrecting a deleted record", async () => {
  const alice = env.authenticatedContext("alice").firestore();
  const ref = doc(alice, "users/alice/items/validation");
  await assertFails(pairedWrite(alice, "alice", ref, { ...record(), unexpected: true }));
  await assertFails(pairedWrite(alice, "alice", ref, { ...record(), time: "35:90" }));
  await assertSucceeds(pairedWrite(alice, "alice", ref, record()));
  await assertSucceeds(
    pairedWrite(alice, "alice", ref, { deleted: true }),
  );
  await assertFails(
    pairedWrite(alice, "alice", ref, { deleted: false }),
  );
});
it("keeps routine schedule history private to its owner", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const other = env.authenticatedContext("bob").firestore();
  const baseline = doc(owner, "users/alice/items/routine-id_schedule_initial");
  const change = doc(owner, "users/alice/items/routine-id_schedule_2026-10-01");

  await assertSucceeds(pairedWrite(owner, "alice", baseline, scheduleRecord("0001-01-01")));
  await assertSucceeds(pairedWrite(owner, "alice", change, scheduleRecord("2026-10-01")));
  await assertSucceeds(getDoc(baseline));
  await assertFails(
    getDoc(doc(other, "users/alice/items/routine-id_schedule_initial")),
  );
  await assertFails(
    setDoc(
      doc(other, "users/alice/items/routine-id_schedule_2026-10-02"),
      scheduleRecord("2026-10-02"),
    ),
  );
});

it("validates immutable routine start dates and keeps legacy routines editable", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const ref = doc(owner, "users/alice/items/new-routine");
  const routine = { ...record(), kind: "routine", period: "", startDate: "2026-10-13" };
  await assertSucceeds(pairedWrite(owner, "alice", ref, routine));
  await assertSucceeds(pairedWrite(owner, "alice", ref, { title: "New title" }));
  await assertFails(pairedWrite(owner, "alice", ref, { startDate: "2026-10-01" }));
  await assertFails(pairedWrite(owner, "alice", doc(owner, "users/alice/items/bad-start"), { ...routine, startDate: "bad" }));
  await assertFails(pairedWrite(owner, "alice", doc(owner, "users/alice/items/task-start"), { ...record(), startDate: "2026-10-13" }));
  const legacy = doc(owner, "users/alice/items/legacy-routine");
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/alice/items/legacy-routine"), {
      ...record(), kind: "routine", period: "",
    });
  });
  await assertSucceeds(pairedWrite(owner, "alice", legacy, { days: [0, 2] }));
});

it("allows a bucket item to be edited and completed while keeping it private", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const other = env.authenticatedContext("bob").firestore();
  const ref = doc(owner, "users/alice/items/bucket-valid");
  await assertSucceeds(pairedWrite(owner, "alice", ref, bucketRecord()));
  await assertSucceeds(pairedWrite(owner, "alice", ref, { body: "Travel in winter" }));
  await assertSucceeds(pairedWrite(owner, "alice", ref, {
    done: true,
    completedAt: "2026-10-16",
  }));
  await assertSucceeds(pairedWrite(owner, "alice", ref, {
    done: false,
    completedAt: "",
  }));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(other, "users/alice/items/bucket-valid")));
  await assertFails(pairedWrite(other, "alice", doc(other, "users/alice/items/bucket-other"), bucketRecord()));
});

it("rejects invalid bucket metadata and protects the creation date", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const ref = doc(owner, "users/alice/items/bucket-validation");
  const bucket = bucketRecord();
  const missingCreatedAt: Record<string, unknown> = { ...bucket };
  delete missingCreatedAt.createdAt;
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, period: "2026-10-16" }));
  await assertFails(pairedWrite(owner, "alice", ref, missingCreatedAt));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, createdAt: "2026-10-16" }));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, completedAt: "October 16" }));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, done: true, completedAt: "2026-13-16" }));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, done: true, completedAt: "2026-10-32" }));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, completedAt: "2026-10-16" }));
  await assertFails(pairedWrite(owner, "alice", ref, { ...bucket, done: true }));
  await assertFails(pairedWrite(owner, "alice", doc(owner, "users/alice/items/daily-bucket-fields"), {
    ...record(),
    createdAt: bucket.createdAt,
    completedAt: "",
  }));
  await assertSucceeds(pairedWrite(owner, "alice", ref, bucket));
  await assertFails(pairedWrite(owner, "alice", ref, { createdAt: bucket.createdAt + 1 }));
  await assertFails(pairedWrite(owner, "alice", ref, { done: true }));
});

it("requires the item and immutable replay marker to be written atomically", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const other = env.authenticatedContext("bob").firestore();
  const ref = doc(owner, "users/alice/items/replay-pair");
  const opId = crypto.randomUUID();
  const marker = doc(owner, "users/alice/appliedOps", opId);
  await assertFails(setDoc(ref, { ...record(), lastOpId: opId }));
  await assertFails(setDoc(marker, {
    record: ref.id, payloadHash, appliedAt: serverTimestamp(),
  }));
  const mismatchedId = crypto.randomUUID();
  const mismatched = writeBatch(owner);
  mismatched.set(ref, { ...record(), lastOpId: mismatchedId });
  mismatched.set(doc(owner, "users/alice/appliedOps", mismatchedId), {
    record: "another-item", payloadHash, appliedAt: serverTimestamp(),
  });
  await assertFails(mismatched.commit());
  await assertSucceeds(pairedWrite(owner, "alice", ref, record(), opId));
  await assertSucceeds(getDoc(marker));
  await assertFails(updateDoc(marker, { payloadHash: "b".repeat(64) }));
  await assertFails(deleteDoc(marker));
  await assertFails(getDoc(doc(other, "users/alice/appliedOps", opId)));
  await assertFails(setDoc(doc(other, "users/alice/appliedOps", crypto.randomUUID()), {
    record: ref.id, payloadHash, appliedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(ref, {
    title: "A replay cannot reuse the marker", lastOpId: opId, updatedAt: serverTimestamp(),
  }, { merge: true }));
});
