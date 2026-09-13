import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  externalDemoRequestHeaders,
  isExpectedExternalDemoConsoleNoise,
} from "./external-demo-guard";

function captureUnexpectedBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!isExpectedExternalDemoConsoleNoise(text)) errors.push(`console: ${text}`);
  });
  return errors;
}

let isolatedTestClient = 0;

async function openCleanDemo(page: Page) {
  isolatedTestClient += 1;
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${isolatedTestClient}`,
    ...externalDemoRequestHeaders(),
  });
  await page.addInitScript(() => {
    const initializationKey = "zone4youbooking.e2e.initialized";
    if (window.sessionStorage.getItem(initializationKey)) return;
    window.localStorage.clear();
    window.sessionStorage.setItem(initializationKey, "true");
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Přihlásit se" }).first()).toBeVisible();
}

function visibleWeekLessons(page: Page, projectName: string) {
  return projectName.startsWith("mobile")
    ? page.locator(".week-mobile-list .lesson-row")
    : page.locator(".week-table .week-lesson");
}

test("zobrazí všech 24 lekcí, všechny sály a Reformer bez browser chyby", { tag: "@preview" }, async ({ page }, testInfo) => {
  const browserErrors = captureUnexpectedBrowserErrors(page);
  await openCleanDemo(page);

  const logo = page.locator("button.logo");
  const visibleLogoLabel = (await logo.innerText()).trim().replace(/\s+/g, " ");
  expect(visibleLogoLabel).toMatch(/^Z4Y(?: Zone4You)?$/);
  await expect(logo).toHaveAccessibleName(visibleLogoLabel);

  const iconHref = await page.locator('link[rel~="icon"]').first().getAttribute("href");
  expect(iconHref).toBeTruthy();
  const iconResponse = await page.request.get(iconHref!);
  expect(iconResponse.status()).toBe(200);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");

  const documentResponse = await page.request.get("/");
  expect(documentResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(documentResponse.headers()["strict-transport-security"]).toContain("max-age=63072000");
  expect(documentResponse.headers()["x-content-type-options"]).toBe("nosniff");

  await page.getByRole("button", { name: "Týden", exact: true }).click();
  const lessons = visibleWeekLessons(page, testInfo.project.name);
  await expect(lessons).toHaveCount(24);

  const roomFilter = page.getByLabel("Filtr místnosti");
  await expect(roomFilter.getByRole("button", { name: "Sál 1", exact: true })).toBeVisible();
  await expect(roomFilter.getByRole("button", { name: "Sál 2", exact: true })).toBeVisible();
  await expect(roomFilter.getByRole("button", { name: "Sál 3", exact: true })).toBeVisible();

  for (const roomName of ["Sál 1", "Sál 2", "Sál 3"]) {
    await roomFilter.getByRole("button", { name: roomName, exact: true }).click();
    const roomLessons = visibleWeekLessons(page, testInfo.project.name);
    await expect(roomLessons.first()).toBeVisible();
    expect(await roomLessons.count()).toBeGreaterThan(0);
  }

  await roomFilter.getByRole("button", { name: "Reformer", exact: true }).click();

  const reformerLessons = visibleWeekLessons(page, testInfo.project.name);
  await expect(reformerLessons).toHaveCount(3);
  for (const label of await reformerLessons.allTextContents()) {
    expect(label).toContain("REFORMER");
  }

  await reformerLessons.first().click();
  const reformerDialog = page.getByRole("dialog", { name: "REFORMER" });
  await expect(reformerDialog.getByText("Storno Reformeru čeká na potvrzení", { exact: false })).toBeVisible();
  await expect(reformerDialog.getByText("Bezplatné storno", { exact: true })).toHaveCount(0);
  await reformerDialog.getByRole("button", { name: "Zavřít" }).first().click();

  const viewportOverflow = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(viewportOverflow.documentWidth).toBeLessThanOrEqual(viewportOverflow.width);

  await testInfo.attach(`schedule-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(browserErrors).toEqual([]);
});

test("mobile zachová libovolně velký Luxart feed a dynamicky přidá každý nový sál", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-standard-390x844", "Dynamickou úplnost feedu stačí ověřit v referenčním mobile-first viewportu.");
  const browserErrors = captureUnexpectedBrowserErrors(page);
  const addedRooms = ["Sál 17", "Pohybový ateliér Sever", "Reformer"];
  const expectedRoomCounts = new Map<string, number>();
  let expectedLessonCount = 0;

  await page.route("**/api/booking/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { lessons?: Array<Record<string, unknown>> };
    const originalLessons = body.lessons ?? [];
    const additions = Array.from({ length: 13 }, (_, index) => {
      const source = originalLessons[index % originalLessons.length];
      const roomName = addedRooms[index % addedRooms.length];
      const offsetMs = (index + 1) * 60_000;
      expectedRoomCounts.set(roomName, (expectedRoomCounts.get(roomName) ?? 0) + 1);
      return {
        ...source,
        id: `${String(source.id)}-dynamic-${index + 1}`,
        luxartLessonId: `${String(source.luxartLessonId)}-dynamic-${index + 1}`,
        startsAt: new Date(Date.parse(String(source.startsAt)) + offsetMs).toISOString(),
        endsAt: new Date(Date.parse(String(source.endsAt)) + offsetMs).toISOString(),
        roomName,
        luxartRoomNumber: 17 + index,
      };
    });
    expectedLessonCount = originalLessons.length + additions.length;
    body.lessons = [...originalLessons, ...additions];
    await route.fulfill({ response, json: body });
  });

  await openCleanDemo(page);
  await page.getByRole("button", { name: "Týden", exact: true }).click();
  await expect(visibleWeekLessons(page, testInfo.project.name)).toHaveCount(expectedLessonCount);

  const roomFilter = page.getByLabel("Filtr místnosti");
  for (const roomName of addedRooms) {
    const button = roomFilter.getByRole("button", { name: roomName, exact: true });
    await expect(button).toBeVisible();
    await button.click();
    const originalRoomCount = roomName === "Reformer" ? 3 : 0;
    await expect(visibleWeekLessons(page, testInfo.project.name)).toHaveCount(
      originalRoomCount + (expectedRoomCounts.get(roomName) ?? 0),
    );
  }

  await roomFilter.getByRole("button", { name: "Všechny", exact: true }).click();
  await expect(visibleWeekLessons(page, testInfo.project.name)).toHaveCount(expectedLessonCount);

  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    undersizedRoomFilters: [...document.querySelectorAll<HTMLElement>(".legend button")]
      .map((button) => {
        const bounds = button.getBoundingClientRect();
        return { label: button.innerText.trim(), width: bounds.width, height: bounds.height };
      })
      .filter(({ width, height }) => width < 44 || height < 44),
  }));
  expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  expect(mobileLayout.undersizedRoomFilters).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("mobile-first matice drží 44px ovládání, obsah nad navigací a bezpečný dialog", { tag: "@preview" }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith("desktop"), "Mobilní ergonomie se ověřuje na dotykových projektech.");
  await openCleanDemo(page);

  const layout = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const undersized = [...document.querySelectorAll("button, input")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: (element.getAttribute("aria-label") || element.textContent || element.getAttribute("placeholder") || "control")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((control) => control.width < 44 || control.height < 44);
    const firstLesson = document.querySelector(".lesson-row")?.getBoundingClientRect();
    const tabbarBounds = document.querySelector(".mobile-tabbar")?.getBoundingClientRect();
    const tabbar = tabbarBounds && tabbarBounds.height > 0 ? tabbarBounds : undefined;
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      undersized,
      lessonVisibleAboveTabbar: Boolean(firstLesson && (tabbar ? firstLesson.top < tabbar.top : firstLesson.top < window.innerHeight)),
    };
  });
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.undersized).toEqual([]);
  expect(layout.lessonVisibleAboveTabbar).toBe(true);

  await page.locator(".lesson-row").first().click();
  const dialogLayout = await page.evaluate(() => {
    const dialog = document.querySelector(".modal")?.getBoundingClientRect();
    const controls = [...document.querySelectorAll(".modal button")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    return {
      bodyOverflow: document.body.style.overflow,
      dialogInsideViewport: Boolean(
        dialog && dialog.left >= 0 && dialog.right <= window.innerWidth && dialog.top >= 0 && dialog.bottom <= window.innerHeight,
      ),
      undersizedControls: controls.filter((control) => control.width < 44 || control.height < 44),
    };
  });
  expect(dialogLayout.bodyOverflow).toBe("hidden");
  expect(dialogLayout.dialogInsideViewport).toBe(true);
  expect(dialogLayout.undersizedControls).toEqual([]);
});

test("přihlášení, rezervace a storno projdou uživatelským flow", { tag: "@preview-auth" }, async ({ page }, testInfo) => {
  const externalPreview = Boolean(process.env.PLAYWRIGHT_EXTERNAL_DEMO_URL?.trim());
  test.skip(
    externalPreview && testInfo.project.name !== "mobile-small-320x568",
    "Ve veřejném Preview stačí jeden autentizovaný průchod; úplná matice by záměrně narazila na login rate limit.",
  );
  const browserErrors = captureUnexpectedBrowserErrors(page);
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill(externalPreview ? "demo@zone4you.cz" : "Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  await page.getByLabel("Výběr dne").getByRole("button").nth(1).click();
  await page.locator(".lesson-row").filter({ hasText: "PUMPING" }).first().click();
  const lessonDialog = page.getByRole("dialog", { name: "PUMPING" });
  await lessonDialog.getByRole("button", { name: "Rezervovat" }).click();
  await expect(page.getByText("Rezervace PUMPING je potvrzená.")).toBeVisible();

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("navigation", { name: "Navigace" }).getByRole("button", { name: "Rezervace" }).click();
  } else {
    await page.getByRole("button", { name: "Moje rezervace" }).click();
  }
  const reservation = page.locator(".reservation-card").filter({ hasText: "PUMPING" });
  await expect(reservation).toBeVisible();
  await reservation.getByRole("button", { name: "Zrušit" }).click();
  await expect(page.getByText("Rezervace byla zrušena bez storno poplatku.")).toBeVisible();
  await expect(reservation).toHaveCount(0);

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("navigation", { name: "Navigace" }).getByRole("button", { name: "Rozvrh" }).click();
  } else {
    await page.getByRole("button", { name: "Rozvrh", exact: true }).click();
  }
  await page.getByLabel("Filtr místnosti").getByRole("button", { name: "Reformer", exact: true }).click();
  await page.locator(".lesson-row").filter({ hasText: "REFORMER" }).first().click();
  const reformerDialog = page.getByRole("dialog", { name: "REFORMER" });
  await reformerDialog.getByRole("button", { name: "Rezervovat" }).click();
  await expect(page.getByText("Rezervace REFORMER je potvrzená.")).toBeVisible();

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("navigation", { name: "Navigace" }).getByRole("button", { name: "Rezervace" }).click();
  } else {
    await page.getByRole("button", { name: "Moje rezervace" }).click();
  }
  const reformerReservation = page.locator(".reservation-card")
    .filter({ hasText: "REFORMER" })
    .filter({ has: page.getByRole("button", { name: "Zrušit" }) });
  await expect(reformerReservation.getByText("Storno podmínky Reformeru čekají na potvrzení", { exact: false })).toBeVisible();
  await expect(reformerReservation.getByText("Bezplatné storno", { exact: false })).toHaveCount(0);
  await reformerReservation.getByRole("button", { name: "Zrušit" }).click();
  await expect(page.getByText("Rezervace byla zrušena bez storno poplatku.")).toBeVisible();
  await expect(reformerReservation).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test("kredit pod 200 Kč zablokuje rezervaci bez zápisu", async ({ page }) => {
  let reservationWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/reservations") {
      reservationWrites += 1;
    }
  });
  await page.route("**/api/booking/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.user) body.user.creditBalanceKc = 199;
    await route.fulfill({ response, json: body });
  });
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();

  await page.getByLabel("Výběr dne").getByRole("button").nth(1).click();
  await page.locator(".lesson-row").filter({ hasText: "PUMPING" }).first().click();
  const lessonDialog = page.getByRole("dialog", { name: "PUMPING" });
  await expect(lessonDialog.getByRole("button", { name: "Je potřeba alespoň 200 Kč kreditu" })).toBeDisabled();
  expect(reservationWrites).toBe(0);
});

test("zastaralý snapshot zablokuje booking, dokud se nepodaří obnovit autoritativní data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-small-320x568", "Stavový bezpečnostní tok stačí ověřit jednou.");
  let failSnapshot = false;
  let reservationWrites = 0;
  let cancellationWrites = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname === "/api/reservations") {
      reservationWrites += 1;
    }
    if (request.method() === "DELETE" && pathname.startsWith("/api/reservations/")) {
      cancellationWrites += 1;
    }
  });
  await page.route("**/api/booking/snapshot**", async (route) => {
    if (!failSnapshot) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Požadavek se nepodařilo dokončit.",
        code: "REQUEST_FAILED",
        requestId: "stale-snapshot-browser",
      }),
    });
  });
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  failSnapshot = true;
  await page.getByRole("button", { name: "EN", exact: true }).first().click();
  const staleBanner = page.locator(".runtime-error-banner");
  await expect(staleBanner).toContainText("Data freshness cannot be confirmed");
  await expect(staleBanner).toContainText("Support reference: stale-snapshot-browser");

  await page.getByRole("navigation", { name: "Navigation" }).getByRole("button", { name: "Bookings" }).click();
  await expect(
    page.locator(".reservation-card").getByRole("button", { name: "Refresh current data first", exact: true }).first(),
  ).toBeDisabled();
  expect(cancellationWrites).toBe(0);

  await page.getByRole("navigation", { name: "Navigation" }).getByRole("button", { name: "Schedule" }).click();
  await page.locator(".lesson-row").first().click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Refresh current data first", exact: true }),
  ).toBeDisabled();
  await expect(staleBanner).toContainText("Restore the connection before booking");
  expect(reservationWrites).toBe(0);
  expect(cancellationWrites).toBe(0);
});

test("ztracená odpověď rezervace zamkne další booking proti slepému opakování", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-small-320x568", "Stavový bezpečnostní tok stačí ověřit jednou.");
  let reservationWrites = 0;
  await openCleanDemo(page);
  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  await page.route("**/api/reservations", async (route) => {
    reservationWrites += 1;
    await route.abort("timedout");
  });
  await page.locator(".lesson-row").first().click();
  const lessonDialog = page.getByRole("dialog");
  const reserveButton = lessonDialog.getByRole("button", { name: "Rezervovat" });
  await reserveButton.click();
  await expect.poll(() => reservationWrites).toBe(1);
  await expect(
    lessonDialog.getByRole("button", { name: "Před další akcí kontaktujte recepci", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(250);
  expect(reservationWrites).toBe(1);
});

test("personalizovaná způsobilost lekci neschová a bezpečně zablokuje zápis", async ({ page }) => {
  let eligibility: false | undefined = false;
  let reservationWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/reservations") {
      reservationWrites += 1;
    }
  });
  await page.route("**/api/booking/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.capabilities.businessRulesStatus = "confirmed";
    body.lessons = body.lessons.map((lesson: Record<string, unknown>) => ({
      ...lesson,
      canCurrentUserReserve: eligibility,
    }));
    await route.fulfill({ response, json: body });
  });
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();

  const firstLesson = page.locator(".lesson-row").first();
  await expect(firstLesson).toBeVisible();
  await firstLesson.click();
  let lessonDialog = page.getByRole("dialog");
  await expect(lessonDialog.getByRole("button", { name: "Tuto lekci nelze rezervovat pro váš účet" })).toBeDisabled();
  await lessonDialog.getByRole("button", { name: "Zavřít" }).first().click();

  eligibility = undefined;
  await page.reload();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();
  await page.locator(".lesson-row").first().click();
  lessonDialog = page.getByRole("dialog");
  await expect(lessonDialog.getByRole("button", { name: "Možnost rezervace se nepodařila ověřit" })).toBeDisabled();
  expect(reservationWrites).toBe(0);
});

test("session přežije reload a logout odstraní klienta i přístup k rezervacím", async ({ page }, testInfo) => {
  const browserErrors = captureUnexpectedBrowserErrors(page);
  await openCleanDemo(page);

  let reservationWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/reservations") {
      reservationWrites += 1;
    }
  });

  await page.getByLabel("Výběr dne").getByRole("button").nth(1).click();
  await page.locator(".lesson-row").filter({ hasText: "PUMPING" }).first().click();
  await page.getByRole("dialog", { name: "PUMPING" }).getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("dialog", { name: "Přihlášení" })).toBeVisible();
  expect(reservationWrites).toBe(0);

  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();
  const authenticatedReservations = await page.request.get("/api/reservations");
  expect(authenticatedReservations.status()).toBe(200);

  const profileNavigation = testInfo.project.name.startsWith("mobile")
    ? page.getByRole("navigation", { name: "Navigace" })
    : page.locator(".user-section");
  await profileNavigation.getByRole("button", { name: "Profil", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tereza Nováková" })).toBeVisible();
  await testInfo.attach(`session-after-reload-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: "Odhlásit" }).click();
  await expect(page.getByText("Odhlášeno.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Přihlásit se" }).first()).toBeVisible();
  await expect(page.getByText("Tereza Nováková", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Profil", exact: true })).toHaveCount(0);

  const loggedOutReservations = await page.request.get("/api/reservations");
  expect(loggedOutReservations.status()).toBe(401);
  expect(await loggedOutReservations.json()).toMatchObject({
    code: "AUTH_REQUIRED",
    requestId: expect.any(String),
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Přihlásit se" }).first()).toBeVisible();
  const loggedOutLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(loggedOutLayout.documentWidth).toBeLessThanOrEqual(loggedOutLayout.viewportWidth);
  await testInfo.attach(`session-after-logout-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(reservationWrites).toBe(0);
  expect(browserErrors).toEqual([]);
});

test("rozvrh a dialogy projdou WCAG scanem i klávesnicovým focus flow", { tag: "@preview" }, async ({ page }, testInfo) => {
  await openCleanDemo(page);

  const scheduleScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach("accessibility-schedule", {
    body: JSON.stringify(scheduleScan, null, 2),
    contentType: "application/json",
  });
  expect(scheduleScan.violations).toEqual([]);

  await page.getByLabel("Filtr místnosti").getByRole("button", { name: "Reformer", exact: true }).click();
  const reformerTrigger = page.locator(".lesson-row").filter({ hasText: "REFORMER" }).first();
  await reformerTrigger.focus();
  await page.keyboard.press("Enter");
  const lessonDialog = page.getByRole("dialog", { name: "REFORMER" });
  await expect(lessonDialog).toBeVisible();
  await expect(lessonDialog.locator(".modal-close")).toBeFocused();

  const dialogScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach("accessibility-lesson-dialog", {
    body: JSON.stringify(dialogScan, null, 2),
    contentType: "application/json",
  });
  expect(dialogScan.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(lessonDialog).toHaveCount(0);
  await expect(reformerTrigger).toBeFocused();

  const loginTrigger = page.getByRole("button", { name: "Přihlásit se" }).first();
  await loginTrigger.focus();
  await page.keyboard.press("Enter");
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  const usernameInput = loginDialog.getByLabel("Příjmení, e-mail nebo login");
  await expect(usernameInput).toBeFocused();
  await expect(loginDialog.getByText(/zapomenuté heslo/i)).toHaveCount(0);
  await expect(loginDialog.getByRole("link")).toHaveCount(0);
  await testInfo.attach(`keyboard-focus-login-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  const loginScan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  await testInfo.attach("accessibility-login-dialog", {
    body: JSON.stringify(loginScan, null, 2),
    contentType: "application/json",
  });
  expect(loginScan.violations).toEqual([]);

  const backwardTab = testInfo.project.name.includes("webkit") ? "Alt+Shift+Tab" : "Shift+Tab";
  await page.keyboard.press(backwardTab);
  await expect(loginDialog.locator(".modal-close")).toBeFocused();
  await page.keyboard.press(backwardTab);
  await expect(loginDialog.getByRole("button", { name: "Přihlásit se" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(loginDialog).toHaveCount(0);
  await expect(loginTrigger).toBeFocused();
});

test("angličtina a oblíbené lekce přežijí reload", { tag: "@preview" }, async ({ page }, testInfo) => {
  await openCleanDemo(page);

  await page.getByRole("button", { name: "EN", exact: true }).click();
  const englishNavigation = testInfo.project.name.startsWith("mobile")
    ? page.getByRole("navigation", { name: "Navigation" })
    : page.locator(".user-section");
  await expect(englishNavigation.getByRole("button", { name: "Schedule", exact: true })).toBeVisible();
  await expect(englishNavigation.getByRole("button", { name: testInfo.project.name.startsWith("mobile") ? "Bookings" : "My bookings", exact: true })).toBeVisible();
  const englishLoginTrigger = page.getByRole("button", { name: "Sign in", exact: true }).first();
  await expect(englishLoginTrigger).toBeVisible();
  await englishLoginTrigger.click();
  const englishLoginDialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(englishLoginDialog.getByText(/forgot password/i)).toHaveCount(0);
  await expect(englishLoginDialog.getByRole("link")).toHaveCount(0);
  await englishLoginDialog.getByRole("button", { name: "Close" }).first().click();
  const englishRoomFilter = page.getByLabel("Room filter");
  for (const roomName of ["Studio 1", "Studio 2", "Studio 3", "Reformer"]) {
    await expect(englishRoomFilter.getByRole("button", { name: roomName, exact: true })).toBeVisible();
  }
  await englishRoomFilter.getByRole("button", { name: "Reformer", exact: true }).click();
  const englishReformer = page.locator(".lesson-row").filter({ hasText: "REFORMER" }).first();
  await englishReformer.click();
  const englishReformerDialog = page.getByRole("dialog", { name: "REFORMER" });
  await expect(englishReformerDialog.getByText("Reformer cancellation terms are awaiting confirmation", { exact: false })).toBeVisible();
  await expect(englishReformerDialog.getByText("Free cancellation", { exact: true })).toHaveCount(0);
  await englishReformerDialog.getByRole("button", { name: "Close" }).first().click();
  await page.reload();
  await expect(englishNavigation.getByRole("button", { name: "Schedule", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "CS", exact: true }).click();
  await page.locator(".lesson-row").filter({ hasText: "HEAT easy" }).first().click();
  await page.getByRole("button", { name: "Odebrat z oblíbených" }).click();
  await page.getByRole("button", { name: "Zavřít" }).first().click();
  await page.getByRole("button", { name: "Oblíbené" }).click();
  await expect(page.locator(".lesson-row").filter({ hasText: "HEAT easy" })).toHaveCount(0);

  await page.getByRole("button", { name: "Oblíbené" }).click();
  await page.locator(".lesson-row").filter({ hasText: "HEAT easy" }).first().click();
  await page.getByRole("button", { name: "Přidat do oblíbených" }).click();
  await page.getByRole("button", { name: "Zavřít" }).first().click();
  await page.reload();
  await page.getByRole("button", { name: "Oblíbené" }).click();
  await expect(page.locator(".lesson-row").filter({ hasText: "HEAT easy" }).first()).toBeVisible();
});

test("read-only fallback skryje live dobití a zablokuje booking v UI", async ({ page }, testInfo) => {
  await page.route("**/api/booking/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.capabilities = {
      ...body.capabilities,
      reservationsEnabled: false,
      waitlistEnabled: false,
      topupsEnabled: false,
      topupMode: "disabled",
      businessRulesStatus: "unconfirmed",
    };
    await route.fulfill({ response, json: body });
  });
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();

  await page.locator(".lesson-row").first().click();
  await expect(page.getByRole("button", { name: "Booking je dočasně pouze pro čtení" })).toBeDisabled();
  await expect(page.getByText("Storno, kreditní blokace a rezervační okno čekají na potvrzení Zone4You.")).toBeVisible();
  await expect(page.getByText("Blokace kreditu", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Bezplatné storno", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Zavřít" }).first().click();

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("navigation", { name: "Navigace" }).getByRole("button", { name: "Kredit" }).click();
  } else {
    await page.locator(".user-section").getByRole("button", { name: "Kredit", exact: true }).click();
  }
  await expect(page.getByText("Online dobití bude dostupné až po bezpečném ověření Stripe.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "500 Kč" })).toHaveCount(0);
});

test("Stripe režim vytváří Checkout na serveru a návrat neslibuje kredit před webhookem", async ({ page }, testInfo) => {
  await page.route("**/api/booking/snapshot**", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.capabilities = {
      ...body.capabilities,
      topupsEnabled: true,
      topupMode: "stripe",
    };
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/payments/checkout", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        checkoutSessionId: "cs_test_browser",
        url: "https://checkout.stripe.com/c/pay/cs_test_browser",
      }),
    });
  });
  await page.route("https://checkout.stripe.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Stripe Checkout test</title>" });
  });
  await openCleanDemo(page);

  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("navigation", { name: "Navigace" }).getByRole("button", { name: "Kredit" }).click();
  } else {
    await page.locator(".user-section").getByRole("button", { name: "Kredit", exact: true }).click();
  }
  await page.getByRole("button", { name: "500 Kč" }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_browser");

  await page.goto("/?payment=success&session_id=cs_test_browser");
  await expect(page.getByText("Platba se ověřuje. Kredit se připíše pouze po potvrzeném Stripe webhooku.")).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("výpadek rozvrhu má trvalý retry stav a vypršená session odstraní starého klienta", async ({ page }, testInfo) => {
  const browserErrors = captureUnexpectedBrowserErrors(page);
  isolatedTestClient += 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${isolatedTestClient}` });
  await page.addInitScript(() => window.localStorage.clear());

  let allowSnapshot = false;
  await page.route("**/api/booking/snapshot", async (route) => {
    if (allowSnapshot) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "X-Request-ID": "schedule-outage-browser" },
      body: JSON.stringify({
        error: "Požadavek se nepodařilo dokončit.",
        code: "REQUEST_FAILED",
        requestId: "schedule-outage-browser",
      }),
    });
  });

  await page.goto("/");
  const loadError = page.locator("main.load-error-screen");
  await expect(loadError.getByRole("heading", { name: "Rozvrh se nepodařilo načíst" })).toBeVisible();
  await expect(loadError).toContainText("Kód pro podporu: schedule-outage-browser");
  await expect(page.getByText("Žádné lekce neodpovídají filtrům")).toHaveCount(0);
  await loadError.getByRole("button", { name: "EN", exact: true }).click();
  await expect(loadError.getByRole("heading", { name: "The schedule could not be loaded" })).toBeVisible();
  await expect(loadError).toContainText("Support reference: schedule-outage-browser");
  await loadError.getByRole("button", { name: "CS", exact: true }).click();
  await expect(loadError.getByRole("heading", { name: "Rozvrh se nepodařilo načíst" })).toBeVisible();
  await testInfo.attach(`outage-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  allowSnapshot = true;
  await loadError.getByRole("button", { name: "Zkusit znovu" }).click();
  await expect(page.getByRole("button", { name: "Přihlásit se" }).first()).toBeVisible();

  let allowLogin = false;
  await page.route("**/api/auth/login", async (route) => {
    if (allowLogin) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "X-Request-ID": "invalid-login-browser" },
      body: JSON.stringify({
        error: "Přihlášení se nepodařilo.",
        code: "AUTH_INVALID",
        requestId: "invalid-login-browser",
      }),
    });
  });
  await page.getByRole("button", { name: "Přihlásit se" }).first().click();
  const loginDialog = page.getByRole("dialog", { name: "Přihlášení" });
  await expect(loginDialog.getByLabel("Příjmení, e-mail nebo login")).toHaveValue("");
  await expect(loginDialog.getByLabel("Heslo", { exact: true })).toHaveValue("");
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Neplatný klient");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("wrong");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(loginDialog).toBeVisible();
  await expect(page.getByText("Kód pro podporu: invalid-login-browser.", { exact: false })).toBeVisible();

  allowLogin = true;
  await loginDialog.getByLabel("Příjmení, e-mail nebo login").fill("Nováková");
  await loginDialog.getByLabel("Heslo", { exact: true }).fill("2048");
  await loginDialog.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toBeVisible();

  await page.route("**/api/reservations", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "X-Request-ID": "session-expired-browser" },
      body: JSON.stringify({
        error: "Přihlášení vypršelo. Přihlaste se znovu.",
        code: "SESSION_INVALID",
        requestId: "session-expired-browser",
      }),
    });
  });
  await page.getByLabel("Výběr dne").getByRole("button").nth(1).click();
  await page.locator(".lesson-row").filter({ hasText: "PUMPING" }).first().click();
  await page.getByRole("dialog", { name: "PUMPING" }).getByRole("button", { name: "Rezervovat" }).click();

  await expect(page.getByRole("dialog", { name: "Přihlášení" })).toBeVisible();
  await expect(page.getByText("Přihlášení vypršelo. Přihlaste se znovu.", { exact: false })).toBeVisible();
  await expect(page.getByText("Kód pro podporu: session-expired-browser.", { exact: false })).toBeVisible();
  await expect(page.locator(".toast-error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Odhlásit" })).toHaveCount(0);
  await page.locator(".toast").evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const overlayBounds = await page.evaluate(() => {
    const toast = document.querySelector(".toast")?.getBoundingClientRect();
    const dialog = document.querySelector(".login-modal")?.getBoundingClientRect();
    return toast && dialog ? {
      disjoint: toast.bottom <= dialog.top || toast.top >= dialog.bottom,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    } : null;
  });
  expect(overlayBounds?.disjoint).toBe(true);
  expect(overlayBounds?.documentWidth).toBeLessThanOrEqual(overlayBounds?.viewportWidth ?? 0);
  await testInfo.attach(`expired-session-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(browserErrors.some((error) => error.includes("503 (Service Unavailable)"))).toBe(true);
  expect(browserErrors.filter((error) => error.includes("401 (Unauthorized)")).length).toBeGreaterThanOrEqual(2);
  expect(browserErrors.filter((error) =>
    !error.includes("503 (Service Unavailable)") && !error.includes("401 (Unauthorized)"),
  )).toEqual([]);
});
