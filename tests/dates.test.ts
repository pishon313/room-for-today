import { describe, it, expect } from "vitest";
import {
  today,
  shift,
  weekStart,
  weekDays,
  monthShift,
  calendar,
} from "../src/dates";
import { project, batches } from "../src/store";
describe("Seoul calendar", () => {
  it("uses Seoul midnight even when UTC is the previous date", () => {
    expect(today(new Date("2026-10-02T15:01:00Z"))).toBe("2026-10-03");
  });
  it("keeps Monday weeks across month and year boundaries", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
    expect(weekDays("2027-01-01")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
  it("handles leap days and months with fewer days", () => {
    expect(shift("2028-02-28", 1)).toBe("2028-02-29");
    expect(monthShift("2026-01-31", 1)).toBe("2026-02-01");
    expect(calendar("2026-10-01")[0]).toBe("2026-09-28");
  });
});
describe("pending edits", () => {
  it("coalesces text edits without replacing unrelated fields", () => {
    expect(
      batches([
        { id: "a", record: "one", patch: { title: "first" }, at: 1 },
        { id: "b", record: "one", patch: { title: "final" }, at: 2 },
        { id: "c", record: "one", patch: { done: true }, at: 3 },
      ]),
    ).toEqual([
      {
        record: "one",
        patch: { title: "final", done: true },
        ids: ["a", "b", "c"],
      },
    ]);
  });
  it("keeps pending text visible and hides tombstones", () => {
    expect(
      project(
        [],
        [{ id: "a", record: "one", patch: { title: "unsaved" }, at: 1 }],
      )[0].title,
    ).toBe("unsaved");
    expect(
      project(
        [],
        [{ id: "a", record: "one", patch: { deleted: true }, at: 1 }],
      ),
    ).toEqual([]);
  });
});
