const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3007";
const vercelProtectionBypass = process.env.VERCEL_PROTECTION_BYPASS;
let demoState;

function bodyWithDemoState(body = {}) {
  return JSON.stringify(demoState ? { ...body, demoState } : body);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(vercelProtectionBypass ? { "x-vercel-protection-bypass": vercelProtectionBypass } : {}),
      ...init?.headers,
    },
  });
  const requestId = response.headers.get("x-request-id");
  if (!requestId) throw new Error(`${init?.method ?? "GET"} ${path} did not return X-Request-ID.`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  if (json.demoState) {
    demoState = json.demoState;
  }
  return json;
}

function findReservableLesson(lessons, reservations, rules) {
  const now = Date.now();
  const activeLessonIds = new Set(
    reservations.filter((reservation) => reservation.status === "active").map((reservation) => reservation.lessonId),
  );
  return lessons.find((lesson) => {
    const start = new Date(lesson.startsAt).getTime();
    return (
      !activeLessonIds.has(lesson.id) &&
      lesson.occupiedCount < lesson.capacity &&
      start > now &&
      start - now >= 12 * 60 * 60 * 1000 &&
      start - now <= rules.reservationWindowHours * 60 * 60 * 1000
    );
  });
}

function findFullLesson(lessons) {
  return lessons.find((lesson) => lesson.occupiedCount >= lesson.capacity);
}

async function main() {
  const health = await request("/api/health");
  const readiness = await request("/api/readiness");
  if (health.status !== "ok" || readiness.status !== "ready") {
    throw new Error("Health or readiness endpoint is not ready in demo mode.");
  }

  await request("/api/demo/reset", { method: "POST" });
  const login = await request("/api/auth/login", {
    method: "POST",
    body: bodyWithDemoState({
      login: "Nováková",
      password: "2048",
    }),
  });

  const snapshot = await request("/api/booking/snapshot", {
    method: "POST",
    body: bodyWithDemoState(),
  });
  if (snapshot.rules.scheduleDays !== 7) throw new Error(`Unexpected scheduleDays: ${snapshot.rules.scheduleDays}`);
  if (snapshot.rules.minimumCreditForReservationKc !== 200) {
    throw new Error(`Unexpected minimumCreditForReservationKc: ${snapshot.rules.minimumCreditForReservationKc}`);
  }
  if (snapshot.rules.reservationHoldKc !== 100) {
    throw new Error(`Unexpected reservationHoldKc: ${snapshot.rules.reservationHoldKc}`);
  }
  if (!snapshot.capabilities?.topupsEnabled || snapshot.capabilities.topupMode !== "demo") {
    throw new Error(`Unexpected demo top-up capability: ${JSON.stringify(snapshot.capabilities)}`);
  }
  if (!snapshot.capabilities.reservationsEnabled || !snapshot.capabilities.waitlistEnabled) {
    throw new Error(`Unexpected demo booking capabilities: ${JSON.stringify(snapshot.capabilities)}`);
  }
  const reservable = findReservableLesson(snapshot.lessons, snapshot.reservations, snapshot.rules);
  if (!reservable) throw new Error("No reservable lesson found in snapshot.");

  const created = await request("/api/reservations", {
    method: "POST",
    headers: { "Idempotency-Key": `reserve:smoke:${Date.now()}` },
    body: bodyWithDemoState({ lessonId: reservable.id }),
  });
  if (created.reservation.holdAmountKc !== snapshot.rules.reservationHoldKc) {
    throw new Error(`Unexpected hold amount: ${created.reservation.holdAmountKc}`);
  }

  await request(`/api/reservations/${created.reservation.id}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": `cancel:smoke:${Date.now()}` },
    body: bodyWithDemoState(),
  });

  const full = findFullLesson(snapshot.lessons);
  if (full) {
    const waitlist = await request("/api/waitlist", {
      method: "POST",
      body: bodyWithDemoState({ lessonId: full.id }),
    });
    await request(`/api/waitlist/${waitlist.waitlistEntry.id}`, {
      method: "DELETE",
      body: bodyWithDemoState(),
    });
  }

  await request("/api/topups", {
    method: "POST",
    body: bodyWithDemoState({
      amountKc: 500,
      provider: "stripe",
      idempotencyKey: `smoke-${Date.now()}`,
    }),
  });

  const finalSnapshot = await request("/api/booking/snapshot", {
    method: "POST",
    body: bodyWithDemoState(),
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        user: login.user.email,
        lessons: snapshot.lessons.length,
        finalCreditKc: finalSnapshot.user.creditBalanceKc,
        reservations: finalSnapshot.reservations.length,
        waitlist: finalSnapshot.waitlist.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  console.error(`Start the app first: npm run dev -- --port ${new URL(baseUrl).port || "3000"}`);
  process.exit(1);
});
