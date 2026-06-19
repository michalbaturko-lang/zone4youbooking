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
      start - now >= rules.freeCancellationHours * 60 * 60 * 1000 &&
      start - now <= rules.reservationWindowHours * 60 * 60 * 1000
    );
  });
}

function findFullLesson(lessons) {
  return lessons.find((lesson) => lesson.occupiedCount >= lesson.capacity);
}

async function main() {
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
  if (snapshot.rules.reservationHoldKc !== 100) {
    throw new Error(`Unexpected reservationHoldKc: ${snapshot.rules.reservationHoldKc}`);
  }
  const reservable = findReservableLesson(snapshot.lessons, snapshot.reservations, snapshot.rules);
  if (!reservable) throw new Error("No reservable lesson found in snapshot.");

  const created = await request("/api/reservations", {
    method: "POST",
    body: bodyWithDemoState({ lessonId: reservable.id }),
  });
  if (created.reservation.holdAmountKc !== snapshot.rules.reservationHoldKc) {
    throw new Error(`Unexpected hold amount: ${created.reservation.holdAmountKc}`);
  }

  await request(`/api/reservations/${created.reservation.id}`, {
    method: "DELETE",
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
