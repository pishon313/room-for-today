import { test, expect, type Page } from "@playwright/test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { shift, today } from "../../src/dates";
async function expectNoBlockingSaveOverlay(page: Page) {
  await expect(page.locator(".save-notice")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);
  await expect(page.locator(".save-state-trigger")).toBeVisible();
}

async function cloudRecordId(uid: string, kind: string, title: string) {
  const environment = await initializeTestEnvironment({
    projectId: "demo-planner",
    firestore: { host: "127.0.0.1", port: 8080 },
  });
  try {
    const db = environment.authenticatedContext(uid).firestore();
    const snap = await getDocs(collection(db, "users", uid, "items"));
    const record = snap.docs.find((item) => {
      const data = item.data();
      return data.kind === kind && data.title === title && !data.deleted;
    });
    expect(record, `Saved ${kind} ${title} should exist`).toBeDefined();
    return record!.id;
  } finally {
    await environment.cleanup();
  }
}

async function injectRejectedMemoEdit(page: Page, record: string, body: string) {
  await page.evaluate(async ({ record, body }) => {
    const { auth } = await import("/src/firebase.ts" as string);
    const id = crypto.randomUUID();
    localStorage.setItem(
      `planner-pending:${auth!.currentUser!.uid}:${id}`,
      JSON.stringify({
        id,
        record,
        patch: { body, time: "99:99" },
        at: Date.now() + 1,
      }),
    );
    window.dispatchEvent(new Event("planner-queue"));
  }, { record, body });
  await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");
  await expectNoBlockingSaveOverlay(page);
}
async function login(page: Page, uid: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (uid) => {
    const { auth } = await import("/src/firebase.ts" as string);
    const { GoogleAuthProvider, signInWithCredential } = await import(
      "/node_modules/.vite/deps/firebase_auth.js" as string
    );
    await signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({
          sub: uid,
          email: uid + "@example.com",
          name: "Planner Test",
        }),
      ),
    );
  }, uid);
  await expect(page.locator("header [role=status]")).toHaveText("Saved");
}
test("Memo has its own responsive view and dashboard stays schedule-focused", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monthly")).toBeVisible();
  await expect(page.locator(".weekly")).toBeVisible();
  await expect(page.locator(".daily")).toBeVisible();
  await expect(page.locator(".memos")).toBeHidden();

  await page.getByRole("button", { name: "Memo", exact: true }).click();
  await expect(page).toHaveURL(/#memo$/);
  await expect(page.locator(".memos")).toBeVisible();
  await expect(page.locator(".monthly")).toBeHidden();
  await expect(page.locator(".weekly")).toBeHidden();
  await expect(page.locator(".daily")).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".memos")).toBeVisible();
  await page.screenshot({ path: "tests/memo-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: "tests/memo-iphone.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
});
test("Bucket List has its own responsive view and keeps the dashboard focused", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monthly")).toBeVisible();
  await page.getByRole("button", { name: "Bucket List", exact: true }).click();
  await expect(page).toHaveURL(/#bucket$/);
  await expect(
    page.getByRole("heading", { name: "Bucket List", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".monthly")).toBeHidden();
  await expect(page.locator(".weekly")).toBeHidden();
  await expect(page.locator(".daily")).toBeHidden();
  await expect(page.locator(".memos")).toBeHidden();
  await page.screenshot({ path: "tests/bucket-desktop.png", fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/#bucket$/);
  await expect(
    page.getByRole("heading", { name: "Bucket List", exact: true }),
  ).toBeVisible();
  for (const [width, height] of [
    [390, 844],
    [320, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    if (width === 390) {
      await page.screenshot({ path: "tests/bucket-iphone.png", fullPage: true });
    }
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".settings-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Bucket List", exact: true }).click();
  await expect(page.locator(".bucket-workspace")).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".monthly")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bucket List", exact: true }),
  ).toBeHidden();
});
test("the header switches appearance without moving content or losing the color group", async ({
  browser,
}) => {
  const lightContext = await browser.newContext({ colorScheme: "light" });
  const page = await lightContext.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("Your plans, wherever you are.")).toBeVisible();
  const lightBackground = await root.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const plannerTop = await page
    .locator(".planner")
    .evaluate((element) => element.getBoundingClientRect().top + scrollY);

  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("planner-theme-v2")!))).toEqual({
    group: "forest",
    appearance: "dark",
  });
  expect(
    await root.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe(lightBackground);
  expect(
    await page
      .locator(".planner")
      .evaluate((element) => element.getBoundingClientRect().top + scrollY),
  ).toBe(plannerTop);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Forest", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await lightContext.close();

  const darkContext = await browser.newContext({ colorScheme: "dark" });
  const freshPage = await darkContext.newPage();
  await freshPage.goto("/", { waitUntil: "domcontentloaded" });
  await expect(freshPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    freshPage.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
  await darkContext.close();
});
test("Settings pairs color groups with Light, Dark, and the system appearance", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Forest", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator(".appearance-options").getByRole("button", { name: "Follow system" }),
  ).toHaveAttribute("aria-pressed", "true");

  const background = () =>
    root.evaluate((element) => getComputedStyle(element).backgroundColor);
  const paletteBackgrounds = new Set([await background()]);
  const groups = [
    ["Forest", "forest", "light", "dark"],
    ["Gray", "gray", "gray", "deep-black"],
    ["Sierra Blue", "sierra-blue", "sierra-blue", "sierra-night"],
  ] as const;
  for (const [name, group, light, dark] of groups) {
    const option = page.getByRole("button", { name, exact: true });
    await option.click();
    await page.locator(".appearance-options").getByRole("button", { name: "Light" }).click();
    await expect(root).toHaveAttribute("data-theme", light);
    await expect(option).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("planner-theme-v2")!))).toEqual({
      group,
      appearance: "light",
    });
    const lightColor = await background();
    if (group !== "forest") {
      expect(paletteBackgrounds.has(lightColor)).toBe(false);
      paletteBackgrounds.add(lightColor);
      await page.screenshot({
        path: `tests/theme-${light}-desktop.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(root).toHaveAttribute("data-theme", dark);
    await expect(option).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("planner-theme-v2")!))).toEqual({
      group,
      appearance: "dark",
    });
    expect(await background()).not.toBe(lightColor);
    if (group !== "forest") {
      await page.screenshot({
        path: `tests/theme-${dark}-desktop.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(root).toHaveAttribute("data-theme", light);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sierra Blue", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({
    path: "tests/theme-sierra-blue-iphone.png",
    fullPage: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);

  await page.locator(".appearance-options").getByRole("button", { name: "Follow system" }).click();
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "sierra-night");
  await expect(
    page.locator(".appearance-options").getByRole("button", { name: "Follow system" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".appearance-options").getByRole("button", { name: "Light" }).click();
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.locator(".appearance-options").getByRole("button", { name: "Dark" }).click();
  await expect(root).toHaveAttribute("data-theme", "sierra-night");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "sierra-night");
  await context.close();
});

test("legacy theme choices migrate to the matching color group and appearance", async ({
  browser,
}) => {
  const legacyChoices = [
    ["system", "forest", "system", "light"],
    ["light", "forest", "light", "light"],
    ["dark", "forest", "dark", "dark"],
    ["gray", "gray", "light", "gray"],
    ["deep-black", "gray", "dark", "deep-black"],
    ["sierra-blue", "sierra-blue", "light", "sierra-blue"],
  ] as const;
  for (const [legacy, group, appearance, theme] of legacyChoices) {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate((value) => {
      localStorage.removeItem("planner-theme-v2");
      localStorage.setItem("planner-theme", value);
    }, legacy);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect.poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("planner-theme-v2")!)),
    ).toEqual({ group, appearance });
    expect(await page.evaluate(() => localStorage.getItem("planner-theme"))).toBeNull();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const groupName = group === "forest" ? "Forest" : group === "gray" ? "Gray" : "Sierra Blue";
    const appearanceName = appearance === "system" ? "Follow system" : appearance === "light" ? "Light" : "Dark";
    await expect(page.getByRole("button", { name: groupName, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".appearance-options").getByRole("button", { name: appearanceName })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  }
});
test("cloud persistence, live sync, independent edits, routines, bucket list, offline recovery and responsive layout", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const p = await a.newPage(),
    q = await b.newPage();
  const uid = "planner-" + Date.now();
  await login(p, uid);
  await login(q, uid);
  await p.getByRole("button", { name: "Add task", exact: true }).click();
  await p.getByPlaceholder("What would you like to do?").fill("A lasting plan");
  await p.getByPlaceholder("Add a little detail…").fill("Saved in Firestore");
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("What would you like to do?")).toHaveValue(
    "A lasting plan",
  );
  await p.reload();
  await expect(p.getByPlaceholder("What would you like to do?")).toHaveValue(
    "A lasting plan",
  );
  await p.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(p, uid);
  await expect(p.getByPlaceholder("What would you like to do?")).toHaveValue(
    "A lasting plan",
  );
  await q
    .getByPlaceholder("Add a little detail…")
    .fill("Edited on second device");
  await p
    .getByPlaceholder("What would you like to do?")
    .fill("Title from first device");
  await p.getByRole("heading", { name: "Monthly plan" }).click();
  await q.getByRole("heading", { name: "Monthly plan" }).click();
  await expect(p.getByPlaceholder("Add a little detail…")).toHaveValue(
    "Edited on second device",
  );
  await expect(q.getByPlaceholder("What would you like to do?")).toHaveValue(
    "Title from first device",
  );
  await p
    .getByRole("button", { name: "Add monthly goal", exact: true })
    .click();
  await p.getByPlaceholder("Name your goal").fill("Read a book");
  await p.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(p.getByPlaceholder("Name your goal")).toHaveCount(0);
  await p.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(p.getByPlaceholder("Name your goal")).toHaveValue("Read a book");
  await p.getByRole("button", { name: "Routine", exact: true }).click();
  await expect(p.locator(".routine-workspace")).toBeVisible();
  await expect(p.locator(".monthly")).not.toBeVisible();
  // Seed an established routine so this flow still exercises historical check-ins.
  const actualUid = await p.evaluate(async () => {
    const { auth } = await import("/src/firebase.ts" as string);
    return auth!.currentUser!.uid;
  });
  const testEnvironment = await initializeTestEnvironment({
    projectId: "demo-planner",
    firestore: { host: "127.0.0.1", port: 8080 },
  });
  try {
    const ownerDb = testEnvironment.authenticatedContext(actualUid).firestore();
    await setDoc(doc(ownerDb, "users", actualUid, "items", crypto.randomUUID()), {
      kind: "routine", period: "", title: "Stretch", body: "", time: "",
      done: false, days: [0, 1, 2, 3, 4], deleted: false,
      startDate: shift(today(), -14), updatedAt: serverTimestamp(),
    });
  } finally {
    await testEnvironment.cleanup();
  }
  await expect(p.getByPlaceholder("Name your habit")).toHaveValue("Stretch");
  await p.getByRole("heading", { name: "Routine", exact: true }).click();
  await p
    .getByRole("button", { name: "Previous routine week", exact: true })
    .click();
  const check = p.locator(".habit-check:not([disabled])").first();
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "true");
  await expect(p.locator(".routine-settings")).toBeHidden();
  await p.getByRole("button", { name: "Edit routine", exact: true }).click();
  await expect(p.locator(".routine-settings")).toBeVisible();
  await p.getByRole("button", { name: "Repeat Mon for Stretch" }).click();
  await p.getByRole("button", { name: "Done editing" }).click();
  await expect(p.locator('.habit-check[aria-pressed="true"]')).toHaveCount(1);
  await p
    .getByRole("button", { name: "Next routine week", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Next routine week", exact: true })
    .click();
  await expect(p.locator(".routine-row .habit-check").first()).toBeDisabled();
  await expect(p.locator('.habit-check[aria-pressed="true"]')).toHaveCount(0);
  await p
    .getByRole("button", { name: "Previous routine week", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Previous routine week", exact: true })
    .click();
  await expect(p.locator('.habit-check[aria-pressed="true"]')).toHaveCount(1);
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await p.reload({ waitUntil: "domcontentloaded" });
  await expect(p.locator(".routine-workspace")).toBeVisible();
  await p
    .getByRole("button", { name: "Previous routine week", exact: true })
    .click();
  await expect(p.locator('.habit-check[aria-pressed="true"]')).toHaveCount(1);
  await p.screenshot({ path: "tests/routine-desktop.png", fullPage: true });
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(p.locator(".routine-summary")).toContainText("1 of 5");
  await expect(p.locator(".routine-workspace")).not.toBeVisible();
  await expect(p.locator(".monthly")).toBeVisible();
  await p.getByRole("button", { name: "Routine", exact: true }).click();
  await p.getByRole("button", { name: "This week", exact: true }).click();
  const todayWeekday = await p.evaluate(() => {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  });
  const todayCheck = p.locator(".routine-row .habit-check").nth(todayWeekday);
  if (await todayCheck.isDisabled()) {
    await p.getByRole("button", { name: "Edit routine", exact: true }).click();
    await p
      .locator('.routine-settings button[aria-label^="Repeat"]')
      .nth(todayWeekday)
      .click();
    await p.getByRole("button", { name: "Done editing" }).click();
  }
  await expect(todayCheck).toBeEnabled();
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(p.locator(".routine-today-summary")).toContainText("1 left");
  await p.getByRole("button", { name: "Routine", exact: true }).click();
  await todayCheck.click();
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(p.locator(".routine-today-summary")).toContainText("0 left");
  await expect(q.locator(".routine-today-summary")).toContainText("0 left");

  await p.getByRole("button", { name: "Bucket List", exact: true }).click();
  await q.getByRole("button", { name: "Bucket List", exact: true }).click();
  await p.getByRole("button", { name: "Add a wish", exact: true }).click();
  await expect(p.getByPlaceholder("What would you love to do?")).toBeFocused();
  await expect(p.getByRole("button", { name: "Mark wish as done" })).toBeDisabled();
  await p.getByPlaceholder("What would you love to do?").fill("See the northern lights");
  await p.getByPlaceholder("Add a note (optional)").fill("Travel to Tromsø");
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("What would you love to do?")).toHaveValue(
    "See the northern lights",
  );
  await expect(q.getByPlaceholder("Add a note (optional)")).toHaveValue(
    "Travel to Tromsø",
  );
  const c = await browser.newContext();
  const other = await c.newPage();
  await login(other, "other-" + Date.now());
  await other.getByRole("button", { name: "Bucket List", exact: true }).click();
  await expect(other.getByPlaceholder("What would you love to do?")).toHaveCount(0);
  await p.getByRole("heading", { name: "Bucket List", exact: true }).click();
  await q.getByPlaceholder("Add a note (optional)").fill("Travel with friends");
  await q.getByRole("heading", { name: "Bucket List", exact: true }).click();
  await expect(p.getByPlaceholder("Add a note (optional)")).toHaveValue(
    "Travel with friends",
  );
  const completedDate = await p.evaluate(async () => {
    const { today } = await import("/src/dates.ts" as string);
    return today();
  });
  await p.getByRole("button", { name: "Mark See the northern lights as done" }).click();
  await expect(
    q.getByRole("button", { name: "Move See the northern lights back to want to do" }),
  ).toBeVisible();
  await expect(q.locator(`time[datetime="${completedDate}"]`)).toBeVisible();
  await p.reload({ waitUntil: "domcontentloaded" });
  await expect(p).toHaveURL(/#bucket$/);
  await expect(
    p.getByRole("button", { name: "Move See the northern lights back to want to do" }),
  ).toBeVisible();
  await q.getByRole("button", { name: "Move See the northern lights back to want to do" }).click();
  await expect(p.getByRole("button", { name: "Mark See the northern lights as done" })).toBeVisible();
  await p.getByRole("button", { name: "Mark See the northern lights as done" }).click();
  await expect(q.locator(`time[datetime="${completedDate}"]`)).toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await p.screenshot({ path: "tests/bucket-populated-iphone.png", fullPage: true });
  await p.setViewportSize({ width: 320, height: 700 });
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 320);
  await p.setViewportSize({ width: 1440, height: 1000 });
  p.on("dialog", (d) => d.accept());
  await p.getByRole("button", { name: "Delete See the northern lights" }).click();
  await expect(q.getByPlaceholder("What would you love to do?")).toHaveCount(0);

  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await q.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(p.locator(".memos")).not.toBeVisible();
  await p.getByRole("button", { name: "Memo", exact: true }).click();
  await expect(p).toHaveURL(/#memo$/);
  await expect(p.locator(".memos")).toBeVisible();
  await expect(p.locator(".monthly")).not.toBeVisible();
  await q.getByRole("button", { name: "Memo", exact: true }).click();
  await p.getByRole("button", { name: "New note", exact: true }).click();
  const noteRecord = await p.evaluate(
    () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("planner-pending:"))
        .map((k) => JSON.parse(localStorage.getItem(k)!))
        .find((o) => o.patch.kind === "memo").record,
  );
  await p.getByPlaceholder("Note title").fill("A small reminder");
  await p
    .getByPlaceholder("Let your thoughts land here…")
    .fill("Leave space between plans.");
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("Note title")).toHaveValue(
    "A small reminder",
  );
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Leave space between plans.",
  );
  const desktopPlannerTop = await p
    .locator(".planner")
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await a.setOffline(true);
  await p
    .getByPlaceholder("Let your thoughts land here…")
    .fill("Keep this unsaved thought");
  await expect(p.locator("header [role=status]")).toContainText("Offline");
  await expectNoBlockingSaveOverlay(p);
  expect(
    await p
      .locator(".planner")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
  ).toBe(desktopPlannerTop);
  await expect(p.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Keep this unsaved thought",
  );
  await a.setOffline(false);
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Keep this unsaved thought",
  );

  await p.getByRole("heading", { name: "Memo", exact: true }).click();
  await p.evaluate(async (noteRecord) => {
    const { auth } = await import("/src/firebase.ts" as string);
    const id = crypto.randomUUID();
    localStorage.setItem(
      "planner-pending:" + auth.currentUser.uid + ":" + id,
      JSON.stringify({
        id,
        record: noteRecord,
        patch: { body: "Rejected edit is preserved", time: "99:99" },
        at: Date.now(),
      }),
    );
    window.dispatchEvent(new Event("planner-queue"));
  }, noteRecord);
  await expect(p.locator("header [role=status]")).toHaveText("Couldn’t save");
  await expectNoBlockingSaveOverlay(p);
  expect(
    await p
      .locator(".planner")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
  ).toBe(desktopPlannerTop);
  await expect(p.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Rejected edit is preserved",
  );
  await p.reload();
  await expect(p).toHaveURL(/#memo$/);
  await expect(p.locator(".memos")).toBeVisible();
  await expect(p.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Rejected edit is preserved",
  );
  await p.locator(".save-state-trigger").click();
  const pendingMemo = p.getByRole("dialog", { name: "Unsaved changes" }).locator(".save-recovery-item");
  await expect(pendingMemo).toContainText("A small reminder");
  await expect(pendingMemo.locator("textarea[readonly]")).toHaveValue(/Rejected edit is preserved/);
  await pendingMemo.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(p.locator("header [role=status]")).toHaveText("Couldn’t save");
  await pendingMemo.getByRole("button", { name: "Discard pending changes" }).click();
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Keep this unsaved thought",
  );
  await p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await p.screenshot({ path: "tests/desktop.png", fullPage: true });
  for (const [name, appearance, value, file] of [
    ["Sierra Blue", "Light", "sierra-blue", "tests/theme-sierra-blue-dashboard.png"],
    ["Gray", "Dark", "deep-black", "tests/theme-deep-black-dashboard.png"],
    ["Gray", "Light", "gray", "tests/theme-gray-dashboard.png"],
  ]) {
    await p.getByRole("button", { name: "Settings", exact: true }).click();
    await p.getByRole("button", { name, exact: true }).click();
    await p.locator(".appearance-options").getByRole("button", { name: appearance }).click();
    await expect(p.locator("html")).toHaveAttribute("data-theme", value);
    await p.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(p.locator(".memos")).not.toBeVisible();
    await p.screenshot({ path: file, fullPage: true });
    await p.getByRole("button", { name: "Memo", exact: true }).click();
    await expect(p.getByPlaceholder("Note title")).toHaveValue(
      "A small reminder",
    );
  }
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  await p.getByRole("button", { name: "Forest", exact: true }).click();
  await expect(p.locator("html")).toHaveAttribute("data-theme", "light");
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await p.getByRole("button", { name: "Switch to dark mode" }).click();
  await p.screenshot({ path: "tests/dark-desktop.png", fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await p.screenshot({ path: "tests/dark-iphone.png", fullPage: true });
  await p.getByRole("button", { name: "Routine", exact: true }).click();
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await p.screenshot({ path: "tests/dark-routine-iphone.png", fullPage: true });
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await p.getByRole("button", { name: "Switch to light mode" }).click();
  await p.screenshot({ path: "tests/iphone.png", fullPage: true });
  await p.getByRole("button", { name: "Routine", exact: true }).click();
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await expect(p.getByPlaceholder("Name your habit")).toHaveValue("Stretch");
  await p.screenshot({ path: "tests/routine-iphone.png", fullPage: true });
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await p.getByRole("button", { name: "Memo", exact: true }).click();
  await expect(p.locator("body")).toHaveJSProperty("scrollWidth", 390);
  const mobilePlannerTop = await p
    .locator(".planner")
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await a.setOffline(true);
  await p.getByPlaceholder("Note title").fill("A reminder on iPhone");
  await expectNoBlockingSaveOverlay(p);
  expect(
    await p
      .locator(".planner")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
  ).toBe(mobilePlannerTop);
  await a.setOffline(false);
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await q.getByRole("button", { name: "Dashboard", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Complete Title from first device",
      exact: true,
    })
    .click();
  await expect(
    q.getByRole("button", {
      name: "Complete Title from first device",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await p
    .getByRole("button", { name: "Complete Read a book", exact: true })
    .click();
  await expect(
    p.getByRole("button", { name: "Complete Read a book", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await p
    .getByRole("button", { name: "Add weekly priority", exact: true })
    .click();
  await p
    .locator(".weekly")
    .getByPlaceholder("Name your goal")
    .fill("Weekly focus");
  await p.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(
    p.locator(".weekly").getByPlaceholder("Name your goal"),
  ).toHaveCount(0);
  await p.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(
    p.locator(".weekly").getByPlaceholder("Name your goal"),
  ).toHaveValue("Weekly focus");
  await p.getByRole("button", { name: "Memo", exact: true }).click();
  await q.getByRole("button", { name: "Memo", exact: true }).click();
  await p
    .getByRole("button", { name: "Delete A reminder on iPhone", exact: true })
    .click();
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveCount(
    0,
  );
  await p.getByRole("button", { name: "Dashboard", exact: true }).click();
  await q.getByRole("button", { name: "Dashboard", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Delete Title from first device",
      exact: true,
    })
    .click();
  await expect(q.getByPlaceholder("What would you like to do?")).toHaveCount(0);
  await other.getByRole("button", { name: "Memo", exact: true }).click();
  await expect(
    other.getByPlaceholder("Let your thoughts land here…"),
  ).toHaveCount(0);
  await c.close();
  await a.close();
  await b.close();
});


test("new routines have no check-ins before their start date", async ({ page }) => {
  await login(page, "routine-start-" + Date.now());
  await page.getByRole("button", { name: "Routine", exact: true }).click();
  await page.getByRole("button", { name: "Add routine", exact: true }).click();
  await expect(page.locator("header [role=status]")).toHaveText("Saved");
  await page.getByRole("button", { name: "Previous routine week", exact: true }).click();
  await expect(page.locator(".routine-row .habit-check:disabled")).toHaveCount(7);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".routine-summary-count")).toContainText("0 of 0");
});

test("a rejected memo stays recoverable while valid records sync and selective discard works", async ({ browser }) => {
  test.setTimeout(120000);
  const first = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const second = await browser.newContext();
  const page = await first.newPage();
  const other = await second.newPage();
  const uid = "rejected-memo-" + crypto.randomUUID();
  const writeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/google.firestore.v1.Firestore/Write/channel")) {
      writeRequests.push(request.url());
    }
  });
  try {
    await login(page, uid);
    await login(other, uid);
    await page.getByRole("button", { name: "Memo", exact: true }).click();
    await other.getByRole("button", { name: "Memo", exact: true }).click();
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByPlaceholder("Note title").fill("A small reminder");
    await page.getByPlaceholder("Let your thoughts land here…").fill("Saved memo body");
    await expect(page.locator("header [role=status]")).toHaveText("Saved");
    await expect(other.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Saved memo body");
    const actualUid = await page.evaluate(async () => {
      const { auth } = await import("/src/firebase.ts" as string);
      return auth!.currentUser!.uid;
    });
    const memoId = await cloudRecordId(actualUid, "memo", "A small reminder");
    const plannerTop = await page.locator(".planner").evaluate((el) => el.getBoundingClientRect().top + scrollY);

    await page.getByRole("heading", { name: "Memo", exact: true }).click();
    await injectRejectedMemoEdit(page, memoId, "Rejected edit is still here");
    await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Rejected edit is still here");
    await expect(other.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Saved memo body");
    expect(await page.locator(".planner").evaluate((el) => el.getBoundingClientRect().top + scrollY)).toBe(plannerTop);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Close", exact: true }).click();

    for (const [width, height] of [[1440, 1000], [390, 844], [320, 700]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await expectNoBlockingSaveOverlay(page);
      await page.getByRole("button", { name: "Dashboard", exact: true }).click();
      await expect(page.locator(".monthly")).toBeVisible();
      await page.getByRole("button", { name: "Memo", exact: true }).click();
      await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Rejected edit is still here");
      await page.getByPlaceholder("Note title").click();
      if (width === 320) {
        await page.locator(".save-state-trigger").click();
        const narrowRecovery = page.getByRole("dialog", { name: "Unsaved changes" });
        await expect(narrowRecovery.locator(".save-recovery-item")).toBeVisible();
        await expect(narrowRecovery.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        await narrowRecovery.getByRole("button", { name: "Close", exact: true }).click();
        await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await other.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page.getByPlaceholder("What would you like to do?").fill("Unrelated daily task");
    await expect(other.getByPlaceholder("What would you like to do?")).toHaveValue("Unrelated daily task");
    await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Memo", exact: true }).click();
    await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Rejected edit is still here");
    await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");
    await page.locator(".save-state-trigger").click();
    let recovery = page.getByRole("dialog", { name: "Unsaved changes" });
    let memoRecovery = recovery.locator(".save-recovery-item").filter({ hasText: "A small reminder" });
    await expect(memoRecovery).toContainText("Rejected by server · Needs attention");
    await expect(memoRecovery.locator("textarea[readonly]")).toHaveValue(/Rejected edit is still here/);
    await memoRecovery.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Rejected edit is still here");
    await memoRecovery.locator("details summary").click();
    await expect(memoRecovery.locator("details")).toHaveAttribute("open", "");
    const beforeRetryRequests = writeRequests.length;
    await memoRecovery.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => writeRequests.length).toBeGreaterThan(beforeRetryRequests);
    await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");
    if (!(await recovery.isVisible())) {
      await page.locator(".save-state-trigger").click();
      recovery = page.getByRole("dialog", { name: "Unsaved changes" });
      memoRecovery = recovery.locator(".save-recovery-item").filter({ hasText: "A small reminder" });
    }
    let cancelledPrompt = "";
    page.once("dialog", async (dialog) => {
      cancelledPrompt = dialog.message();
      await dialog.dismiss();
    });
    await memoRecovery.getByRole("button", { name: "Discard pending changes" }).click();
    expect(cancelledPrompt).toContain("A small reminder");
    await expect(memoRecovery.locator("textarea[readonly]")).toHaveValue(/Rejected edit is still here/);
    await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");
    await recovery.getByRole("button", { name: "Close", exact: true }).click();

    await first.setOffline(true);
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByPlaceholder("Add a little detail…").fill("Queued unrelated detail");
    await expect(page.locator("header [role=status]")).not.toHaveText("Saved");
    await page.getByRole("button", { name: "Memo", exact: true }).click();
    await page.locator(".save-state-trigger").click();
    recovery = page.getByRole("dialog", { name: "Unsaved changes" });
    memoRecovery = recovery.locator(".save-recovery-item").filter({ hasText: "A small reminder" });
    await expect(recovery.locator(".save-recovery-item")).toHaveCount(2);
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("A small reminder");
      await dialog.accept();
    });
    await memoRecovery.getByRole("button", { name: "Discard pending changes" }).click();
    await expect(memoRecovery).toHaveCount(0);
    await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Saved memo body");
    await expect(page.locator("header [role=status]")).not.toHaveText("Saved");
    await expect(other.getByPlaceholder("What would you like to do?")).toHaveValue("Unrelated daily task");
    await first.setOffline(false);
    await expect(page.locator("header [role=status]")).toHaveText("Saved");
    await expect(other.getByPlaceholder("Add a little detail…")).toHaveValue("Queued unrelated detail");
    await other.getByRole("button", { name: "Memo", exact: true }).click();
    await expect(other.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Saved memo body");
    if (await page.getByRole("dialog").isVisible()) {
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});

test("memory-only edits survive storage quota errors, Retry, and another edit", async ({ browser }) => {
  test.setTimeout(90000);
  const first = await browser.newContext();
  const second = await browser.newContext();
  const page = await first.newPage();
  const other = await second.newPage();
  const uid = "quota-recovery-" + crypto.randomUUID();
  try {
    await login(page, uid);
    await login(other, uid);
    await page.getByRole("button", { name: "Memo", exact: true }).click();
    await other.getByRole("button", { name: "Memo", exact: true }).click();
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await page.getByPlaceholder("Note title").fill("Quota memo");
    await page.getByPlaceholder("Let your thoughts land here…").fill("Saved baseline");
    await expect(page.locator("header [role=status]")).toHaveText("Saved");
    await expect(other.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Saved baseline");

    await first.setOffline(true);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as Window & { restorePlannerStorage?: () => void }).restorePlannerStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("planner-pending:")) {
          throw new DOMException("Storage quota exceeded", "QuotaExceededError");
        }
        return original.call(this, key, value);
      };
    });
    await page.getByPlaceholder("Let your thoughts land here…").fill("Memory-only thought");
    await expect(page.locator("header [role=status]")).toHaveText("Couldn’t save");
    await expectNoBlockingSaveOverlay(page);
    await page.locator(".save-state-trigger").click();
    const recovery = page.getByRole("dialog", { name: "Unsaved changes" });
    await expect(recovery.getByRole("alert")).toContainText("Couldn’t save to device storage");
    await expect(recovery.locator(".save-recovery-item")).toContainText("Waiting for server confirmation");
    await recovery.getByRole("button", { name: "Retry", exact: true }).first().click();
    if (await recovery.isVisible()) {
      await recovery.getByRole("button", { name: "Close", exact: true }).click();
    }
    await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Memory-only thought");
    await page.getByPlaceholder("Note title").fill("Quota memo edited later");
    await expect(page.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Memory-only thought");
    await page.evaluate(() => {
      (window as Window & { restorePlannerStorage?: () => void }).restorePlannerStorage?.();
    });
    await first.setOffline(false);
    await expect(page.locator("header [role=status]")).toHaveText("Saved");
    await expect(other.getByPlaceholder("Note title")).toHaveValue("Quota memo edited later");
    await expect(other.getByPlaceholder("Let your thoughts land here…")).toHaveValue("Memory-only thought");
  } finally {
    await first.close();
    await second.close();
  }
});
