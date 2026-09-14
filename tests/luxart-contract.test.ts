import assert from "node:assert/strict";
import test from "node:test";
import {
  mapLuxartCreditHistory,
  buildLuxartCreditPaymentInsert,
  buildLuxartReservationInsert,
  buildLuxartWatchdogInsert,
  mapLuxartLesson,
  mapLuxartReservation,
  mapLuxartUser,
  mapLuxartWatchdog,
  mapLuxartCreditPayment,
  luxartLessonOccurrenceId,
  parseLuxartLessonId,
  parseLuxartWatchdogId,
  type LuxartLessonData,
} from "../src/lib/luxartContract";
import { maximumOperationalAmountKc } from "../src/lib/moneyBounds";

const baseLesson: LuxartLessonData = {
  resort: 1,
  kategorie: 12,
  date_time: "2026-09-01T16:30:00+02:00",
  id_staff: 44,
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

test("maps every Luxart lesson occurrence without a fixed room union", () => {
  const lesson = mapLuxartLesson(baseLesson, {
    roomNames: { "2": "Cycling sál" },
    lessonTypeNames: { "8": "Cardio" },
  });

  assert.equal(lesson.roomName, "Cycling sál");
  assert.equal(lesson.category, "Cardio");
  assert.equal(lesson.capacity, 14);
  assert.equal(lesson.occupiedCount, 9);
  assert.equal(lesson.availableCount, 5);
  assert.equal(lesson.serviceId, "321");
  assert.equal(lesson.luxartCategoryId, 12);
  assert.equal(lesson.endsAt, "2026-09-01T15:20:00.000Z");
  assert.match(lesson.id, /^luxart:1:12:321:/);

  const documentedFractionalTimestamp = mapLuxartLesson({
    ...baseLesson,
    date_time: "2026-09-11T15:20:08.9258227Z",
  });
  assert.equal(documentedFractionalTimestamp.startsAt, "2026-09-11T15:20:08.925Z");
});

test("maps Luxart personalized lesson eligibility only from binary user_posible values", () => {
  assert.equal(mapLuxartLesson({ ...baseLesson, user_posible: 1 }).canCurrentUserReserve, true);
  assert.equal(mapLuxartLesson({ ...baseLesson, user_posible: 0 }).canCurrentUserReserve, false);
  assert.equal(mapLuxartLesson({ ...baseLesson, user_posible: null }).canCurrentUserReserve, undefined);
  assert.throws(
    () => mapLuxartLesson({ ...baseLesson, user_posible: 2 }),
    /user_posible.*binary/i,
  );
});

test("Luxart lesson occurrence IDs accept only canonical positive safe integers", () => {
  const startsAt = "2026-09-01T16:30:00+02:00";
  assert.equal(parseLuxartLessonId(`luxart:1:12:321:${startsAt}`)?.serviceId, 321);
  for (const lessonId of [
    `luxart:01:12:321:${startsAt}`,
    `luxart:1:0:321:${startsAt}`,
    `luxart:1:12:9007199254740992:${startsAt}`,
  ]) {
    assert.equal(parseLuxartLessonId(lessonId), null);
  }
  assert.throws(
    () => luxartLessonOccurrenceId({ resort: 1, categoryId: 12, serviceId: Number.MAX_SAFE_INTEGER + 1, startsAt }),
    /invalid identifiers/i,
  );
});

test("keeps unknown rooms and lesson types visible with safe fallbacks", () => {
  const lesson = mapLuxartLesson({
    ...baseLesson,
    cislo_salu: 9,
    typ_lekce: 999,
    nazev: "Nová lekce",
  });

  assert.equal(lesson.roomName, "Sál 9");
  assert.equal(lesson.category, "Ostatní");
});

test("bounds Luxart lesson text without rejecting ordinary multiline descriptions", () => {
  assert.equal(
    mapLuxartLesson({ ...baseLesson, popis: "První řádek\nDruhý řádek" }).description,
    "První řádek\nDruhý řádek",
  );
  for (const invalid of [
    { nazev: "x".repeat(201) },
    { popis: "x".repeat(8_001) },
    { osloveni: "Instruktor\nPodvržený řádek" },
    { pohlavi: "x".repeat(33) },
    { nazev: 42 as unknown as string },
  ]) {
    assert.throws(() => mapLuxartLesson({ ...baseLesson, ...invalid }), /Luxart text field/i);
  }
});

test("rejects malformed required Luxart lesson values instead of coercing them to zero", () => {
  for (const invalid of [
    { resort: 0 },
    { resort: Number.MAX_SAFE_INTEGER + 1 },
    { id_service: 0 },
    { id_service: Number.MAX_SAFE_INTEGER + 1 },
    { kategorie: 0 },
    { delka: 0 },
    { cena: Number.NaN },
    { cena: -1 },
    { cena: maximumOperationalAmountKc + 1 },
    { kapacita: -1 },
    { kapacita: Number.MAX_SAFE_INTEGER + 1 },
    { obsazeno: -1 },
    { obsazeno: 15 },
    { volno: -1 },
    { volno: 6 },
    { cislo_salu: -1 },
    { cislo_salu: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(
      () => mapLuxartLesson({ ...baseLesson, ...invalid }),
      /invalid required numeric fields/i,
    );
  }
  for (const date_time of [
    "2026-09-01T16:30:00",
    "2026-02-30T16:30:00+01:00",
    "2026-09-01T16:30:00+14:30",
  ]) {
    assert.throws(
      () => mapLuxartLesson({ ...baseLesson, date_time }),
      /invalid date_time/i,
    );
  }
});

test("maps Luxart user credit without exposing password data", () => {
  const user = mapLuxartUser({
    user_id: 42,
    login: "test@example.invalid",
    email: "test@example.invalid",
    name: "Test",
    surname: "Klient",
    current_balance: 1250,
  });

  assert.equal(user.id, "42");
  assert.equal(user.fullName, "Test Klient");
  assert.equal(user.creditBalanceKc, 1250);
});

test("maps the member card from both documented Luxart user response variants", () => {
  const loginUser = mapLuxartUser({
    user_id: 42,
    current_balance: 0,
    member_card: "LOGIN-CARD",
  });
  const refreshedUser = mapLuxartUser({
    user_id: 42,
    current_balance: 0,
    member_card: "LEGACY-CARD",
    member_card_number: "CURRENT-CARD",
  });

  assert.equal(loginUser.memberCardNumber, "LOGIN-CARD");
  assert.equal(refreshedUser.memberCardNumber, "CURRENT-CARD");
});

test("rejects a Luxart user without a valid positive ID and finite credit", () => {
  assert.throws(
    () => mapLuxartUser({ user_id: 0, current_balance: 500 }),
    /invalid required fields/i,
  );
  assert.throws(
    () => mapLuxartUser({ user_id: 42 }),
    /invalid required fields/i,
  );
  assert.throws(
    () => mapLuxartUser({ user_id: 42, current_balance: Number.NaN }),
    /invalid required fields/i,
  );
  assert.throws(
    () => mapLuxartUser({ user_id: 42, current_balance: maximumOperationalAmountKc + 1 }),
    /invalid required fields/i,
  );
  assert.throws(
    () => mapLuxartUser({ user_id: Number.MAX_SAFE_INTEGER + 1, current_balance: 500 }),
    /invalid required fields/i,
  );
  for (const invalid of [
    { email: "x".repeat(255) },
    { name: "Test\nPodvržený řádek" },
    { membership: 42 as unknown as string },
  ]) {
    assert.throws(
      () => mapLuxartUser({ user_id: 42, current_balance: 500, ...invalid }),
      /Luxart text field/i,
    );
  }
});

test("maps an active reservation back to the same Luxart lesson occurrence", () => {
  const source = {
    resort: 1,
    id_rezervace: 987,
    id_kategorie: 12,
    datum: "2026-09-01T16:30:00+02:00",
    id_service: 321,
    delka: 50,
    id_resource: 2,
    price: 180,
    status: 1,
    uuid: "test-uuid",
  };
  const reservation = mapLuxartReservation(source, "42", 1);

  assert.equal(reservation.id, "987");
  assert.equal(reservation.lessonId, "luxart:1:12:321:2026-09-01T14:30:00.000Z");
  assert.equal(reservation.luxartUuid, "test-uuid");

  for (const invalid of [
    { resort: 0 },
    { id_rezervace: 0 },
    { id_kategorie: 0 },
    { id_service: 0 },
    { delka: 0 },
    { id_resource: 0 },
    { price: Number.NaN },
    { price: -1 },
    { price: maximumOperationalAmountKc + 1 },
    { status: Number.NaN },
    { datum: "invalid" },
    { datum: "2026-09-01T16:30:00" },
    { datum: "2026-02-30T16:30:00+01:00" },
  ]) {
    assert.throws(
      () => mapLuxartReservation({ ...source, ...invalid }, "42", 1),
      /invalid/i,
    );
  }
  assert.throws(() => mapLuxartReservation(source, "invalid-user", 1), /invalid/i);
  assert.throws(() => mapLuxartReservation({ ...source, resort: 2 }, "42", 1), /invalid/i);
  assert.throws(
    () => mapLuxartReservation({ ...source, uuid: "x".repeat(257) }, "42", 1),
    /Luxart text field/i,
  );
});

test("derives running credit balances from newest Luxart history entry", () => {
  const transactions = mapLuxartCreditHistory(
    [
      {
        resort: 1,
        datum: "2026-08-29T08:00:00Z",
        castka: 500,
        cdd: 10,
        text: "Dobití kreditu",
        sportoviste: 1010,
      },
      {
        resort: 1,
        datum: "2026-08-28T08:00:00Z",
        castka: -100,
        cdd: 9,
        text: "Rezervace lekce",
        sportoviste: 1,
      },
    ],
    "42",
    1_400,
  );

  assert.equal(transactions[0].type, "topup");
  assert.equal(transactions[0].balanceAfterKc, 1_400);
  assert.equal(transactions[1].type, "reservation_charge");
  assert.equal(transactions[1].balanceAfterKc, 900);

  const validEntry = {
    resort: 1,
    datum: "2026-08-29T08:00:00Z",
    castka: 500,
    cdd: 10,
    text: "Dobití kreditu",
    sportoviste: 1010,
  };
  for (const invalid of [
    { resort: 0 },
    { datum: "invalid" },
    { datum: "2026-08-29T08:00:00" },
    { datum: "2026-02-30T08:00:00Z" },
    { castka: Number.NaN },
    { castka: maximumOperationalAmountKc + 1 },
    { cdd: 0 },
  ]) {
    assert.throws(
      () => mapLuxartCreditHistory([{ ...validEntry, ...invalid }], "42", 1_400, 1),
      /invalid/i,
    );
  }
  assert.throws(() => mapLuxartCreditHistory([validEntry], "invalid-user", 1_400, 1), /invalid/i);
  assert.throws(() => mapLuxartCreditHistory([validEntry], "42", Number.NaN, 1), /invalid/i);
  assert.throws(
    () => mapLuxartCreditHistory([validEntry], "42", maximumOperationalAmountKc + 1, 1),
    /invalid/i,
  );
  assert.throws(
    () => mapLuxartCreditHistory(
      [{ ...validEntry, castka: -maximumOperationalAmountKc }],
      "42",
      maximumOperationalAmountKc,
      1,
    ),
    /invalid balance/i,
  );
  assert.throws(
    () => mapLuxartCreditHistory([validEntry, { ...validEntry }], "42", 1_400, 1),
    /duplicate/i,
  );
  assert.equal(
    mapLuxartCreditHistory(
      [validEntry, { ...validEntry, datum: "2026-08-28T08:00:00Z" }],
      "42",
      1_400,
      1,
    ).length,
    2,
  );
  assert.throws(
    () => mapLuxartCreditHistory([{ ...validEntry, resort: 2 }], "42", 1_400, 1),
    /invalid/i,
  );
  assert.throws(
    () => mapLuxartCreditHistory([{ ...validEntry, text: "x".repeat(1_001) }], "42", 1_400, 1),
    /Luxart text field/i,
  );
});

test("builds the documented reservation payload only with an explicit resource mapping", () => {
  const lesson = mapLuxartLesson(baseLesson);
  const payload = buildLuxartReservationInsert(lesson, "42", 207);

  assert.equal(payload.resort, 1);
  assert.equal(payload.id_kategorie, 12);
  assert.equal(payload.user_id, 42);
  assert.equal(payload.id_service_1, 321);
  assert.equal(payload.id_resource_1, 207);
  assert.equal(payload.zpusob_uhrady, 0);
  assert.throws(() => buildLuxartReservationInsert(lesson, "42", 0), /resource mapping/i);
  assert.throws(
    () => buildLuxartReservationInsert({ ...lesson, serviceId: "322" }, "42", 207),
    /inconsistent/i,
  );
  assert.throws(
    () => buildLuxartReservationInsert({ ...lesson, startsAt: "2026-09-01T17:30:00+02:00" }, "42", 207),
    /inconsistent/i,
  );
  assert.throws(() => buildLuxartReservationInsert(lesson, "042", 207), /inconsistent/i);
});

test("maps the documented Luxart watchdog as a seat alert without inventing a queue position", () => {
  const lesson = mapLuxartLesson(baseLesson);
  const payload = buildLuxartWatchdogInsert(lesson, "42", 207, "en");
  assert.equal(payload.id_kategorie, 12);
  assert.equal(payload.id_service_1, 321);
  assert.equal(payload.id_resource_1, 207);
  assert.equal(payload.language, "en");
  assert.equal(payload.id_watchdog, 0);

  const entry = mapLuxartWatchdog(
    {
      ...payload,
      id_watchdog: 777,
    },
    "42",
    [lesson],
  );
  assert.equal(entry?.id, "watchdog:777");
  assert.equal(entry?.lessonId, lesson.id);
  assert.equal(entry?.position, 0);
  assert.equal(parseLuxartWatchdogId("watchdog:777"), 777);
  assert.equal(parseLuxartWatchdogId("wl-777"), null);
  assert.equal(parseLuxartWatchdogId("watchdog:0777"), null);
  assert.equal(parseLuxartWatchdogId("watchdog:9007199254740992"), null);
  assert.throws(() => buildLuxartWatchdogInsert(lesson, "42", 0, "cz"), /resource mapping/i);
  assert.throws(
    () => buildLuxartWatchdogInsert({ ...lesson, luxartCategoryId: 13 }, "42", 207, "cz"),
    /inconsistent/i,
  );
  for (const invalid of [
    { resort: 0 },
    { id_kategorie: 0 },
    { user_id: 999 },
    { datum: "invalid" },
    { datum: "2026-09-01T16:30:00" },
    { datum: "2026-02-30T16:30:00+01:00" },
    { id_service_1: 0 },
    { delka_1: 0 },
    { id_resource_1: 0 },
    { id_watchdog: 0 },
  ]) {
    assert.throws(
      () => mapLuxartWatchdog({ ...payload, id_watchdog: 777, ...invalid }, "42", [lesson], 1),
      /invalid/i,
    );
  }
  assert.throws(
    () => mapLuxartWatchdog({ ...payload, id_watchdog: 777, resort: 2 }, "42", [lesson], 1),
    /invalid/i,
  );
});

test("maps a verified Stripe top-up to the documented Luxart credit payment payload", () => {
  const input = {
    amountKc: 500,
    provider: "stripe" as const,
    idempotencyKey: "evt_1",
    providerSessionId: "cs_test_zone4you",
    providerPaymentIntentId: "pi_zone4you",
  };
  const payload = buildLuxartCreditPaymentInsert(input, "42", 3);
  assert.deepEqual(payload, {
    uuid: ["KREDIT"],
    user_id: 42,
    amount: 500,
    id_payment_shop: "cs_test_zone4you",
    id_payment_pp_1: "pi_zone4you",
    id_payment_pp_2: "evt_1",
    zpusob_uhrady: 3,
    zpusob_odeslani: 0,
  });
  const topup = mapLuxartCreditPayment({ success: 1, id_mp: 901 }, input, "42");
  assert.equal(topup.id, "luxart-payment:901");
  assert.equal(topup.status, "succeeded");
  assert.throws(() => mapLuxartCreditPayment({ success: 1, id_mp: 0 }, input, "42"), /missing id_mp/i);
  assert.throws(
    () => mapLuxartCreditPayment({ success: 1, id_mp: Number.NaN }, input, "42"),
    /missing id_mp/i,
  );
  assert.throws(() => buildLuxartCreditPaymentInsert(input, "42", 0), /payment method mapping/i);
});
