import type {
  CreateTopupInput,
  Lesson,
  LessonQuery,
  LoginInput,
  LoginResult,
  LuxartAdapter,
  PaymentTopup,
  Reservation,
  User,
  WaitlistEntry,
  CreditTransaction,
} from "./domain";
import {
  buildLuxartReservationInsert,
  buildLuxartCreditPaymentInsert,
  buildLuxartWatchdogInsert,
  mapLuxartLesson,
  mapLuxartCreditHistory,
  mapLuxartCreditPayment,
  mapLuxartReservation,
  mapLuxartUser,
  mapLuxartWatchdog,
  parseExplicitLuxartDateTime,
  parseLuxartLessonId,
  parseLuxartWatchdogId,
  type LuxartLessonData,
  type LuxartLessonMapping,
  type LuxartPaymentHistory,
  type LuxartPaymentResult,
  type LuxartReservationData,
  type LuxartUserData,
  type LuxartWatchdogData,
} from "./luxartContract";
import { createHash } from "node:crypto";
import { availablePlacesForLesson, bookingRules, canCancelLessonAt } from "./bookingRules";
import { BookingApiError, BookingMutationOutcomeUnknownError } from "./errors";
import type { Locale } from "./i18n";
import { loadLuxartGatewayAuthConfig } from "./luxartGatewayAuth";
import { parseLuxartResourceMapping, parseLuxartTextMapping } from "./luxartMappings";
import { zone4YouScheduleRange } from "./zone4YouTime";

interface RealLuxartConfig {
  baseUrl: string;
  resortId: number;
  timeoutMs: number;
  gatewayHeaders: Record<string, string>;
}

interface RealLuxartContext {
  userId?: string;
  locale?: Locale;
}

export const maximumLuxartResponseBytes = 4 * 1024 * 1024;

function throwLuxartResponseError(mutationOutcomeMayBeUnknown: boolean, tooLarge = false): never {
  if (mutationOutcomeMayBeUnknown) throw new BookingMutationOutcomeUnknownError();
  throw new BookingApiError(
    502,
    tooLarge ? "LUXART_RESPONSE_TOO_LARGE" : "LUXART_RESPONSE_INVALID",
    tooLarge ? "Luxart vrátil příliš velkou odpověď." : "Luxart vrátil neplatnou odpověď.",
  );
}

export async function readLuxartJsonResponse<T>(
  response: Response,
  mutationOutcomeMayBeUnknown = false,
  maximumBytes = maximumLuxartResponseBytes,
): Promise<T> {
  const rawLength = response.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throwLuxartResponseError(mutationOutcomeMayBeUnknown, true);
  }
  if (!response.body) throwLuxartResponseError(mutationOutcomeMayBeUnknown);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throwLuxartResponseError(mutationOutcomeMayBeUnknown, true);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throwLuxartResponseError(mutationOutcomeMayBeUnknown);
  }
}

function normalizedLuxartBaseUrl(environment: NodeJS.ProcessEnv = process.env) {
  const rawBaseUrl = environment.LUXART_API_BASE_URL;
  if (!rawBaseUrl) {
    throw new Error("Missing LUXART_API_BASE_URL. Set LUXART_MOCK=true until Luxart sends the current API URL.");
  }

  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error("LUXART_API_BASE_URL must be a valid Luxart origin.");
  }

  const insecureStagingOverride =
    environment.LUXART_ALLOW_INSECURE_TEST_HTTP === "true" &&
    environment.ZONE4YOU_DEPLOYMENT_TARGET === "staging" &&
    environment.NEXT_PUBLIC_APP_ENV === "staging" &&
    environment.VERCEL_ENV !== "production";
  const approvedTransport = url.protocol === "https:" || (url.protocol === "http:" && insecureStagingOverride);
  if (
    !approvedTransport ||
    !url.hostname ||
    url.hostname.endsWith(".invalid") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("LUXART_API_BASE_URL must be a clean HTTPS origin; HTTP is allowed only for explicit staging tests.");
  }

  return url.origin;
}

class LuxartHttpError extends BookingApiError {
  constructor(
    readonly upstreamStatus: number,
    operation: string,
  ) {
    super(502, "LUXART_UPSTREAM_ERROR", `Luxart API returned ${upstreamStatus} for ${operation}`);
  }
}

function loadConfig(): RealLuxartConfig {
  const baseUrl = normalizedLuxartBaseUrl();
  const resortId = Number(process.env.LUXART_RESORT_ID ?? "1");
  if (resortId !== 1) throw new Error("LUXART_RESORT_ID must be 1 for the Zone4You pilot.");
  const timeoutMs = Number(process.env.LUXART_TIMEOUT_MS ?? "12000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("LUXART_TIMEOUT_MS must be an integer from 1000 to 30000.");
  }

  return {
    baseUrl,
    resortId,
    timeoutMs,
    gatewayHeaders: loadLuxartGatewayAuthConfig().headers,
  };
}

async function luxartFetch<T>(
  config: RealLuxartConfig,
  path: string,
  init?: RequestInit,
  operation = path.split("?", 1)[0],
  mutationOutcomeMayBeUnknown = false,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        Pragma: "no-cache",
        ...init?.headers,
        ...config.gatewayHeaders,
      },
    });
    if (!response.ok) {
      if (mutationOutcomeMayBeUnknown && response.status >= 500) {
        throw new BookingMutationOutcomeUnknownError();
      }
      throw new LuxartHttpError(response.status, operation);
    }
    return await readLuxartJsonResponse<T>(response, mutationOutcomeMayBeUnknown);
  } catch (error) {
    if (error instanceof BookingApiError) throw error;
    if (mutationOutcomeMayBeUnknown) throw new BookingMutationOutcomeUnknownError();
    if (error instanceof Error && error.name === "AbortError") {
      throw new BookingApiError(504, "LUXART_TIMEOUT", "Luxart neodpověděl včas. Zkuste načtení zopakovat.");
    }
    throw new BookingApiError(502, "LUXART_UNREACHABLE", "Luxart je dočasně nedostupný.");
  } finally {
    clearTimeout(timer);
  }
}

function queryPath(path: string, parameters: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) query.set(name, String(value));
  }
  return `${path}?${query.toString()}`;
}

function passwordHash(password: string) {
  if (/^[a-f0-9]{32}$/i.test(password)) return password.toUpperCase();
  return createHash("md5").update(password, "utf8").digest("hex").toUpperCase();
}

function mappingFromEnvironment(locale: Locale = "cs"): LuxartLessonMapping {
  const defaultRoomNames = parseLuxartTextMapping(process.env.LUXART_ROOM_MAP_JSON, "LUXART_ROOM_MAP_JSON");
  const defaultLessonTypeNames = parseLuxartTextMapping(
    process.env.LUXART_LESSON_TYPE_MAP_JSON,
    "LUXART_LESSON_TYPE_MAP_JSON",
  );
  return {
    roomNames: locale === "en"
      ? parseLuxartTextMapping(process.env.LUXART_ROOM_MAP_EN_JSON, "LUXART_ROOM_MAP_EN_JSON") ?? defaultRoomNames
      : defaultRoomNames,
    lessonTypeNames:
      locale === "en"
        ? parseLuxartTextMapping(
          process.env.LUXART_LESSON_TYPE_MAP_EN_JSON,
          "LUXART_LESSON_TYPE_MAP_EN_JSON",
        ) ?? defaultLessonTypeNames
        : defaultLessonTypeNames,
  };
}

function scheduleDays(query: LessonQuery) {
  const from = parseExplicitLuxartDateTime(query.from);
  const to = parseExplicitLuxartDateTime(query.to);
  const fromDay = /^(\d{4}-\d{2}-\d{2})T/.exec(query.from)?.[1];
  const toDay = /^(\d{4}-\d{2}-\d{2})T/.exec(query.to)?.[1];
  if (!from || !to || to <= from || !fromDay || !toDay) {
    throw new BookingApiError(400, "INVALID_LESSON_RANGE", "Rozsah rozvrhu není platný.");
  }

  // Luxart expects a count of calendar dates beginning at date_start, not a
  // count of elapsed 24-hour periods. The latter becomes 8 across Prague's
  // 25-hour autumn daylight-saving transition.
  const days = (
    Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)
  ) / 86_400_000;
  if (!Number.isSafeInteger(days) || days < 1 || days > 31) {
    throw new BookingApiError(400, "INVALID_LESSON_RANGE", "Rozsah rozvrhu není platný.");
  }
  return days;
}

function assertWatchdogEnabled() {
  if (process.env.LUXART_WAITLIST_ENABLED !== "true") {
    throw new BookingApiError(503, "WATCHDOG_DISABLED", "Hlídání uvolněného místa je dočasně vypnuté.");
  }
}

function mapValidatedLuxartUser(data: LuxartUserData, expectedUserId?: string) {
  try {
    const user = mapLuxartUser(data);
    if (expectedUserId !== undefined && user.id !== expectedUserId) {
      throw new Error("Luxart returned a different user identity.");
    }
    return user;
  } catch {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatná data klienta.");
  }
}

function mapValidatedLuxartLesson(data: LuxartLessonData, mapping: LuxartLessonMapping) {
  try {
    return mapLuxartLesson(data, mapping);
  } catch {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatná data lekce.");
  }
}

function asValidatedLuxartArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatný seznam dat.");
  }
  return value as T[];
}

function assertUniqueResponseIds<T extends { id: string }>(items: T[]) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil duplicitní identifikátory.");
    }
    ids.add(item.id);
  }
  return items;
}

function mapValidatedLuxartReservation(data: LuxartReservationData, userId: string, resortId: number) {
  try {
    return mapLuxartReservation(data, userId, resortId);
  } catch {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatná data rezervace.");
  }
}

function mapValidatedLuxartWatchdog(
  data: LuxartWatchdogData,
  userId: string,
  lessons: Lesson[],
  resortId: number,
) {
  try {
    return mapLuxartWatchdog(data, userId, lessons, resortId);
  } catch {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatná data hlídání místa.");
  }
}

function mapValidatedLuxartCreditHistory(
  entries: LuxartPaymentHistory[],
  userId: string,
  currentBalanceKc: number,
  resortId: number,
) {
  try {
    return mapLuxartCreditHistory(entries, userId, currentBalanceKc, resortId);
  } catch {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatnou historii kreditu.");
  }
}

function asMutationResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingMutationOutcomeUnknownError();
  }
  return value as Record<string, unknown>;
}

function asSingleMutationResult(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new BookingMutationOutcomeUnknownError();
    return asMutationResult(value[0]);
  }
  return asMutationResult(value);
}

function mutationSuccessCode(result: Record<string, unknown>) {
  const success = result.success;
  if (typeof success !== "number" || !Number.isSafeInteger(success)) {
    throw new BookingMutationOutcomeUnknownError();
  }
  return success;
}

function optionalMutationIdentifier(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BookingMutationOutcomeUnknownError();
  const identifier = value.trim();
  if (!identifier || identifier.length > 256 || /[\u0000-\u001f\u007f]/.test(identifier)) {
    throw new BookingMutationOutcomeUnknownError();
  }
  return identifier;
}

function requiredNonNegativeMutationNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new BookingMutationOutcomeUnknownError();
  return parsed;
}

export function assertReservationPreconditions(lesson: Lesson, user: User, now = new Date()) {
  const nowTime = now.getTime();
  const startTime = new Date(lesson.startsAt).getTime();
  if (!Number.isFinite(nowTime) || !Number.isFinite(startTime)) {
    throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil neplatný čas lekce.");
  }
  if (startTime <= nowTime) {
    throw new BookingApiError(409, "RESERVATION_CLOSED", "Rezervaci této lekce už nelze vytvořit.");
  }
  if (startTime - nowTime > bookingRules.reservationWindowHours * 60 * 60 * 1000) {
    throw new BookingApiError(409, "RESERVATION_NOT_OPEN", "Rezervace této lekce ještě není otevřená.");
  }

  const availableCount = availablePlacesForLesson(lesson);
  const capacityInvalidOrFull =
    !Number.isFinite(lesson.capacity) ||
    lesson.capacity <= 0 ||
    !Number.isFinite(lesson.occupiedCount) ||
    lesson.occupiedCount < 0 ||
    lesson.occupiedCount >= lesson.capacity ||
    !Number.isInteger(availableCount) ||
    availableCount <= 0 ||
    availableCount > lesson.capacity ||
    lesson.occupiedCount + availableCount > lesson.capacity;
  if (capacityInvalidOrFull) {
    throw new BookingApiError(409, "LESSON_FULL", "Lekce je plně obsazená.");
  }

  if (
    !Number.isFinite(user.creditBalanceKc) ||
    user.creditBalanceKc < bookingRules.minimumCreditForReservationKc
  ) {
    throw new BookingApiError(
      409,
      "INSUFFICIENT_CREDIT",
      `Pro rezervaci je potřeba alespoň ${bookingRules.minimumCreditForReservationKc} Kč kreditu.`,
    );
  }
}

function watchdogInsertPath() {
  const variant = process.env.LUXART_WATCHDOG_VARIANT ?? "watchdog_III";
  if (!["watchdog", "watchdog_II", "watchdog_III"].includes(variant)) {
    throw new Error("LUXART_WATCHDOG_VARIANT must be watchdog, watchdog_II or watchdog_III.");
  }
  return `/api/Reservations/${variant}`;
}

export function createRealLuxartAdapter(context: RealLuxartContext = {}): LuxartAdapter {
  const config = loadConfig();
  let cachedUser: User | null | undefined;

  function currentUserId() {
    return context.userId;
  }

  function requireCurrentUserId() {
    const userId = currentUserId();
    if (!userId) throw new BookingApiError(401, "AUTH_REQUIRED", "Pro tuto akci se přihlaste.");
    if (!/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
      throw new BookingApiError(401, "SESSION_INVALID", "Přihlášení vypršelo. Přihlaste se znovu.");
    }
    return userId;
  }

  function luxartLanguage() {
    return context.locale === "en" ? "en" : "cz";
  }

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const userData = await luxartFetch<LuxartUserData>(
        config,
        queryPath("/api/Login", {
          login: input.login,
          password: passwordHash(input.password),
          member_card_number: input.memberCardNumber ?? "",
        }),
        { method: "POST" },
        "login",
      );
      const user = mapValidatedLuxartUser(userData);
      return { user };
    },

    async logout(): Promise<void> {
      return;
    },

    async getCurrentUser(): Promise<User | null> {
      if (cachedUser !== undefined) return cachedUser;
      const userId = currentUserId();
      if (!userId) return null;
      try {
        const userData = await luxartFetch<LuxartUserData>(
          config,
          queryPath("/api/User", { user_id: userId }),
          undefined,
          "current user",
        );
        cachedUser = mapValidatedLuxartUser(userData, userId);
        return cachedUser;
      } catch (error) {
        if (error instanceof LuxartHttpError && error.upstreamStatus === 404) {
          cachedUser = null;
          return null;
        }
        throw error;
      }
    },

    async getLessons(query: LessonQuery): Promise<Lesson[]> {
      if (query.resortId !== undefined && query.resortId !== config.resortId) {
        throw new BookingApiError(400, "RESORT_OUT_OF_SCOPE", "Rozvrh je dostupný pouze pro Zone4You.");
      }
      const response = await luxartFetch<unknown>(
        config,
        queryPath("/api/Lesson", {
          resort: config.resortId,
          date_start: query.from.slice(0, 10),
          id_kategorie: 0,
          user_id: currentUserId() ?? 0,
          pocet_dni_dopredu: scheduleDays(query),
          id_service: 0,
          lang: luxartLanguage(),
        }),
        undefined,
        "lesson list",
      );
      const lessons = asValidatedLuxartArray<LuxartLessonData>(response);
      if (lessons.some((lesson) => Number(lesson?.resort) !== config.resortId)) {
        throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil lekci mimo Zone4You resort.");
      }
      const mapping = mappingFromEnvironment(context.locale);
      const waitlistEnabled = process.env.LUXART_WAITLIST_ENABLED === "true";
      return assertUniqueResponseIds(lessons.map((lesson) => ({
        ...mapValidatedLuxartLesson(lesson, mapping),
        waitlistEnabled,
      })));
    },

    async getReservations(): Promise<Reservation[]> {
      const userId = requireCurrentUserId();
      try {
        const response = await luxartFetch<unknown>(
          config,
          queryPath("/api/Reservations", {
            user_id: userId,
            historie: 0,
            id_rezervace: 0,
            lang: luxartLanguage(),
          }),
          undefined,
          "reservation list",
        );
        const reservations = asValidatedLuxartArray<LuxartReservationData>(response)
          .map((reservation) => mapValidatedLuxartReservation(reservation, userId, config.resortId));
        return assertUniqueResponseIds(reservations);
      } catch (error) {
        if (error instanceof LuxartHttpError && error.upstreamStatus === 404) return [];
        throw error;
      }
    },

    async getWaitlist(): Promise<WaitlistEntry[]> {
      const userId = requireCurrentUserId();
      if (process.env.LUXART_WAITLIST_ENABLED !== "true") return [];
      try {
        const response = await luxartFetch<unknown>(
          config,
          queryPath("/api/watchdog_II/user", { user_id: userId }),
          undefined,
          "watchdog list",
        );
        const entries = asValidatedLuxartArray<LuxartWatchdogData>(response);
        const range = zone4YouScheduleRange(new Date(), 31);
        const lessons = await this.getLessons({
          ...range,
          resortId: config.resortId,
        });
        const waitlist = entries
          .map((entry) => mapValidatedLuxartWatchdog(entry, userId, lessons, config.resortId))
          .filter((entry): entry is WaitlistEntry => entry !== null);
        return assertUniqueResponseIds(waitlist);
      } catch (error) {
        if (error instanceof LuxartHttpError && error.upstreamStatus === 404) return [];
        throw error;
      }
    },

    async getCreditTransactions(): Promise<CreditTransaction[]> {
      requireCurrentUserId();
      const user = await this.getCurrentUser();
      if (!user) throw new BookingApiError(401, "SESSION_INVALID", "Přihlášení vypršelo. Přihlaste se znovu.");
      try {
        const response = await luxartFetch<unknown>(
          config,
          queryPath("/api/user/credit_history", {
            user_id: user.id,
            lang: luxartLanguage(),
          }),
          undefined,
          "credit history",
        );
        const entries = asValidatedLuxartArray<LuxartPaymentHistory>(response);
        return mapValidatedLuxartCreditHistory(
          entries,
          user.id,
          user.creditBalanceKc,
          config.resortId,
        );
      } catch (error) {
        if (error instanceof LuxartHttpError && error.upstreamStatus === 404) return [];
        throw error;
      }
    },

    async createReservation(_input: { lessonId: string }): Promise<Reservation> {
      const userId = requireCurrentUserId();
      const identity = parseLuxartLessonId(_input.lessonId);
      if (!identity) throw new BookingApiError(400, "INVALID_LESSON_ID", "Lekci se nepodařilo identifikovat.");
      if (identity.resort !== config.resortId) {
        throw new BookingApiError(400, "RESORT_OUT_OF_SCOPE", "Lekce nepatří do Zone4You.");
      }

      const startsAt = new Date(identity.startsAt);
      const lessons = await this.getLessons({
        from: new Date(startsAt.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        to: new Date(startsAt.getTime() + 36 * 60 * 60 * 1000).toISOString(),
        resortId: config.resortId,
      });
      const lesson = lessons.find((candidate) => candidate.id === _input.lessonId);
      if (!lesson) throw new BookingApiError(404, "LESSON_NOT_FOUND", "Lekce už není v aktuálním rozvrhu.");

      const user = await this.getCurrentUser();
      if (!user || user.id !== userId) {
        throw new BookingApiError(401, "SESSION_INVALID", "Přihlášení vypršelo. Přihlaste se znovu.");
      }

      const existing = (await this.getReservations()).find(
        (reservation) => reservation.lessonId === lesson.id && reservation.status === "active",
      );
      if (existing) throw new BookingApiError(409, "ALREADY_RESERVED", "Tuto lekci už máte rezervovanou.");

      assertReservationPreconditions(lesson, user);

      const resourceMap = parseLuxartResourceMapping(process.env.LUXART_RESOURCE_MAP_JSON);
      const resourceId = Number(resourceMap?.[String(lesson.luxartRoomNumber ?? "")]);
      const payload = buildLuxartReservationInsert(lesson, userId, resourceId);
      const response = await luxartFetch<unknown>(
        config,
        "/api/Reservations",
        { method: "POST", body: JSON.stringify(payload) },
        "create reservation",
        true,
      );
      const result = asMutationResult(response);
      const success = mutationSuccessCode(result);
      if (![1, 2].includes(success)) {
        throw new BookingApiError(409, "RESERVATION_REJECTED", "Rezervaci nelze vytvořit.");
      }
      const uuid = optionalMutationIdentifier(result.uuid);

      try {
        const refreshed = await this.getReservations();
        const sameLesson = refreshed.filter(
          (reservation) => reservation.lessonId === lesson.id && reservation.status === "active",
        );
        const created = uuid
          ? refreshed.find((reservation) => reservation.luxartUuid === uuid)
          : sameLesson.length === 1
            ? sameLesson[0]
            : undefined;
        if (created) return created;
      } catch {
        // The successful write response is authoritative. A failed follow-up
        // read must not turn it into a retryable failure and create a duplicate.
      }

      if (!uuid) throw new BookingMutationOutcomeUnknownError();

      return {
        id: `uuid:${uuid}`,
        userId,
        lessonId: lesson.id,
        status: "active",
        reservedAt: new Date().toISOString(),
        priceKc: lesson.priceKc,
        luxartUuid: uuid,
        luxartCategoryId: lesson.luxartCategoryId,
      };
    },

    async cancelReservation(_input: { reservationId: string }): Promise<Reservation> {
      requireCurrentUserId();
      const reservations = await this.getReservations();
      const requestedUuid = _input.reservationId.startsWith("uuid:") ? _input.reservationId.slice(5) : undefined;
      const reservation = reservations.find(
        (candidate) => candidate.id === _input.reservationId || (requestedUuid && candidate.luxartUuid === requestedUuid),
      );
      if (!reservation || !reservation.luxartCategoryId) {
        throw new BookingApiError(404, "RESERVATION_NOT_FOUND", "Rezervace nebyla nalezena.");
      }

      const lessonRange = zone4YouScheduleRange(new Date(), bookingRules.scheduleDays);
      const lesson = (await this.getLessons({ ...lessonRange, resortId: config.resortId }))
        .find((candidate) => candidate.id === reservation.lessonId);
      if (!lesson) {
        throw new BookingApiError(
          409,
          "CANCELLATION_POLICY_UNAVAILABLE",
          "Pravidla storna této rezervace nelze bezpečně ověřit.",
        );
      }
      if (!canCancelLessonAt(lesson, bookingRules)) {
        throw new BookingApiError(409, "CANCELLATION_CLOSED", "Online storno této rezervace je uzavřené.");
      }

      const response = await luxartFetch<unknown>(
        config,
        queryPath(`/api/Reservations/${encodeURIComponent(reservation.id)}`, {
          kategorie: reservation.luxartCategoryId,
          resort: config.resortId,
        }),
        { method: "DELETE" },
        "cancel reservation",
        true,
      );
      const result = asSingleMutationResult(response);
      const success = mutationSuccessCode(result);
      if (![1, 2].includes(success)) {
        throw new BookingApiError(409, "CANCELLATION_REJECTED", "Rezervaci nelze zrušit.");
      }
      const cancellationFeeKc = requiredNonNegativeMutationNumber(result.storno_poplatek);

      return {
        ...reservation,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationFeeKc,
      };
    },

    async joinWaitlist(_input: { lessonId: string }): Promise<WaitlistEntry> {
      const userId = requireCurrentUserId();
      assertWatchdogEnabled();
      const identity = parseLuxartLessonId(_input.lessonId);
      if (!identity) throw new BookingApiError(400, "INVALID_LESSON_ID", "Lekci se nepodařilo identifikovat.");
      if (identity.resort !== config.resortId) {
        throw new BookingApiError(400, "RESORT_OUT_OF_SCOPE", "Lekce nepatří do Zone4You.");
      }
      const startsAt = new Date(identity.startsAt);
      const lessons = await this.getLessons({
        from: new Date(startsAt.getTime() - 12 * 60 * 60 * 1000).toISOString(),
        to: new Date(startsAt.getTime() + 36 * 60 * 60 * 1000).toISOString(),
        resortId: config.resortId,
      });
      const lesson = lessons.find((candidate) => candidate.id === _input.lessonId);
      if (!lesson) throw new BookingApiError(404, "LESSON_NOT_FOUND", "Lekce už není v aktuálním rozvrhu.");

      const existing = (await this.getWaitlist()).find((entry) => entry.lessonId === lesson.id);
      if (existing) return existing;
      const resourceMap = parseLuxartResourceMapping(process.env.LUXART_RESOURCE_MAP_JSON);
      const resourceId = Number(resourceMap?.[String(lesson.luxartRoomNumber ?? "")]);
      const payload = buildLuxartWatchdogInsert(lesson, userId, resourceId, luxartLanguage());
      const response = await luxartFetch<unknown>(
        config,
        watchdogInsertPath(),
        { method: "POST", body: JSON.stringify(payload) },
        "create watchdog",
        true,
      );
      const result = asMutationResult(response);
      const success = mutationSuccessCode(result);
      if (![1, 2].includes(success)) {
        throw new BookingApiError(409, "WATCHDOG_REJECTED", "Hlídání místa nelze vytvořit.");
      }

      const refreshed = await this.getWaitlist();
      const created = refreshed.find((entry) => entry.lessonId === lesson.id);
      if (!created) {
        throw new BookingApiError(502, "WATCHDOG_REFRESH_FAILED", "Luxart hlídání vytvořil, ale nepotvrdil jeho identifikátor.");
      }
      return created;
    },

    async leaveWaitlist(_input: { waitlistEntryId?: string; lessonId?: string }): Promise<void> {
      requireCurrentUserId();
      assertWatchdogEnabled();
      const entries = await this.getWaitlist();
      const ownedEntry = _input.waitlistEntryId
        ? entries.find((entry) => entry.id === _input.waitlistEntryId)
        : _input.lessonId
          ? entries.find((entry) => entry.lessonId === _input.lessonId)
          : undefined;
      const watchdogId = ownedEntry ? parseLuxartWatchdogId(ownedEntry.id) : null;
      if (!watchdogId) throw new BookingApiError(404, "WATCHDOG_NOT_FOUND", "Hlídání místa nebylo nalezeno.");

      const response = await luxartFetch<unknown>(
        config,
        queryPath(`/api/Watchdog/${watchdogId}`, { resort: config.resortId }),
        { method: "DELETE" },
        "delete watchdog",
        true,
      );
      const result = asSingleMutationResult(response);
      const success = mutationSuccessCode(result);
      if (![1, 2].includes(success)) {
        throw new BookingApiError(409, "WATCHDOG_DELETE_REJECTED", "Hlídání místa nelze odebrat.");
      }
    },

    async createTopup(_input: CreateTopupInput): Promise<PaymentTopup> {
      const userId = requireCurrentUserId();
      const paymentMethodId = Number(process.env.LUXART_STRIPE_PAYMENT_METHOD_ID);
      const payload = buildLuxartCreditPaymentInsert(_input, userId, paymentMethodId);
      const response = await luxartFetch<unknown>(
        config,
        "/api/Payment",
        { method: "POST", body: JSON.stringify(payload) },
        "credit payment",
        true,
      );
      const result = asMutationResult(response);
      const success = mutationSuccessCode(result);
      if (success < 1) {
        throw new BookingApiError(409, "PAYMENT_REJECTED", "Luxart platbu nepřijal.");
      }
      try {
        return mapLuxartCreditPayment(result as unknown as LuxartPaymentResult, _input, userId);
      } catch {
        throw new BookingMutationOutcomeUnknownError();
      }
    },
  };
}
