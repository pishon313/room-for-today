import type { Item } from "./store";

export function effectiveRoutineDays(
  routine: Item,
  date: string,
  items: Item[],
): number[] {
  let latest: Item | undefined;
  for (const item of items) {
    if (
      item.kind === "schedule" &&
      item.title === routine.id &&
      item.period <= date &&
      (!latest || item.period > latest.period)
    ) {
      latest = item;
    }
  }
  return latest?.days ?? routine.days;
}

export function routineWeekProgress(
  routines: Item[],
  days: string[],
  items: Item[],
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const routine of routines) {
    for (const [weekday, date] of days.entries()) {
      if (!effectiveRoutineDays(routine, date, items).includes(weekday))
        continue;
      total++;
      if (
        items.some(
          (item) =>
            item.kind === "completion" &&
            item.id === `${routine.id}_${date}` &&
            item.done,
        )
      )
        done++;
    }
  }
  return { done, total };
}
