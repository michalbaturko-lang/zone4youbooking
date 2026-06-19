const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3007";
let demoState;

function bodyWithDemoState(body = {}) {
  return JSON.stringify(demoState ? { ...body, demoState } : body);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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

function findReservableLesson(lessons) {
  return lessons.find((lesson) => lesson.occupiedCount < lesson.capacity);
}

function findFullLesson(lessons) {
  return lessons.find((lesson) => lesson.occupiedCount >= lesson.capacity);
}

async function main() {
  await request("/api/demo/reset", { method: "POST" });
  const login = await request("/api/auth/login", {
    method: "POST",
    body: bodyWithDemoState({
      login: "demo@zone4you.cz",
      password: "1234",
      memberCardNumber: "Z4Y-2048",
    }),
  });

  const snapshot = await request("/api/booking/snapshot", {
    method: "POST",
    body: bodyWithDemoState(),
  });
  const reservable = findReservableLesson(snapshot.lessons);
  if (!reservable) throw new Error("No reservable lesson found in snapshot.");

  const created = await request("/api/reservations", {
    method: "POST",
    body: bodyWithDemoState({ lessonId: reservable.id }),
  });

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
