import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  Leaf,
  LogOut,
  Trash2,
  Cloud,
  CalendarDays,
  Moon,
  Sun,
} from "lucide-react";
import { auth, configured } from "./firebase";
import {
  calendar,
  label,
  monthShift,
  shift,
  today,
  weekDays,
  weekdays,
  weekStart,
} from "./dates";
import { usePlanner, type Item, type Kind } from "./store";
import { effectiveRoutineDays, routineWeekProgress } from "./routineSchedule";

type Theme =
  | "light"
  | "dark"
  | "gray"
  | "deep-black"
  | "sierra-blue"
  | "sierra-night";
type ThemeGroup = "forest" | "gray" | "sierra-blue";
type Appearance = "system" | "light" | "dark";
type ThemePreference = { group: ThemeGroup; appearance: Appearance };
type View = "dashboard" | "routine" | "bucket" | "memo" | "settings";

const themeGroups: {
  id: ThemeGroup;
  label: string;
  description: string;
}[] = [
  { id: "forest", label: "Forest", description: "Warm Light · Forest Dark" },
  { id: "gray", label: "Gray", description: "Gray · Deep Black" },
  {
    id: "sierra-blue",
    label: "Sierra Blue",
    description: "Sierra Blue · Sierra Night",
  },
];

const themeByGroup: Record<ThemeGroup, Record<"light" | "dark", Theme>> = {
  forest: { light: "light", dark: "dark" },
  gray: { light: "gray", dark: "deep-black" },
  "sierra-blue": { light: "sierra-blue", dark: "sierra-night" },
};

const themeColors: Record<Theme, string> = {
  light: "#f7f6f2",
  dark: "#1d2720",
  "sierra-blue": "#f4f8fb",
  "sierra-night": "#142231",
  "deep-black": "#111519",
  gray: "#f8f8f8",
};

function readThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem("planner-theme-v2");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<ThemePreference> | null;
        if (
          parsed &&
          (parsed.group === "forest" ||
            parsed.group === "gray" ||
            parsed.group === "sierra-blue") &&
          (parsed.appearance === "system" ||
            parsed.appearance === "light" ||
            parsed.appearance === "dark")
        ) {
          return { group: parsed.group, appearance: parsed.appearance };
        }
      } catch {
        // Fall back to the previously saved theme.
      }
    }
    const legacy = localStorage.getItem("planner-theme");
    switch (legacy) {
      case "light":
        return { group: "forest", appearance: "light" };
      case "dark":
        return { group: "forest", appearance: "dark" };
      case "gray":
        return { group: "gray", appearance: "light" };
      case "deep-black":
        return { group: "gray", appearance: "dark" };
      case "sierra-blue":
        return { group: "sierra-blue", appearance: "light" };
    }
  } catch {
    // The system preference still works when browser storage is unavailable.
  }
  return { group: "forest", appearance: "system" };
}

function viewFromHash(): View {
  const hash = window.location.hash.slice(1);
  return hash === "routine" ||
    hash === "bucket" ||
    hash === "memo" ||
    hash === "settings"
    ? hash
    : "dashboard";
}

function Text({
  value,
  onChange,
  placeholder,
  multiline = false,
  className = "",
  label: aria,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
  multiline?: boolean;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  const props = {
    value: draft,
    placeholder,
    "aria-label": aria || placeholder,
    className,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setDraft(e.target.value);
      onChange(e.target.value);
    },
    maxLength: multiline ? 20000 : 300,
  };
  return multiline ? <textarea {...props} /> : <input type="text" {...props} />;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!auth),
    [authError, setAuthError] = useState(""),
    [selected, setSelected] = useState(today()),
    [month, setMonth] = useState(today()),
    [current, setCurrent] = useState(today()),
    [themePreference, setThemePreference] =
      useState<ThemePreference>(readThemePreference),
    [systemDark, setSystemDark] = useState(
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
    [editingRoutineId, setEditingRoutineId] = useState<string | null>(null),
    [view, setView] = useState<View>(viewFromHash);
  const isDark =
    themePreference.appearance === "system"
      ? systemDark
      : themePreference.appearance === "dark";
  const theme = themeByGroup[themePreference.group][isDark ? "dark" : "light"];
  const store = usePlanner(user?.uid);
  const { items, patch, add } = store;
  useEffect(() => {
    try {
      if (
        localStorage.getItem("planner-theme") !== null &&
        localStorage.getItem("planner-theme-v2") === null
      ) {
        localStorage.setItem(
          "planner-theme-v2",
          JSON.stringify(themePreference),
        );
        localStorage.removeItem("planner-theme");
      }
    } catch {
      // The current theme still works when browser storage is unavailable.
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", themeColors[theme]);
  }, [theme]);
  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => setSystemDark(system.matches);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "planner-theme-v2" || event.key === "planner-theme")
        setThemePreference(readThemePreference());
    };
    system.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
          })
        : undefined,
    [],
  );
  useEffect(() => {
    const t = setInterval(() => setCurrent(today()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const enabled = !!user && store.ready;
  const days = weekDays(selected);
  const filtered = (kind: Kind, period?: string) =>
    items.filter(
      (x) => x.kind === kind && (period === undefined || x.period === period),
    );
  const pick = (day: string) => {
    setSelected(day);
    setMonth(day);
  };
  const showView = (next: View) => {
    window.location.hash = next;
    setView(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const create = (kind: Kind, period: string) =>
    add(kind, period, { title: kind === "memo" ? "Untitled note" : "" });
  const updateRoutineDay = (routine: Item, weekday: number) => {
    const previous = effectiveRoutineDays(routine, current, items);
    const next = previous.includes(weekday)
      ? previous.filter((day) => day !== weekday)
      : [...previous, weekday].sort((a, b) => a - b);
    if (
      !items.some(
        (item) => item.kind === "schedule" && item.title === routine.id,
      )
    ) {
      patch(`${routine.id}_schedule_0001-01-01`, {
        kind: "schedule",
        period: "0001-01-01",
        title: routine.id,
        body: "",
        time: "",
        done: false,
        days: previous,
        deleted: false,
      });
    }
    patch(`${routine.id}_schedule_${current}`, {
      kind: "schedule",
      period: current,
      title: routine.id,
      body: "",
      time: "",
      done: false,
      days: next,
      deleted: false,
    });
    patch(routine.id, { days: next });
  };
  const remove = (item: Item) => {
    if (confirm(`Delete ${item.title || "this item"}?`))
      patch(item.id, { deleted: true });
  };
  const login = async () => {
    setAuthError("");
    try {
      await signInWithPopup(auth!, new GoogleAuthProvider());
    } catch (e) {
      setAuthError(
        e instanceof Error ? e.message : "Sign-in failed. Please try again.",
      );
    }
  };
  const logout = async () => {
    if (store.pendingCount) {
      setAuthError("Wait for your pending edits to save before signing out.");
      return;
    }
    try {
      await signOut(auth!);
    } catch {
      setAuthError("Couldn’t sign out. Please try again.");
    }
  };
  const chooseTheme = (choice: ThemePreference) => {
    try {
      localStorage.setItem("planner-theme-v2", JSON.stringify(choice));
      localStorage.removeItem("planner-theme");
    } catch {
      // Switching still works for this page when storage is unavailable.
    }
    setThemePreference(choice);
  };
  const quickTheme = isDark ? "light" : "dark";
  const toggleTheme = () => {
    chooseTheme({ ...themePreference, appearance: quickTheme });
  };
  const task = (item: Item) => (
    <div className={"task " + (item.done ? "done" : "")} key={item.id}>
      <button
        className="check"
        aria-label={`Complete ${item.title || "item"}`}
        aria-pressed={item.done}
        onClick={() => patch(item.id, { done: !item.done })}
      >
        {item.done && <Check size={14} />}
      </button>
      {item.kind === "daily" && (
        <input
          type="time"
          aria-label="Task time (optional)"
          value={item.time}
          onChange={(e) => patch(item.id, { time: e.target.value })}
        />
      )}
      <div className="task-text">
        <Text
          value={item.title}
          onChange={(title) => patch(item.id, { title })}
          placeholder={
            item.kind === "daily"
              ? "What would you like to do?"
              : "Name your goal"
          }
        />
        {item.kind === "daily" && (
          <Text
            value={item.body}
            onChange={(body) => patch(item.id, { body })}
            placeholder="Add a little detail…"
            className="detail"
          />
        )}
      </div>
      <button
        className="icon delete"
        aria-label={`Delete ${item.title || "item"}`}
        onClick={() => remove(item)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
  const bucketItems = filtered("bucket");
  const bucketWishes = bucketItems
    .filter((item) => !item.done)
    .sort(
      (a, b) =>
        (b.createdAt || 0) - (a.createdAt || 0) ||
        a.id.localeCompare(b.id),
    );
  const bucketDone = bucketItems
    .filter((item) => item.done)
    .sort(
      (a, b) =>
        (b.completedAt || "").localeCompare(a.completedAt || "") ||
        (b.createdAt || 0) - (a.createdAt || 0) ||
        a.id.localeCompare(b.id),
    );
  const addBucket = () => {
    const id = create("bucket", "");
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(`[data-bucket-id="${id}"] input`)
        ?.focus();
    });
  };
  const bucketCard = (item: Item) => (
    <article className="bucket-card" data-bucket-id={item.id} key={item.id}>
      <div className="bucket-card-top">
        <button
          className="bucket-complete"
          type="button"
          aria-label={
            item.done
              ? `Move ${item.title || "wish"} back to want to do`
              : `Mark ${item.title || "wish"} as done`
          }
          aria-pressed={item.done}
          disabled={!item.done && !item.title.trim()}
          onClick={() =>
            patch(item.id, {
              done: !item.done,
              completedAt: item.done ? "" : today(),
            })
          }
        >
          {item.done && <Check size={17} />}
        </button>
        <div className="bucket-card-content">
          <Text
            value={item.title}
            onChange={(title) => patch(item.id, { title })}
            placeholder="What would you love to do?"
          />
          <Text
            value={item.body}
            onChange={(body) => patch(item.id, { body })}
            placeholder="Add a note (optional)"
            className="bucket-note"
          />
        </div>
      </div>
      <div className="bucket-card-actions">
        {item.done && item.completedAt && (
          <time dateTime={item.completedAt} className="bucket-done-date">
            Completed {label(item.completedAt, { month: "short", day: "numeric", year: "numeric" })}
          </time>
        )}
        <button
          className="icon"
          type="button"
          aria-label={`Delete ${item.title || "wish"}`}
          onClick={() => remove(item)}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
  const daily = filtered("daily", selected),
    done = daily.filter((x) => x.done).length;
  const routines = filtered("routine");
  const weeklyRoutineProgress = routineWeekProgress(routines, days, items);
  const todayWeekday = weekDays(current).indexOf(current);
  const dueToday = routines.filter((routine) =>
    effectiveRoutineDays(routine, current, items).includes(todayWeekday),
  );
  const doneToday = dueToday.filter((routine) =>
    items.some(
      (item) =>
        item.kind === "completion" &&
        item.id === `${routine.id}_${current}` &&
        item.done,
    ),
  ).length;
  return (
    <>
      <header>
        <a className="brand" href="/">
          <Leaf size={25} />
          <span>Planner</span>
        </a>
        <nav className="view-tabs" aria-label="Planner views">
          <button
            aria-current={view === "dashboard" ? "page" : undefined}
            onClick={() => showView("dashboard")}
          >
            Dashboard
          </button>
          <button
            aria-current={view === "routine" ? "page" : undefined}
            onClick={() => showView("routine")}
          >
            Routine
          </button>
          <button
            aria-current={view === "bucket" ? "page" : undefined}
            onClick={() => showView("bucket")}
          >
            Bucket List
          </button>
          <button
            aria-current={view === "memo" ? "page" : undefined}
            onClick={() => showView("memo")}
          >
            Memo
          </button>
          <button
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => showView("settings")}
          >
            Settings
          </button>
        </nav>
        <div className="account">
          <button
            className="theme-toggle"
            aria-label={`Switch to ${quickTheme} mode`}
            title={`Switch to ${quickTheme} mode`}
            onClick={toggleTheme}
          >
            {quickTheme === "light" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <span
            className={"save-state " + (store.error ? "error" : "")}
            role="status"
          >
            <Cloud size={16} />
            {store.status}
          </span>
          {user ? (
            <>
              <span className="user-name">
                {user.displayName || user.email}
              </span>
              <button className="icon" onClick={logout} aria-label="Sign out">
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button
              className="signin"
              disabled={!configured || !authReady}
              onClick={login}
            >
              Sign in with Google
            </button>
          )}
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">A LITTLE SPACE FOR YOUR EVERYDAY</div>
            <h1>
              {view === "routine"
                ? "Find your rhythm."
                : view === "bucket"
                  ? "Make room for someday."
                : view === "memo"
                  ? "Make room for your thoughts."
                : view === "settings"
                  ? "Make this space yours."
                  : "Make room for what matters."}
            </h1>
            <p>
              {view === "settings" ? (
                "Choose the colors that feel right for you."
              ) : view === "bucket" ? (
                "A place for the experiences you want to remember."
              ) : view === "memo" ? (
                "Ideas, reminders, and thoughts in one quiet place."
              ) : (
                <>
                  {label(current, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  <span className="timezone">Seoul · GMT+9</span>
                </>
              )}
            </p>
          </div>
          {(view === "dashboard" || view === "routine") && (
            <button
              className="primary"
              disabled={!enabled}
              aria-label={view === "routine" ? "Add routine" : "Add task"}
              onClick={() =>
                view === "routine"
                  ? create("routine", "")
                  : create("daily", selected)
              }
            >
              <Plus size={19} />
              {view === "routine" ? "Add routine" : "Add task"}
            </button>
          )}
        </div>
        {!configured ? (
          <div className="notice">
            <Leaf size={20} />
            <div>
              <strong>Your planner is ready for Firebase setup.</strong>
              <span>
                Cloud saving is not connected yet. Follow SETUP.md to enable
                Google sign-in and sync across your devices.
              </span>
            </div>
          </div>
        ) : !user ? (
          <div className="notice">
            <Cloud size={20} />
            <div>
              <strong>
                {authReady
                  ? "Your plans, wherever you are."
                  : "Checking your sign-in…"}
              </strong>
              <span>
                Sign in with Google to open your private planner on every
                device.
              </span>
            </div>
          </div>
        ) : !store.ready ? (
          <div className="notice">Loading your saved planner…</div>
        ) : null}
        {(store.error || authError || store.pendingCount > 0) && (
          <div
            className="notice save-notice"
            role={store.error || authError ? "alert" : "status"}
          >
            <div>
              {authError ||
                store.error ||
                `${store.pendingCount} pending changes · Keep this device until saving finishes.`}
            </div>
            {store.error && <button onClick={store.retry}>Retry</button>}
            {authError && (
              <button onClick={() => setAuthError("")}>Dismiss</button>
            )}
          </div>
        )}
        <fieldset
          disabled={!enabled && view !== "settings"}
          className={`planner ${view}-mode`}
        >
          <div className="column left">
            <section className="panel monthly">
              <div className="section-head">
                <h2>Monthly plan</h2>
                <div className="arrows">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setMonth(monthShift(month, -1))}
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setMonth(monthShift(month, 1))}
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
              <h3>{label(month, { month: "long", year: "numeric" })}</h3>
              <div className="calendar">
                {weekdays.map((d) => (
                  <span className="weekday" key={d}>
                    {d}
                  </span>
                ))}
                {calendar(month).map((d) => (
                  <button
                    key={d}
                    className={
                      (d === selected ? "selected " : "") +
                      (d.slice(0, 7) !== month.slice(0, 7) ? "muted " : "") +
                      (d === current ? "today" : "")
                    }
                    aria-label={label(d, { dateStyle: "full" })}
                    aria-pressed={d === selected}
                    onClick={() => pick(d)}
                  >
                    {Number(d.slice(-2))}
                    {items.some(
                      (x) => x.kind === "daily" && x.period === d,
                    ) && <i />}
                  </button>
                ))}
              </div>
              <div className="subhead">
                <h3>Monthly goals</h3>
                <button
                  className="icon"
                  aria-label="Add monthly goal"
                  onClick={() => create("monthly", month.slice(0, 7))}
                >
                  <Plus size={17} />
                </button>
              </div>
              <div className="scroll goals">
                {filtered("monthly", month.slice(0, 7)).map(task)}
                {!filtered("monthly", month.slice(0, 7)).length && (
                  <p className="empty">What matters most this month?</p>
                )}
              </div>
            </section>
            <section className="panel routine-summary">
              <div className="section-head">
                <h2>Routine</h2>
                <button
                  className="summary-link"
                  onClick={() => showView("routine")}
                >
                  View routines <ArrowRight size={16} />
                </button>
              </div>
              <p className="caption">
                {label(days[0], { month: "short", day: "numeric" })} –{" "}
                {label(days[6], { month: "short", day: "numeric" })}
              </p>
              {routines.length ? (
                <>
                  <div className="routine-today-summary">
                    <span>Today</span>
                    <strong>
                      {dueToday.length
                        ? `${dueToday.length - doneToday} left`
                        : "Nothing planned"}
                    </strong>
                    <small>
                      {dueToday.length
                        ? `${doneToday} of ${dueToday.length} done`
                        : "Take a little pause."}
                    </small>
                  </div>
                  <div className="routine-summary-count">
                    <strong>
                      {weeklyRoutineProgress.done} of{" "}
                      {weeklyRoutineProgress.total}
                    </strong>
                    <span>check-ins done this week</span>
                  </div>
                  <progress
                    value={weeklyRoutineProgress.done}
                    max={weeklyRoutineProgress.total || 1}
                  />
                  <div className="routine-summary-list">
                    {routines.slice(0, 3).map((routine) => {
                      const progress = routineWeekProgress(
                        [routine],
                        days,
                        items,
                      );
                      return (
                        <div key={routine.id}>
                          <span>{routine.title || "Untitled routine"}</span>
                          <span>
                            {progress.done} / {progress.total}
                          </span>
                        </div>
                      );
                    })}
                    {routines.length > 3 && <p>+{routines.length - 3} more</p>}
                  </div>
                </>
              ) : (
                <p className="empty">
                  No routines yet. Start with one small habit.
                </p>
              )}
            </section>
            <section className="panel routines routine-workspace">
              <div className="section-head">
                <h2>Routine</h2>
                <span className="routine-week-label">
                  {label(days[0], { month: "short", day: "numeric" })} –{" "}
                  {label(days[6], { month: "short", day: "numeric" })}
                </span>
              </div>
              <div className="routine-toolbar">
                <p className="caption">Small steps, a little every day.</p>
                <div className="arrows">
                  <button
                    aria-label="Previous routine week"
                    onClick={() => pick(shift(selected, -7))}
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    className="routine-today"
                    onClick={() => pick(current)}
                  >
                    This week
                  </button>
                  <button
                    aria-label="Next routine week"
                    onClick={() => pick(shift(selected, 7))}
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
              <div className="routine-scroll">
                <div className="routine-grid table-head">
                  <span>Habit</span>
                  {days.map((d, i) => (
                    <span key={d} title={d}>
                      {weekdays[i][0]}
                      <small>{Number(d.slice(-2))}</small>
                    </span>
                  ))}
                </div>
                {routines.map((r) => (
                  <div key={r.id} className="routine-row">
                    <div className="routine-grid">
                      <Text
                        value={r.title}
                        onChange={(title) => patch(r.id, { title })}
                        placeholder="Name your habit"
                      />
                      {days.map((d, i) => {
                        const c = items.find((x) => x.id === r.id + "_" + d);
                        return (
                          <button
                            key={d}
                            className={
                              "habit-check " + (c?.done ? "checked" : "")
                            }
                            disabled={
                              !effectiveRoutineDays(r, d, items).includes(i)
                            }
                            aria-label={`${r.title || "Habit"} ${d}`}
                            aria-pressed={!!c?.done}
                            onClick={() =>
                              patch(r.id + "_" + d, {
                                kind: "completion",
                                period: d,
                                title: r.id,
                                body: "",
                                time: "",
                                days: [],
                                deleted: false,
                                done: !c?.done,
                              })
                            }
                          >
                            {c?.done ? (
                              <Check size={13} />
                            ) : !effectiveRoutineDays(r, d, items).includes(
                                i,
                              ) ? (
                              "–"
                            ) : (
                              ""
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="routine-edit-toggle"
                      aria-expanded={editingRoutineId === r.id}
                      aria-controls={`routine-settings-${r.id}`}
                      onClick={() =>
                        setEditingRoutineId(
                          editingRoutineId === r.id ? null : r.id,
                        )
                      }
                    >
                      {editingRoutineId === r.id
                        ? "Done editing"
                        : "Edit routine"}
                    </button>
                    <div
                      id={`routine-settings-${r.id}`}
                      className="routine-settings"
                      data-open={editingRoutineId === r.id}
                    >
                      <span>Repeat from today</span>
                      {weekdays.map((d, i) => (
                        <button
                          key={i}
                          aria-label={`Repeat ${d} for ${r.title || "habit"}`}
                          aria-pressed={effectiveRoutineDays(
                            r,
                            current,
                            items,
                          ).includes(i)}
                          onClick={() => updateRoutineDay(r, i)}
                        >
                          {d[0]}
                        </button>
                      ))}
                      <button
                        className="icon"
                        aria-label={`Delete ${r.title || "routine"}`}
                        onClick={() => remove(r)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {!routines.length && (
                  <p className="empty">
                    Build a rhythm that feels like you.
                    <br />
                    Add your first routine with +.
                  </p>
                )}
              </div>
            </section>
            <section className="panel settings-panel settings-workspace">
              <div className="section-head">
                <h2>Appearance</h2>
              </div>
              <p className="settings-intro">
                Choose a color family, then let your device set the brightness
                or keep it fixed. Your plans and memos stay the same.
              </p>
              <div className="settings-choice-head">
                <h3>Color family</h3>
                <p>Each family has a light and a dark palette.</p>
              </div>
              <div className="theme-grid">
                {themeGroups.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="theme-option"
                    aria-label={option.label}
                    aria-describedby={`theme-description-${option.id}`}
                    aria-pressed={themePreference.group === option.id}
                    data-selected={themePreference.group === option.id}
                    onClick={() =>
                      chooseTheme({ ...themePreference, group: option.id })
                    }
                  >
                    <span
                      className={`theme-preview theme-preview-${option.id}`}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-option-copy">
                      <strong>{option.label}</strong>
                      <small id={`theme-description-${option.id}`}>
                        {option.description}
                      </small>
                    </span>
                    <span className="theme-option-check" aria-hidden="true">
                      {themePreference.group === option.id && (
                        <Check size={16} />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div className="settings-choice-head">
                <h3>Light or dark</h3>
                <p>Follow this device, or keep the selected look fixed.</p>
              </div>
              <div
                className="appearance-options"
                role="group"
                aria-label="Light and dark mode"
              >
                {([
                  ["system", "Follow system"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const).map(([appearance, name]) => (
                  <button
                    key={appearance}
                    type="button"
                    aria-pressed={themePreference.appearance === appearance}
                    onClick={() =>
                      chooseTheme({ ...themePreference, appearance })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="settings-note">
                The header button switches light and dark within this color
                family. Choose Follow system to use this device’s setting again.
              </p>
            </section>
          </div>
          <div className="column center">
            <section className="panel weekly">
              <div className="section-head">
                <h2>Weekly plan</h2>
                <div className="arrows">
                  <button
                    aria-label="Previous week"
                    onClick={() => pick(shift(selected, -7))}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <span>
                    {label(days[0], { month: "short", day: "numeric" })} –{" "}
                    {label(days[6], { month: "short", day: "numeric" })}
                  </span>
                  <button
                    aria-label="Next week"
                    onClick={() => pick(shift(selected, 7))}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
              <div className="week-strip">
                {days.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => pick(d)}
                    className={d === selected ? "active" : ""}
                    aria-label={`Select ${d}`}
                    aria-pressed={d === selected}
                  >
                    <span>{weekdays[i]}</span>
                    <strong>{Number(d.slice(-2))}</strong>
                    <i
                      className={filtered("daily", d).length ? "has-tasks" : ""}
                    />
                  </button>
                ))}
              </div>
              <div className="subhead">
                <h3>Weekly priorities</h3>
                <button
                  className="icon"
                  aria-label="Add weekly priority"
                  onClick={() => create("weekly", weekStart(selected))}
                >
                  <Plus size={17} />
                </button>
              </div>
              <div className="scroll priorities">
                {filtered("weekly", weekStart(selected)).map(task)}
                {!filtered("weekly", weekStart(selected)).length && (
                  <p className="empty">Give this week a little direction.</p>
                )}
              </div>
            </section>
            <section className="panel daily">
              <div className="section-head">
                <div>
                  <h2>
                    {selected === current ? "Today’s plan" : "Daily plan"}
                  </h2>
                  <p className="caption">
                    {label(selected, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="progress">
                  <span>
                    {done} of {daily.length} done
                  </span>
                  <progress value={done} max={daily.length || 1} />
                </div>
              </div>
              <div className="day-nav">
                <button
                  className="icon"
                  aria-label="Previous day"
                  onClick={() => pick(shift(selected, -1))}
                >
                  <ArrowLeft size={16} />
                </button>
                <button className="today-link" onClick={() => pick(current)}>
                  <CalendarDays size={14} />
                  Today
                </button>
                <button
                  className="icon"
                  aria-label="Next day"
                  onClick={() => pick(shift(selected, 1))}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="scroll daily-list">
                {[...daily]
                  .sort(
                    (a, b) =>
                      (a.time || "99").localeCompare(b.time || "99") ||
                      a.id.localeCompare(b.id),
                  )
                  .map(task)}
                {!daily.length && (
                  <div className="day-empty">
                    <span>Room to breathe.</span>
                    <p>Add a task and make the day your own.</p>
                  </div>
                )}
              </div>
              <button
                className="add-row"
                onClick={() => create("daily", selected)}
              >
                <Plus size={16} />
                Add a task
              </button>
            </section>
          </div>
          <section className="panel memos">
            <div className="section-head">
              <h2>Memo</h2>
              <button className="new-note" onClick={() => create("memo", "")}>
                <Plus size={16} />
                New note
              </button>
            </div>
            <div className="scroll note-list">
              {filtered("memo").map((m) => (
                <article className="note" key={m.id}>
                  <div className="note-title">
                    <Text
                      value={m.title}
                      onChange={(title) => patch(m.id, { title })}
                      placeholder="Note title"
                    />
                    <button
                      className="icon"
                      aria-label={`Delete ${m.title || "note"}`}
                      onClick={() => remove(m)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Text
                    multiline
                    value={m.body}
                    onChange={(body) => patch(m.id, { body })}
                    placeholder="Let your thoughts land here…"
                  />
                </article>
              ))}
              {!filtered("memo").length && (
                <div className="note blank-note">
                  <h3>A place for your thoughts.</h3>
                  <p>Ideas, reminders, little things to remember.</p>
                  <div className="lines" />
                </div>
              )}
            </div>
            <p className="memo-footer">
              A quieter mind starts with a little space.
            </p>
          </section>
          <section className="panel bucket-workspace">
            <div className="section-head">
              <div>
                <h2>Bucket List</h2>
                <p className="caption">A home for the things you hope to do.</p>
              </div>
              <button
                className="new-note"
                type="button"
                onClick={addBucket}
              >
                <Plus size={16} />
                Add a wish
              </button>
            </div>
            <div className="bucket-columns">
              <div className="bucket-group">
                <div className="bucket-group-head">
                  <h3>Want to do</h3>
                  <span>{bucketWishes.length}</span>
                </div>
                {bucketWishes.map(bucketCard)}
                {!bucketWishes.length && (
                  <div className="bucket-empty">What would you love to do someday?</div>
                )}
              </div>
              <div className="bucket-group">
                <div className="bucket-group-head">
                  <h3>Done</h3>
                  <span>{bucketDone.length}</span>
                </div>
                {bucketDone.map(bucketCard)}
                {!bucketDone.length && (
                  <div className="bucket-empty">Your memories will gather here.</div>
                )}
              </div>
            </div>
          </section>
        </fieldset>
        <footer>
          Made for your everyday.<span>Asia/Seoul · Weeks begin Monday</span>
        </footer>
      </main>
    </>
  );
}
