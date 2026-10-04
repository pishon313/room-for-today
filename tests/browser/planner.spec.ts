import { test, expect, type Page } from "@playwright/test";
async function expectFloatingTopCenter(page: Page) {
  const notice = await page.locator(".save-notice").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      position: getComputedStyle(el).position,
      top: rect.top,
      centerOffset: Math.abs(rect.left + rect.width / 2 - innerWidth / 2),
    };
  });
  expect(notice.position).toBe("fixed");
  expect(notice.top).toBeLessThanOrEqual(24);
  expect(notice.centerOffset).toBeLessThanOrEqual(1);
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
test("theme follows the system, toggles without changing layout, and remembers the choice", async ({
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
test("Settings applies each palette, remembers it, and can follow the system again", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const background = () =>
    root.evaluate((element) => getComputedStyle(element).backgroundColor);
  const paletteBackgrounds = new Set([await background()]);
  const palettes = [
    ["Warm Light", "light"],
    ["Forest Dark", "dark"],
    ["Sierra Blue", "sierra-blue"],
    ["DeepBlck", "deep-black"],
    ["Gray", "gray"],
  ] as const;
  for (const [name, value] of palettes) {
    const option = page.getByRole("button", { name, exact: true });
    await option.click();
    await expect(root).toHaveAttribute("data-theme", value);
    await expect(option).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() => localStorage.getItem("planner-theme")),
    ).toBe(value);
    if (value !== "light") {
      const color = await background();
      expect(paletteBackgrounds.has(color)).toBe(false);
      paletteBackgrounds.add(color);
    }
    if (value === "sierra-blue" || value === "deep-black" || value === "gray") {
      await page.screenshot({
        path: `tests/theme-${value}-desktop.png`,
        fullPage: true,
      });
    }
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "gray");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Gray", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Sierra Blue", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.screenshot({
    path: "tests/theme-sierra-blue-iphone.png",
    fullPage: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(root).toHaveAttribute("data-theme", "sierra-blue");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sierra Blue", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);

  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("planner-theme"))).toBe(
    null,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "System", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await context.close();
});
test("cloud persistence, live sync, independent edits, routines, offline recovery and responsive layout", async ({
  browser,
}) => {
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
  await p.getByRole("button", { name: "Add routine", exact: true }).click();
  await p.getByPlaceholder("Name your habit").fill("Stretch");
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
  const desktopPlannerTop = await p
    .locator(".planner")
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await a.setOffline(true);
  await p
    .getByPlaceholder("Let your thoughts land here…")
    .fill("Keep this unsaved thought");
  await expect(p.locator("header [role=status]")).toContainText("Offline");
  await expect(p.locator(".save-notice")).toBeVisible();
  await expectFloatingTopCenter(p);
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
  await expect(p.locator(".save-notice[role=alert]")).toBeVisible();
  expect(
    await p
      .locator(".planner")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
  ).toBe(desktopPlannerTop);
  await expect(p.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Rejected edit is preserved",
  );
  await p.reload();
  await expect(p.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Rejected edit is preserved",
  );
  await p.evaluate(async () => {
    const { auth } = await import("/src/firebase.ts" as string);
    for (const key of Object.keys(localStorage).filter((k) =>
      k.startsWith("planner-pending:" + auth.currentUser.uid + ":"),
    )) {
      const op = JSON.parse(localStorage.getItem(key)!);
      if (op.patch.time === "99:99") {
        op.patch.time = "";
        localStorage.setItem(key, JSON.stringify(op));
      }
    }
  });
  await p.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveValue(
    "Rejected edit is preserved",
  );
  await p.screenshot({ path: "tests/desktop.png", fullPage: true });
  for (const [name, value, file] of [
    ["Sierra Blue", "sierra-blue", "tests/theme-sierra-blue-dashboard.png"],
    ["DeepBlck", "deep-black", "tests/theme-deep-black-dashboard.png"],
    ["Gray", "gray", "tests/theme-gray-dashboard.png"],
  ]) {
    await p.getByRole("button", { name: "Settings", exact: true }).click();
    await p.getByRole("button", { name, exact: true }).click();
    await expect(p.locator("html")).toHaveAttribute("data-theme", value);
    await p.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(p.getByPlaceholder("Note title")).toHaveValue(
      "A small reminder",
    );
    await p.screenshot({ path: file, fullPage: true });
  }
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
  const mobilePlannerTop = await p
    .locator(".planner")
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await a.setOffline(true);
  await p.getByPlaceholder("Note title").fill("A reminder on iPhone");
  await expect(p.locator(".save-notice")).toBeVisible();
  await expectFloatingTopCenter(p);
  expect(
    await p
      .locator(".planner")
      .evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
  ).toBe(mobilePlannerTop);
  await a.setOffline(false);
  await expect(p.locator("header [role=status]")).toHaveText("Saved");
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
  p.on("dialog", (d) => d.accept());
  await p
    .getByRole("button", { name: "Delete A reminder on iPhone", exact: true })
    .click();
  await expect(q.getByPlaceholder("Let your thoughts land here…")).toHaveCount(
    0,
  );
  await p
    .getByRole("button", {
      name: "Delete Title from first device",
      exact: true,
    })
    .click();
  await expect(q.getByPlaceholder("What would you like to do?")).toHaveCount(0);
  const c = await browser.newContext();
  const other = await c.newPage();
  await login(other, "other-" + Date.now());
  await expect(
    other.getByPlaceholder("Let your thoughts land here…"),
  ).toHaveCount(0);
  await c.close();
  await a.close();
  await b.close();
});
