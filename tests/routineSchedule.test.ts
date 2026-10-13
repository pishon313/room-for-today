import { describe, expect, it } from "vitest";
import type { Item } from "../src/store";
import {
  effectiveRoutineDays,
  routineWeekProgress,
} from "../src/routineSchedule";
import { weekDays } from "../src/dates";

const item = (values: Partial<Item> & Pick<Item, "id" | "kind">): Item => ({
  period: "",
  title: "",
  body: "",
  time: "",
  done: false,
  days: [],
  deleted: false,
  ...values,
});

const routine = item({
  id: "reading",
  kind: "routine",
  title: "Read",
  days: [1, 3, 5],
});

const history = [
  item({
    id: "reading_schedule_initial",
    kind: "schedule",
    title: "reading",
    period: "0001-01-01",
    days: [0, 2, 4],
  }),
  item({
    id: "reading_schedule_october",
    kind: "schedule",
    title: "reading",
    period: "2026-10-01",
    days: [1, 3, 5],
  }),
];

describe("routine schedule history", () => {
  it("uses the routine weekdays when no schedule records exist", () => {
    expect(effectiveRoutineDays(routine, "2026-09-30", [])).toEqual([1, 3, 5]);
  });

  it("uses the latest effective schedule without changing earlier dates", () => {
    expect(effectiveRoutineDays(routine, "2026-09-30", history)).toEqual([
      0, 2, 4,
    ]);
    expect(effectiveRoutineDays(routine, "2026-10-01", history)).toEqual([
      1, 3, 5,
    ]);
    expect(effectiveRoutineDays(routine, "2027-01-01", history)).toEqual([
      1, 3, 5,
    ]);
  });

  it("preserves the past week's denominator and counts only scheduled completions across a month boundary", () => {
    const completions = [
      item({
        id: "reading_2026-09-28",
        kind: "completion",
        period: "2026-09-28",
        title: "reading",
        done: true,
      }),
      item({
        id: "reading_2026-10-01",
        kind: "completion",
        period: "2026-10-01",
        title: "reading",
        done: true,
      }),
      item({
        id: "reading_2026-10-02",
        kind: "completion",
        period: "2026-10-02",
        title: "reading",
        done: true,
      }),
    ];
    expect(
      routineWeekProgress([routine], weekDays("2026-10-01"), [
        ...history,
        ...completions,
      ]),
    ).toEqual({ done: 2, total: 4 });
  });

  it("does not let a future schedule change the previous week's count", () => {
    expect(
      routineWeekProgress([routine], weekDays("2026-09-21"), history),
    ).toEqual({ done: 0, total: 3 });
  });
});

it("excludes dates before a new routine starts, including with schedule history", () => {
  const newlyCreated = { ...routine, startDate: "2026-10-01" };
  expect(effectiveRoutineDays(newlyCreated, "2026-09-30", history)).toEqual([]);
  expect(effectiveRoutineDays(newlyCreated, "2026-10-01", history)).toEqual([1, 3, 5]);
  expect(routineWeekProgress([newlyCreated], weekDays("2026-09-21"), history))
    .toEqual({ done: 0, total: 0 });
  expect(routineWeekProgress([newlyCreated], weekDays("2026-10-01"), history))
    .toEqual({ done: 0, total: 2 });
});
