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
  collection,
  getDocs,
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
it("allows owner CRUD and rejects another account and anonymous access", async () => {
  const own = doc(
    env.authenticatedContext("alice").firestore(),
    "users/alice/items/test",
  );
  await assertSucceeds(setDoc(own, record()));
  await assertSucceeds(getDoc(own));
  await assertSucceeds(
    updateDoc(own, { title: "Edited", updatedAt: serverTimestamp() }),
  );
  for (const context of [
    env.authenticatedContext("bob"),
    env.unauthenticatedContext(),
  ]) {
    await assertFails(
      getDoc(doc(context.firestore(), "users/alice/items/test")),
    );
    await assertFails(
      setDoc(doc(context.firestore(), "users/alice/items/new"), record()),
    );
    await assertFails(
      getDocs(collection(context.firestore(), "users/alice/items")),
    );
  }
});
it("rejects invalid fields and resurrecting a deleted record", async () => {
  const ref = doc(
    env.authenticatedContext("alice").firestore(),
    "users/alice/items/validation",
  );
  await assertFails(setDoc(ref, { ...record(), unexpected: true }));
  await assertFails(setDoc(ref, { ...record(), time: "35:90" }));
  await assertSucceeds(setDoc(ref, record()));
  await assertSucceeds(
    updateDoc(ref, { deleted: true, updatedAt: serverTimestamp() }),
  );
  await assertFails(
    updateDoc(ref, { deleted: false, updatedAt: serverTimestamp() }),
  );
});
it("keeps routine schedule history private to its owner", async () => {
  const owner = env.authenticatedContext("alice").firestore();
  const other = env.authenticatedContext("bob").firestore();
  const baseline = doc(owner, "users/alice/items/routine-id_schedule_initial");
  const change = doc(owner, "users/alice/items/routine-id_schedule_2026-10-01");

  await assertSucceeds(setDoc(baseline, scheduleRecord("0001-01-01")));
  await assertSucceeds(setDoc(change, scheduleRecord("2026-10-01")));
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
  await assertSucceeds(setDoc(ref, routine));
  await assertSucceeds(updateDoc(ref, { title: "New title", updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { startDate: "2026-10-01", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, "users/alice/items/bad-start"), { ...routine, startDate: "bad" }));
  await assertFails(setDoc(doc(owner, "users/alice/items/task-start"), { ...record(), startDate: "2026-10-13" }));
  const legacy = doc(owner, "users/alice/items/legacy-routine");
  await assertSucceeds(setDoc(legacy, { ...record(), kind: "routine", period: "" }));
  await assertSucceeds(updateDoc(legacy, { days: [0, 2], updatedAt: serverTimestamp() }));
});
