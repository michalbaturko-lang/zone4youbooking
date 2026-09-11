import type {
  CreateTopupInput,
  CreditTransaction,
  CreditTransactionType,
  Lesson,
  PaymentTopup,
  Reservation,
  User,
  WaitlistEntry,
} from "./domain";

export interface LuxartUserData {
  user_id: number;
  login?: string | null;
  email?: string | null;
  name?: string | null;
  surname?: string | null;
  current_balance?: number | null;
  membership?: string | null;
  member_card?: string | null;
  member_card_number?: string | null;
  phone?: string | null;
}

export interface LuxartLessonData {
  resort: number;
  kategorie: number;
  date_time: string;
  id_staff: number;
  pohlavi?: string | null;
  osloveni?: string | null;
  id_service: number;
  delka: number;
  cena: number;
  nazev?: string | null;
  popis?: string | null;
  kapacita: number;
  obsazeno: number;
  volno: number;
  cislo_salu: number;
  id_staff_original?: number | null;
  id_barva?: number | null;
  varianta_lekce?: number | null;
  typ_lekce?: number | null;
  kapacita_members?: number | null;
  kapacita_nonmembers?: number | null;
  volno_members?: number | null;
  volno_nonmembers?: number | null;
  user_posible?: number | null;
  povolena_clenstvi?: string | null;
  id_souhlasu?: number | null;
}

export interface LuxartLessonMapping {
  roomNames?: Record<string, string>;
  lessonTypeNames?: Record<string, string>;
}

export interface LuxartReservationData {
  resort: number;
  id_rezervace: number;
  id_kategorie: number;
  datum: string;
  id_service: number;
  delka: number;
  id_resource: number;
  price: number;
  status: number;
  datum_expirace?: string | null;
  poznamka?: string | null;
  zpusob_uhrady?: number | null;
  uuid?: string | null;
}

export interface LuxartPaymentHistory {
  resort: number;
  datum: string;
  castka: number;
  cdd: number;
  text?: string | null;
  uhrada?: string | null;
  typ_uhrady?: number | null;
  sportoviste?: number | null;
}

export interface LuxartReservationInsertData {
  resort: number;
  id_kategorie: number;
  user_id: number;
  datum: string;
  id_service_1: number;
  delka_1: number;
  id_resource_1: number;
  pohlavi_1: string;
  id_service_2: number;
  delka_2: number;
  id_resource_2: number;
  pohlavi_2: string;
  poznamka: string;
  zpusob_uhrady: number;
  name: string;
  surname: string;
  email: string;
  phone: string;
  language: string;
}

export interface LuxartReservationInsertResult {
  success: number;
  messaget?: string | null;
  uuid?: string | null;
}

export interface LuxartReservationDeleteResult {
  success: number;
  messaget?: string | null;
  storno_poplatek?: number | null;
}

export interface LuxartWatchdogData {
  resort: number;
  id_kategorie: number;
  user_id: number;
  datum: string;
  id_service_1: number;
  delka_1: number;
  poznamka?: string | null;
  id_resource_1: number;
  pohlavi_1?: string | null;
  id_watchdog: number;
  name?: string | null;
  surname?: string | null;
  email?: string | null;
  phone?: string | null;
  language?: string | null;
}

export type LuxartWatchdogInsertData = LuxartWatchdogData;

export interface LuxartWatchdogResult {
  success: number;
  messaget?: string | null;
  uuid?: string | null;
}

export interface LuxartPaymentInsertData {
  uuid: string[];
  user_id: number;
  amount: number;
  id_payment_shop: string;
  id_payment_pp_1: string;
  id_payment_pp_2: string;
  zpusob_uhrady: number;
  zpusob_odeslani: 0;
}

export interface LuxartPaymentResult {
  success: number;
  messaget?: string | null;
  id_mp: number;
}

function text(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function inferredLessonType(name: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalized.includes("REFORMER")) return "Reformer";
  if (/JOGA|YOGA|PILATES|STRETCH/.test(normalized)) return "Body & Mind";
  if (/SPIN|HEAT|HIIT|TABATA|CARDIO/.test(normalized)) return "Cardio";
  if (/PUMP|BODY|KRUH|CORE|FUNKCNI/.test(normalized)) return "Síla";
  if (/ZADA|ZDRAV|FYZIO|SENIOR/.test(normalized)) return "Zdraví";
  return "Ostatní";
}

export function luxartLessonOccurrenceId(input: {
  resort: number;
  categoryId: number;
  serviceId: number;
  startsAt: string;
}) {
  return [input.resort, input.categoryId, input.serviceId, new Date(input.startsAt).toISOString()].join(":");
}

export function parseLuxartLessonId(lessonId: string) {
  const match = /^luxart:(\d+):(\d+):(\d+):(.+)$/.exec(lessonId);
  if (!match) return null;
  const startsAt = new Date(match[4]);
  if (Number.isNaN(startsAt.getTime())) return null;
  return {
    resort: Number(match[1]),
    categoryId: Number(match[2]),
    serviceId: Number(match[3]),
    startsAt: startsAt.toISOString(),
  };
}

export function mapLuxartUser(data: LuxartUserData): User {
  const userId = requiredNumber(data?.user_id);
  const creditBalanceKc = requiredNumber(data?.current_balance);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(creditBalanceKc)) {
    throw new Error("Luxart user contains invalid required fields.");
  }

  const firstName = text(data.name, "");
  const surname = text(data.surname, "");
  const fullName = `${firstName} ${surname}`.trim() || text(data.login, "Klient Zone4You");

  return {
    id: String(userId),
    login: text(data.login, text(data.email, "")),
    fullName,
    email: text(data.email, ""),
    phone: text(data.phone, "") || undefined,
    memberCardNumber: text(data.member_card_number, text(data.member_card, "")) || undefined,
    membership: text(data.membership, "") || undefined,
    creditBalanceKc,
  };
}

export function mapLuxartLesson(data: LuxartLessonData, mapping: LuxartLessonMapping = {}): Lesson {
  const resort = requiredNumber(data?.resort);
  const categoryId = requiredNumber(data?.kategorie);
  const serviceId = requiredNumber(data?.id_service);
  const durationMinutes = requiredNumber(data?.delka);
  const priceKc = requiredNumber(data?.cena);
  const capacity = requiredNumber(data?.kapacita);
  const occupiedCount = requiredNumber(data?.obsazeno);
  const roomNumber = requiredNumber(data?.cislo_salu);
  if (
    !Number.isInteger(resort) || resort <= 0 ||
    !Number.isInteger(categoryId) || categoryId <= 0 ||
    !Number.isInteger(serviceId) || serviceId <= 0 ||
    !Number.isInteger(durationMinutes) || durationMinutes <= 0 ||
    !Number.isFinite(priceKc) || priceKc < 0 ||
    !Number.isInteger(capacity) || capacity < 0 ||
    !Number.isInteger(occupiedCount) || occupiedCount < 0 ||
    !Number.isInteger(roomNumber) || roomNumber < 0
  ) {
    throw new Error("Luxart lesson contains invalid required numeric fields.");
  }

  const startsAtValue = typeof data?.date_time === "string" ? data.date_time.trim() : "";
  const startsAtDate = new Date(startsAtValue);
  if (Number.isNaN(startsAtDate.getTime())) {
    throw new Error("Luxart lesson contains an invalid date_time value.");
  }

  const startsAt = startsAtDate.toISOString();
  const endsAt = new Date(startsAtDate.getTime() + durationMinutes * 60_000).toISOString();
  const name = text(data.nazev, `Lekce ${serviceId}`);
  const roomFromConfig = mapping.roomNames?.[String(roomNumber)];
  const roomName =
    roomFromConfig ??
    (name.toUpperCase().includes("REFORMER")
      ? "Reformer"
      : roomNumber > 0
        ? `Sál ${roomNumber}`
        : "Sál neuveden");
  const category =
    mapping.lessonTypeNames?.[String(data.typ_lekce ?? "")] ?? inferredLessonType(name);
  const occurrenceId = luxartLessonOccurrenceId({
    resort,
    categoryId,
    serviceId,
    startsAt,
  });

  return {
    id: `luxart:${occurrenceId}`,
    luxartLessonId: occurrenceId,
    serviceId: String(serviceId),
    luxartCategoryId: categoryId,
    luxartRoomNumber: roomNumber,
    luxartGender: text(data.pohlavi, "") || undefined,
    name,
    description: text(data.popis, ""),
    startsAt,
    endsAt,
    durationMinutes,
    instructorName: text(data.osloveni, "Instruktor Zone4You"),
    instructorSpecialization: "Instruktor lekce",
    roomName,
    category,
    capacity,
    occupiedCount,
    priceKc,
    waitlistEnabled: true,
  };
}

export function buildLuxartReservationInsert(
  lesson: Lesson,
  userId: string,
  resourceId: number,
): LuxartReservationInsertData {
  const categoryId = lesson.luxartCategoryId;
  const serviceId = Number(lesson.serviceId);
  const numericUserId = Number(userId);
  if (
    typeof categoryId !== "number" ||
    !Number.isInteger(categoryId) ||
    !Number.isInteger(serviceId) ||
    !Number.isInteger(numericUserId)
  ) {
    throw new Error("Luxart reservation identifiers are incomplete.");
  }
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new Error("Luxart resource mapping is missing for this lesson room.");
  }

  return {
    resort: parseLuxartLessonId(lesson.id)?.resort ?? 1,
    id_kategorie: categoryId,
    user_id: numericUserId,
    datum: lesson.startsAt,
    id_service_1: serviceId,
    delka_1: lesson.durationMinutes,
    id_resource_1: resourceId,
    pohlavi_1: lesson.luxartGender ?? "",
    id_service_2: 0,
    delka_2: 0,
    id_resource_2: 0,
    pohlavi_2: "",
    poznamka: "",
    zpusob_uhrady: 0,
    name: "",
    surname: "",
    email: "",
    phone: "",
    language: "cz",
  };
}

export function buildLuxartWatchdogInsert(
  lesson: Lesson,
  userId: string,
  resourceId: number,
  language: "cz" | "en",
): LuxartWatchdogInsertData {
  const categoryId = lesson.luxartCategoryId;
  const serviceId = Number(lesson.serviceId);
  const numericUserId = Number(userId);
  if (
    typeof categoryId !== "number" ||
    !Number.isInteger(categoryId) ||
    !Number.isInteger(serviceId) ||
    !Number.isInteger(numericUserId)
  ) {
    throw new Error("Luxart watchdog identifiers are incomplete.");
  }
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new Error("Luxart resource mapping is missing for this lesson room.");
  }

  return {
    resort: parseLuxartLessonId(lesson.id)?.resort ?? 1,
    id_kategorie: categoryId,
    user_id: numericUserId,
    datum: lesson.startsAt,
    id_service_1: serviceId,
    delka_1: lesson.durationMinutes,
    poznamka: "",
    id_resource_1: resourceId,
    pohlavi_1: lesson.luxartGender ?? "",
    id_watchdog: 0,
    name: "",
    surname: "",
    email: "",
    phone: "",
    language,
  };
}

export function mapLuxartWatchdog(
  data: LuxartWatchdogData,
  userId: string,
  lessons: Lesson[],
  expectedResort?: number,
): WaitlistEntry | null {
  const resort = requiredNumber(data?.resort);
  const categoryId = requiredNumber(data?.id_kategorie);
  const responseUserId = requiredNumber(data?.user_id);
  const expectedUserId = requiredNumber(userId);
  const serviceId = requiredNumber(data?.id_service_1);
  const durationMinutes = requiredNumber(data?.delka_1);
  const resourceId = requiredNumber(data?.id_resource_1);
  const watchdogId = requiredNumber(data?.id_watchdog);
  const startsAtValue = typeof data?.datum === "string" ? data.datum.trim() : "";
  const startsAt = new Date(startsAtValue);
  if (
    !Number.isSafeInteger(resort) || resort <= 0 ||
    (expectedResort !== undefined && resort !== expectedResort) ||
    !Number.isSafeInteger(categoryId) || categoryId <= 0 ||
    !Number.isSafeInteger(responseUserId) || responseUserId <= 0 ||
    !Number.isSafeInteger(expectedUserId) || expectedUserId <= 0 ||
    responseUserId !== expectedUserId ||
    !Number.isSafeInteger(serviceId) || serviceId <= 0 ||
    !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 ||
    !Number.isSafeInteger(resourceId) || resourceId <= 0 ||
    !Number.isSafeInteger(watchdogId) || watchdogId <= 0 ||
    Number.isNaN(startsAt.getTime())
  ) {
    throw new Error("Luxart watchdog contains invalid required fields.");
  }
  const lesson = lessons.find((candidate) => {
    const candidateStart = new Date(candidate.startsAt).getTime();
    return (
      candidate.serviceId === String(serviceId) &&
      candidate.luxartCategoryId === categoryId &&
      Math.abs(candidateStart - startsAt.getTime()) < 60_000
    );
  });
  if (!lesson) return null;

  return {
    id: `watchdog:${watchdogId}`,
    userId,
    lessonId: lesson.id,
    position: 0,
    status: "waiting",
  };
}

export function parseLuxartWatchdogId(id: string) {
  const match = /^watchdog:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export function buildLuxartCreditPaymentInsert(
  input: CreateTopupInput,
  userId: string,
  paymentMethodId: number,
): LuxartPaymentInsertData {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new Error("Luxart payment user identifier is invalid.");
  }
  if (!Number.isSafeInteger(input.amountKc) || input.amountKc <= 0) {
    throw new Error("Luxart payment amount is invalid.");
  }
  if (!Number.isInteger(paymentMethodId) || paymentMethodId <= 0) {
    throw new Error("Luxart Stripe payment method mapping is missing.");
  }
  if (!input.providerSessionId || !input.providerPaymentIntentId || !input.idempotencyKey) {
    throw new Error("Verified Stripe payment identifiers are required for Luxart credit.");
  }

  return {
    uuid: ["KREDIT"],
    user_id: numericUserId,
    amount: input.amountKc,
    id_payment_shop: input.providerSessionId,
    id_payment_pp_1: input.providerPaymentIntentId,
    id_payment_pp_2: input.idempotencyKey,
    zpusob_uhrady: paymentMethodId,
    zpusob_odeslani: 0,
  };
}

export function mapLuxartCreditPayment(
  result: LuxartPaymentResult,
  input: CreateTopupInput,
  userId: string,
): PaymentTopup {
  const paymentId = requiredNumber(result?.id_mp);
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
    throw new Error("Luxart payment response is missing id_mp.");
  }
  const now = new Date().toISOString();
  return {
    id: `luxart-payment:${paymentId}`,
    userId,
    amountKc: input.amountKc,
    currency: "CZK",
    provider: "stripe",
    idempotencyKey: input.idempotencyKey,
    providerSessionId: input.providerSessionId,
    providerPaymentIntentId: input.providerPaymentIntentId,
    status: "succeeded",
    createdAt: now,
    paidAt: now,
  };
}

export function mapLuxartReservation(
  data: LuxartReservationData,
  userId: string,
  expectedResort?: number,
): Reservation {
  const resort = requiredNumber(data?.resort);
  const reservationId = requiredNumber(data?.id_rezervace);
  const categoryId = requiredNumber(data?.id_kategorie);
  const serviceId = requiredNumber(data?.id_service);
  const durationMinutes = requiredNumber(data?.delka);
  const resourceId = requiredNumber(data?.id_resource);
  const priceKc = requiredNumber(data?.price);
  const status = requiredNumber(data?.status);
  const numericUserId = requiredNumber(userId);
  if (
    !Number.isSafeInteger(resort) || resort <= 0 ||
    (expectedResort !== undefined && resort !== expectedResort) ||
    !Number.isSafeInteger(reservationId) || reservationId <= 0 ||
    !Number.isSafeInteger(categoryId) || categoryId <= 0 ||
    !Number.isSafeInteger(serviceId) || serviceId <= 0 ||
    !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 ||
    !Number.isSafeInteger(resourceId) || resourceId <= 0 ||
    !Number.isFinite(priceKc) || priceKc < 0 ||
    !Number.isSafeInteger(status) ||
    !Number.isSafeInteger(numericUserId) || numericUserId <= 0
  ) {
    throw new Error("Luxart reservation contains invalid required fields.");
  }

  const startsAtValue = typeof data?.datum === "string" ? data.datum.trim() : "";
  const startsAt = new Date(startsAtValue);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Luxart reservation contains an invalid datum value.");
  }

  const occurrenceId = luxartLessonOccurrenceId({
    resort,
    categoryId,
    serviceId,
    startsAt: startsAt.toISOString(),
  });

  return {
    id: String(reservationId),
    userId,
    lessonId: `luxart:${occurrenceId}`,
    status: "active",
    reservedAt: startsAt.toISOString(),
    priceKc,
    luxartUuid: text(data.uuid, "") || undefined,
    luxartCategoryId: categoryId,
  };
}

function creditTransactionType(entry: LuxartPaymentHistory): CreditTransactionType {
  const description = text(entry.text, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (number(entry.sportoviste) === 1010 || description.includes("dobiti") || description.includes("kredit")) {
    return "topup";
  }
  if (description.includes("storno")) return "reservation_refund";
  return number(entry.castka) >= 0 ? "topup" : "reservation_charge";
}

export function mapLuxartCreditHistory(
  entries: LuxartPaymentHistory[],
  userId: string,
  currentBalanceKc: number,
  expectedResort?: number,
): CreditTransaction[] {
  const numericUserId = requiredNumber(userId);
  if (
    !Array.isArray(entries) ||
    !Number.isSafeInteger(numericUserId) || numericUserId <= 0 ||
    !Number.isFinite(currentBalanceKc)
  ) {
    throw new Error("Luxart credit history context is invalid.");
  }

  const normalized = entries.map((entry) => {
    const resort = requiredNumber(entry?.resort);
    const amountKc = requiredNumber(entry?.castka);
    const historyId = requiredNumber(entry?.cdd);
    const occurredAtValue = typeof entry?.datum === "string" ? entry.datum.trim() : "";
    const occurredAtDate = new Date(occurredAtValue);
    if (
      !Number.isSafeInteger(resort) || resort <= 0 ||
      (expectedResort !== undefined && resort !== expectedResort) ||
      !Number.isFinite(amountKc) ||
      !Number.isSafeInteger(historyId) || historyId <= 0 ||
      Number.isNaN(occurredAtDate.getTime())
    ) {
      throw new Error("Luxart credit history contains invalid required fields.");
    }
    return {
      entry,
      amountKc,
      historyId,
      occurredAt: occurredAtDate.toISOString(),
    };
  });

  const historyIds = new Set<string>();
  for (const item of normalized) {
    const transactionId = `${item.historyId}:${item.occurredAt}`;
    if (historyIds.has(transactionId)) {
      throw new Error("Luxart credit history contains duplicate identifiers.");
    }
    historyIds.add(transactionId);
  }

  let balance = currentBalanceKc;
  return normalized
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
    .map(({ entry, amountKc, historyId, occurredAt }) => {
      const transaction: CreditTransaction = {
        id: `luxart-credit:${historyId}:${occurredAt}`,
        userId,
        type: creditTransactionType(entry),
        amountKc,
        balanceAfterKc: balance,
        occurredAt,
        note: text(entry.text, text(entry.uhrada, "")) || undefined,
      };
      balance -= amountKc;
      if (!Number.isFinite(balance)) {
        throw new Error("Luxart credit history produces an invalid balance.");
      }
      return transaction;
    });
}
