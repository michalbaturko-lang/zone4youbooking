import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  assertReservationPreconditions,
  createRealLuxartAdapter,
  maximumLuxartResponseBytes,
  readLuxartJsonResponse,
} from "../src/lib/realLuxartAdapter";
import { BookingApiError, BookingMutationOutcomeUnknownError } from "../src/lib/errors";
import type { Lesson, User } from "../src/lib/domain";
import { zone4YouScheduleRange } from "../src/lib/zone4YouTime";

test("runs the documented Luxart login, lessons, credit, reservations, watchdog and payment contract", async (context) => {
  let reservationCreated = false;
  let reservationCancelled = false;
  let reservationPostCount = 0;
  let watchdogCreated = false;
  let watchdogDeleted = false;
  let delayReservationPost = false;
  let redirectFollowed = false;
  let malformedRead: "lessons" | "reservations" | "watchdog" | "credit" | undefined;
  let malformedMutation:
    | "reservation-create"
    | "reservation-cancel"
    | "watchdog-create"
    | "watchdog-delete"
    | "payment"
    | undefined;
  let capturedReservationBody: Record<string, unknown> | undefined;
  let capturedWatchdogBody: Record<string, unknown> | undefined;
  let capturedPaymentBody: Record<string, unknown> | undefined;
  const capturedLessonQueries: URLSearchParams[] = [];

  const user = {
    user_id: 42,
    login: "test@example.invalid",
    email: "test@example.invalid",
    name: "Test",
    surname: "Klient",
    current_balance: 1_400,
    membership: "Zone4You Active",
  };
  const lesson = {
    resort: 1,
    kategorie: 12,
    date_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    id_staff: 44,
    pohlavi: "X",
    osloveni: "Lenka",
    id_service: 321,
    delka: 50,
    cena: 180,
    nazev: "HEAT easy",
    popis: "Kondiční lekce",
    kapacita: 14,
    obsazeno: 9,
    volno: 5,
    cislo_salu: 2,
    typ_lekce: 8,
  };
  const reservation = {
    resort: 1,
    id_rezervace: 987,
    id_kategorie: 12,
    datum: lesson.date_time,
    id_service: 321,
    delka: 50,
    id_resource: 207,
    price: 180,
    status: 1,
    uuid: "created-test-uuid",
  };
  const watchdog = {
    resort: 1,
    id_kategorie: 12,
    user_id: 42,
    datum: lesson.date_time,
    id_service_1: 321,
    delka_1: 50,
    poznamka: "",
    id_resource_1: 207,
    pohlavi_1: "X",
    id_watchdog: 777,
    language: "en",
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/credential-sink") {
      redirectFollowed = true;
      response.end(JSON.stringify(user));
      return;
    }
    assert.equal(
      request.headers.authorization,
      `Basic ${Buffer.from("gateway-user:gateway-password").toString("base64")}`,
    );
    assert.equal(request.headers["cache-control"], "no-store");
    assert.equal(request.headers.pragma, "no-cache");

    if (request.method === "POST" && url.pathname === "/api/Login") {
      if (url.searchParams.get("login") === "redirect@example.invalid") {
        response.statusCode = 302;
        response.setHeader("Location", "/credential-sink");
        response.end();
        return;
      }
      if (url.searchParams.get("login") === "invalid-user@example.invalid") {
        response.end(JSON.stringify({ user_id: 0, current_balance: null }));
        return;
      }
      assert.equal(url.searchParams.get("login"), "test@example.invalid");
      assert.match(url.searchParams.get("password") ?? "", /^[A-F0-9]{32}$/);
      response.end(JSON.stringify(user));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/User") {
      assert.equal(url.searchParams.get("user_id"), "42");
      response.end(JSON.stringify(user));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/Lesson") {
      capturedLessonQueries.push(new URLSearchParams(url.searchParams));
      assert.equal(url.searchParams.get("resort"), "1");
      assert.equal(url.searchParams.get("lang"), "en");
      assert.equal(url.searchParams.get("id_kategorie"), "0");
      assert.equal(url.searchParams.get("id_service"), "0");
      if (malformedRead === "lessons") {
        response.end(JSON.stringify({ unexpected: true }));
        return;
      }
      response.end(JSON.stringify([
        url.searchParams.get("date_start") === "2026-09-03"
          ? { ...lesson, resort: 2 }
          : url.searchParams.get("date_start") === "2026-09-04"
            ? { ...lesson, id_service: 0 }
            : lesson,
      ]));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/user/credit_history") {
      assert.equal(url.searchParams.get("lang"), "en");
      if (malformedRead === "credit") {
        response.end(JSON.stringify([{ resort: 1, datum: "invalid", castka: 500, cdd: 10 }]));
        return;
      }
      response.end(
        JSON.stringify([
          {
            resort: 1,
            datum: "2026-08-29T08:00:00Z",
            castka: 500,
            cdd: 10,
            text: "Dobití kreditu",
            sportoviste: 1010,
          },
        ]),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/Reservations") {
      assert.equal(url.searchParams.get("lang"), "en");
      if (malformedRead === "reservations") {
        response.end(JSON.stringify([{ ...reservation, id_rezervace: 0 }]));
        return;
      }
      response.end(JSON.stringify(reservationCreated && !reservationCancelled ? [reservation] : []));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/Reservations") {
      reservationPostCount += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capturedReservationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (malformedMutation === "reservation-create") {
        response.end(JSON.stringify({ success: 1 }));
        return;
      }
      if (delayReservationPost) await new Promise((resolve) => setTimeout(resolve, 1_100));
      reservationCreated = true;
      reservationCancelled = false;
      response.end(JSON.stringify({ success: 1, messaget: "OK", uuid: reservation.uuid }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/watchdog_II/user") {
      assert.equal(url.searchParams.get("user_id"), "42");
      if (malformedRead === "watchdog") {
        response.end(JSON.stringify([{ ...watchdog, user_id: 999 }]));
        return;
      }
      response.end(JSON.stringify(watchdogCreated && !watchdogDeleted ? [watchdog] : []));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/Reservations/watchdog_III") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capturedWatchdogBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (malformedMutation === "watchdog-create") {
        response.end(JSON.stringify({ success: "invalid" }));
        return;
      }
      watchdogCreated = true;
      response.end(JSON.stringify({ success: 1, messaget: "OK", uuid: "watchdog-test-uuid" }));
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/Watchdog/777") {
      assert.equal(url.searchParams.get("resort"), "1");
      if (malformedMutation === "watchdog-delete") {
        response.end(JSON.stringify([]));
        return;
      }
      watchdogDeleted = true;
      response.end(JSON.stringify([{ success: 1, messaget: "OK" }]));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/Payment") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      capturedPaymentBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (malformedMutation === "payment") {
        response.end(JSON.stringify({ success: 1, id_mp: 0 }));
        return;
      }
      response.end(JSON.stringify({ success: 1, messaget: "OK", id_mp: 901 }));
      return;
    }
    if (request.method === "DELETE" && url.pathname === "/api/Reservations/987") {
      assert.equal(url.searchParams.get("kategorie"), "12");
      assert.equal(url.searchParams.get("resort"), "1");
      if (malformedMutation === "reservation-cancel") {
        response.end(JSON.stringify([{ success: 1, messaget: "OK", storno_poplatek: "invalid" }]));
        return;
      }
      reservationCancelled = true;
      response.end(JSON.stringify([{ success: 1, messaget: "OK", storno_poplatek: 0 }]));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start.");

  const previousEnvironment = {
    baseUrl: process.env.LUXART_API_BASE_URL,
    resortId: process.env.LUXART_RESORT_ID,
    timeout: process.env.LUXART_TIMEOUT_MS,
    roomMap: process.env.LUXART_ROOM_MAP_JSON,
    typeMap: process.env.LUXART_LESSON_TYPE_MAP_JSON,
    resourceMap: process.env.LUXART_RESOURCE_MAP_JSON,
    waitlistEnabled: process.env.LUXART_WAITLIST_ENABLED,
    watchdogVariant: process.env.LUXART_WATCHDOG_VARIANT,
    stripePaymentMethod: process.env.LUXART_STRIPE_PAYMENT_METHOD_ID,
    gatewayAuthMode: process.env.LUXART_API_AUTH_MODE,
    gatewayUsername: process.env.LUXART_API_BASIC_USERNAME,
    gatewayPassword: process.env.LUXART_API_BASIC_PASSWORD,
    allowInsecureHttp: process.env.LUXART_ALLOW_INSECURE_TEST_HTTP,
    deploymentTarget: process.env.ZONE4YOU_DEPLOYMENT_TARGET,
    publicAppEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
  };
  context.after(() => {
    const pairs = [
      ["LUXART_API_BASE_URL", previousEnvironment.baseUrl],
      ["LUXART_RESORT_ID", previousEnvironment.resortId],
      ["LUXART_TIMEOUT_MS", previousEnvironment.timeout],
      ["LUXART_ROOM_MAP_JSON", previousEnvironment.roomMap],
      ["LUXART_LESSON_TYPE_MAP_JSON", previousEnvironment.typeMap],
      ["LUXART_RESOURCE_MAP_JSON", previousEnvironment.resourceMap],
      ["LUXART_WAITLIST_ENABLED", previousEnvironment.waitlistEnabled],
      ["LUXART_WATCHDOG_VARIANT", previousEnvironment.watchdogVariant],
      ["LUXART_STRIPE_PAYMENT_METHOD_ID", previousEnvironment.stripePaymentMethod],
      ["LUXART_API_AUTH_MODE", previousEnvironment.gatewayAuthMode],
      ["LUXART_API_BASIC_USERNAME", previousEnvironment.gatewayUsername],
      ["LUXART_API_BASIC_PASSWORD", previousEnvironment.gatewayPassword],
      ["LUXART_ALLOW_INSECURE_TEST_HTTP", previousEnvironment.allowInsecureHttp],
      ["ZONE4YOU_DEPLOYMENT_TARGET", previousEnvironment.deploymentTarget],
      ["NEXT_PUBLIC_APP_ENV", previousEnvironment.publicAppEnvironment],
      ["VERCEL_ENV", previousEnvironment.vercelEnvironment],
    ] as const;
    for (const [name, value] of pairs) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  process.env.LUXART_API_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.LUXART_RESORT_ID = "1";
  process.env.LUXART_TIMEOUT_MS = "1000";
  process.env.LUXART_ROOM_MAP_JSON = JSON.stringify({ "2": "Sál 2" });
  process.env.LUXART_LESSON_TYPE_MAP_JSON = JSON.stringify({ "8": "Cardio" });
  process.env.LUXART_RESOURCE_MAP_JSON = JSON.stringify({ "2": "207" });
  process.env.LUXART_WAITLIST_ENABLED = "true";
  process.env.LUXART_WATCHDOG_VARIANT = "watchdog_III";
  process.env.LUXART_STRIPE_PAYMENT_METHOD_ID = "3";
  process.env.LUXART_API_AUTH_MODE = "basic";
  process.env.LUXART_API_BASIC_USERNAME = "gateway-user";
  process.env.LUXART_API_BASIC_PASSWORD = "gateway-password";
  process.env.LUXART_ALLOW_INSECURE_TEST_HTTP = "true";
  process.env.ZONE4YOU_DEPLOYMENT_TARGET = "staging";
  process.env.NEXT_PUBLIC_APP_ENV = "staging";
  delete process.env.VERCEL_ENV;

  const anonymousAdapter = createRealLuxartAdapter();
  const login = await anonymousAdapter.login({ login: "test@example.invalid", password: "1" });
  assert.equal(login.user.id, "42");
  assert.equal("sessionToken" in login, false);
  await assert.rejects(
    anonymousAdapter.login({ login: "invalid-user@example.invalid", password: "1" }),
    (error: unknown) => error instanceof BookingApiError &&
      error.status === 502 &&
      error.code === "LUXART_RESPONSE_INVALID",
  );
  await assert.rejects(
    anonymousAdapter.login({ login: "redirect@example.invalid", password: "1" }),
    /dočasně nedostupný/i,
  );
  assert.equal(redirectFollowed, false);

  const adapter = createRealLuxartAdapter({ userId: "42", locale: "en" });
  assert.equal((await adapter.getCurrentUser())?.creditBalanceKc, 1_400);
  const lessons = await adapter.getLessons({
    from: "2026-09-01T00:00:00Z",
    to: "2026-09-02T00:00:00Z",
    resortId: 1,
  });
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].roomName, "Sál 2");

  for (const endpoint of ["lessons", "reservations", "watchdog", "credit"] as const) {
    malformedRead = endpoint;
    const operation = endpoint === "lessons"
      ? adapter.getLessons({
          from: "2026-09-01T00:00:00Z",
          to: "2026-09-02T00:00:00Z",
          resortId: 1,
        })
      : endpoint === "reservations"
        ? adapter.getReservations()
        : endpoint === "watchdog"
          ? adapter.getWaitlist()
          : adapter.getCreditTransactions();
    await assert.rejects(
      operation,
      (error: unknown) => error instanceof BookingApiError &&
        error.status === 502 &&
        error.code === "LUXART_RESPONSE_INVALID",
    );
    malformedRead = undefined;
  }

  for (const now of ["2026-03-28T23:30:00.000Z", "2026-10-24T22:30:00.000Z"]) {
    const range = zone4YouScheduleRange(new Date(now), 7);
    await adapter.getLessons({ ...range, resortId: 1 });
    const query = capturedLessonQueries.at(-1);
    assert.equal(query?.get("date_start"), range.from.slice(0, 10));
    assert.equal(query?.get("pocet_dni_dopredu"), "7");
  }

  await assert.rejects(
    adapter.getLessons({
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-02T00:00:00Z",
      resortId: 999,
    }),
    /pouze pro Zone4You/i,
  );
  await assert.rejects(
    adapter.getLessons({
      from: "2026-09-03T00:00:00Z",
      to: "2026-09-04T00:00:00Z",
      resortId: 1,
    }),
    /mimo Zone4You resort/i,
  );
  await assert.rejects(
    adapter.getLessons({
      from: "2026-09-04T00:00:00Z",
      to: "2026-09-05T00:00:00Z",
      resortId: 1,
    }),
    (error: unknown) => error instanceof BookingApiError &&
      error.status === 502 &&
      error.code === "LUXART_RESPONSE_INVALID",
  );
  await assert.rejects(
    adapter.createReservation({ lessonId: lessons[0].id.replace("luxart:1:", "luxart:999:") }),
    /nepatří do Zone4You/i,
  );
  assert.equal((await adapter.getCreditTransactions())[0].balanceAfterKc, 1_400);
  assert.deepEqual(await adapter.getReservations(), []);

  malformedMutation = "reservation-create";
  await assert.rejects(
    adapter.createReservation({ lessonId: lessons[0].id }),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  malformedMutation = undefined;

  const created = await adapter.createReservation({ lessonId: lessons[0].id });
  assert.equal(created.id, "987");
  assert.equal(capturedReservationBody?.id_resource_1, 207);
  const lessonReadsBeforeCancellation = capturedLessonQueries.length;
  malformedMutation = "reservation-cancel";
  await assert.rejects(
    adapter.cancelReservation({ reservationId: created.id }),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  malformedMutation = undefined;
  const cancelled = await adapter.cancelReservation({ reservationId: created.id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(reservationCancelled, true);
  assert.equal(capturedLessonQueries.length, lessonReadsBeforeCancellation + 2);

  user.current_balance = 199;
  const lowCreditAdapter = createRealLuxartAdapter({ userId: "42", locale: "en" });
  const postsBeforeLowCreditAttempt = reservationPostCount;
  await assert.rejects(
    lowCreditAdapter.createReservation({ lessonId: lessons[0].id }),
    (error: unknown) => error instanceof BookingApiError && error.code === "INSUFFICIENT_CREDIT",
  );
  assert.equal(reservationPostCount, postsBeforeLowCreditAttempt);
  user.current_balance = 1_400;

  malformedMutation = "watchdog-create";
  await assert.rejects(
    adapter.joinWaitlist({ lessonId: lessons[0].id }),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  malformedMutation = undefined;
  const watched = await adapter.joinWaitlist({ lessonId: lessons[0].id });
  assert.equal(watched.id, "watchdog:777");
  assert.equal(capturedWatchdogBody?.id_resource_1, 207);
  assert.equal(capturedWatchdogBody?.language, "en");
  malformedMutation = "watchdog-delete";
  await assert.rejects(
    adapter.leaveWaitlist({ waitlistEntryId: watched.id }),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  malformedMutation = undefined;
  await adapter.leaveWaitlist({ waitlistEntryId: watched.id });
  assert.equal(watchdogDeleted, true);

  const topupInput = {
    amountKc: 500,
    provider: "stripe" as const,
    idempotencyKey: "evt_1",
    providerSessionId: "cs_test_zone4you",
    providerPaymentIntentId: "pi_zone4you",
  };
  malformedMutation = "payment";
  await assert.rejects(
    adapter.createTopup(topupInput),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  malformedMutation = undefined;
  const topup = await adapter.createTopup(topupInput);
  assert.equal(topup.id, "luxart-payment:901");
  assert.deepEqual(capturedPaymentBody?.uuid, ["KREDIT"]);
  assert.equal(capturedPaymentBody?.zpusob_uhrady, 3);
  assert.equal(capturedPaymentBody?.id_payment_shop, "cs_test_zone4you");

  delayReservationPost = true;
  process.env.LUXART_TIMEOUT_MS = "1000";
  const timeoutAdapter = createRealLuxartAdapter({ userId: "42", locale: "en" });
  await assert.rejects(
    timeoutAdapter.createReservation({ lessonId: lessons[0].id }),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
  await new Promise((resolve) => setTimeout(resolve, 1_200));
});

test("runtime adapter accepts only a clean HTTPS origin outside an explicit staging test", () => {
  const names = [
    "LUXART_API_BASE_URL",
    "LUXART_RESORT_ID",
    "LUXART_TIMEOUT_MS",
    "LUXART_API_AUTH_MODE",
    "LUXART_ALLOW_INSECURE_TEST_HTTP",
    "ZONE4YOU_DEPLOYMENT_TARGET",
    "NEXT_PUBLIC_APP_ENV",
    "VERCEL_ENV",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const restore = () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  try {
    process.env.LUXART_RESORT_ID = "1";
    process.env.LUXART_TIMEOUT_MS = "12000";
    process.env.LUXART_API_AUTH_MODE = "none";
    delete process.env.LUXART_ALLOW_INSECURE_TEST_HTTP;
    delete process.env.ZONE4YOU_DEPLOYMENT_TARGET;
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.VERCEL_ENV;

    for (const baseUrl of [
      "http://luxart.example.com:9191/",
      "https://luxart.example.com:9191/api/",
      "https://user:password@luxart.example.com:9191/",
      "https://luxart.example.com:9191/?target=other",
    ]) {
      process.env.LUXART_API_BASE_URL = baseUrl;
      assert.throws(() => createRealLuxartAdapter(), /clean HTTPS origin/i);
    }

    process.env.LUXART_API_BASE_URL = "https://luxart.example.com:9191/";
    assert.doesNotThrow(() => createRealLuxartAdapter());

    process.env.LUXART_API_BASE_URL = "http://127.0.0.1:9191/";
    process.env.LUXART_ALLOW_INSECURE_TEST_HTTP = "true";
    process.env.ZONE4YOU_DEPLOYMENT_TARGET = "staging";
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    assert.doesNotThrow(() => createRealLuxartAdapter());

    process.env.VERCEL_ENV = "production";
    assert.throws(() => createRealLuxartAdapter(), /clean HTTPS origin/i);

    process.env.LUXART_API_BASE_URL = "https://luxart.example.com:9191/";
    process.env.LUXART_TIMEOUT_MS = "0";
    assert.throws(() => createRealLuxartAdapter(), /1000 to 30000/i);
  } finally {
    restore();
  }
});

test("Luxart response reader bounds declared and streamed JSON without weakening mutation reconciliation", async () => {
  const declared = new Response("{}", {
    headers: { "content-length": String(maximumLuxartResponseBytes + 1) },
  });
  await assert.rejects(
    readLuxartJsonResponse(declared),
    (error: unknown) => error instanceof BookingApiError &&
      error.status === 502 &&
      error.code === "LUXART_RESPONSE_TOO_LARGE",
  );

  const streamed = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{\"value\":\""));
      controller.enqueue(new TextEncoder().encode("x".repeat(64)));
      controller.close();
    },
  }));
  await assert.rejects(
    readLuxartJsonResponse(streamed, false, 32),
    (error: unknown) => error instanceof BookingApiError &&
      error.code === "LUXART_RESPONSE_TOO_LARGE",
  );

  await assert.rejects(
    readLuxartJsonResponse(new Response("{"), true),
    (error: unknown) => error instanceof BookingMutationOutcomeUnknownError,
  );
});

test("fails closed before a reservation when credit, capacity or booking window is invalid", () => {
  const now = new Date("2026-08-30T10:00:00.000Z");
  const lesson: Lesson = {
    id: "lesson-1",
    name: "PUMPING",
    description: "Test lesson",
    startsAt: "2026-08-31T10:00:00.000Z",
    endsAt: "2026-08-31T11:00:00.000Z",
    durationMinutes: 60,
    instructorName: "Test Instructor",
    instructorSpecialization: "Strength",
    roomName: "Sál 1",
    category: "Síla",
    capacity: 10,
    occupiedCount: 9,
    priceKc: 180,
    waitlistEnabled: false,
  };
  const user: User = {
    id: "42",
    login: "test@example.invalid",
    fullName: "Test Client",
    email: "test@example.invalid",
    creditBalanceKc: 200,
  };

  assert.doesNotThrow(() => assertReservationPreconditions(lesson, user, now));

  const rejectsWithCode = (candidateLesson: Lesson, candidateUser: User, code: string) => {
    assert.throws(
      () => assertReservationPreconditions(candidateLesson, candidateUser, now),
      (error: unknown) => error instanceof BookingApiError && error.code === code,
    );
  };

  rejectsWithCode(lesson, { ...user, creditBalanceKc: 199 }, "INSUFFICIENT_CREDIT");
  rejectsWithCode({ ...lesson, occupiedCount: 10 }, user, "LESSON_FULL");
  rejectsWithCode({ ...lesson, capacity: 0, occupiedCount: 0 }, user, "LESSON_FULL");
  rejectsWithCode({ ...lesson, startsAt: "2026-09-01T11:00:00.000Z" }, user, "RESERVATION_NOT_OPEN");
  rejectsWithCode({ ...lesson, startsAt: "2026-08-30T09:59:59.000Z" }, user, "RESERVATION_CLOSED");
});
