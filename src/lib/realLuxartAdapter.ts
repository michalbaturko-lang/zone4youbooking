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
  parseLuxartLessonId,
  parseLuxartWatchdogId,
  type LuxartLessonData,
  type LuxartLessonMapping,
  type LuxartPaymentHistory,
  type LuxartPaymentResult,
  type LuxartReservationDeleteResult,
  type LuxartReservationData,
  type LuxartReservationInsertResult,
  type LuxartUserData,
  type LuxartWatchdogData,
  type LuxartWatchdogResult,
} from "./luxartContract";
import { createHash, randomUUID } from "node:crypto";
import { bookingRules } from "./bookingRules";
import { BookingApiError, BookingMutationOutcomeUnknownError } from "./errors";
import type { Locale } from "./i18n";
import { loadLuxartGatewayAuthConfig } from "./luxartGatewayAuth";
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
  const defaultRoomNames = parseEnvironmentMapping("LUXART_ROOM_MAP_JSON");
  const defaultLessonTypeNames = parseEnvironmentMapping("LUXART_LESSON_TYPE_MAP_JSON");
  return {
    roomNames: locale === "en" ? parseEnvironmentMapping("LUXART_ROOM_MAP_EN_JSON") ?? defaultRoomNames : defaultRoomNames,
    lessonTypeNames:
      locale === "en"
        ? parseEnvironmentMapping("LUXART_LESSON_TYPE_MAP_EN_JSON") ?? defaultLessonTypeNames
        : defaultLessonTypeNames,
  };
}

function parseEnvironmentMapping(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, string>;
  } catch {
    throw new Error(`${name} must contain a JSON object with numeric Luxart IDs as keys.`);
  }
}

function scheduleDays(query: LessonQuery) {
  const from = new Date(query.from).getTime();
  const to = new Date(query.to).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 7;
  return Math.min(31, Math.max(1, Math.ceil((to - from) / 86_400_000)));
}

function assertWatchdogEnabled() {
  if (process.env.LUXART_WAITLIST_ENABLED !== "true") {
    throw new BookingApiError(503, "WATCHDOG_DISABLED", "Hlídání uvolněného místa je dočasně vypnuté.");
  }
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

  const capacityInvalidOrFull =
    !Number.isFinite(lesson.capacity) ||
    lesson.capacity <= 0 ||
    !Number.isFinite(lesson.occupiedCount) ||
    lesson.occupiedCount < 0 ||
    lesson.occupiedCount >= lesson.capacity;
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
      const user = mapLuxartUser(userData);
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
        cachedUser = mapLuxartUser(userData);
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
      const lessons = await luxartFetch<LuxartLessonData[]>(
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
      if (lessons.some((lesson) => Number(lesson.resort) !== config.resortId)) {
        throw new BookingApiError(502, "LUXART_RESPONSE_INVALID", "Luxart vrátil lekci mimo Zone4You resort.");
      }
      const mapping = mappingFromEnvironment(context.locale);
      const waitlistEnabled = process.env.LUXART_WAITLIST_ENABLED === "true";
      return lessons.map((lesson) => ({
        ...mapLuxartLesson(lesson, mapping),
        waitlistEnabled,
      }));
    },

    async getReservations(): Promise<Reservation[]> {
      const userId = requireCurrentUserId();
      try {
        const reservations = await luxartFetch<LuxartReservationData[]>(
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
        return reservations
          .filter((reservation) => Number(reservation.resort) === config.resortId)
          .map((reservation) => mapLuxartReservation(reservation, userId));
      } catch (error) {
        if (error instanceof LuxartHttpError && error.upstreamStatus === 404) return [];
        throw error;
      }
    },

    async getWaitlist(): Promise<WaitlistEntry[]> {
      const userId = requireCurrentUserId();
      if (process.env.LUXART_WAITLIST_ENABLED !== "true") return [];
      try {
        const entries = await luxartFetch<LuxartWatchdogData[]>(
          config,
          queryPath("/api/watchdog_II/user", { user_id: userId }),
          undefined,
          "watchdog list",
        );
        const range = zone4YouScheduleRange(new Date(), 31);
        const lessons = await this.getLessons({
          ...range,
          resortId: config.resortId,
        });
        return entries
          .filter((entry) => Number(entry.resort) === config.resortId)
          .map((entry) => mapLuxartWatchdog(entry, userId, lessons))
          .filter((entry): entry is WaitlistEntry => entry !== null);
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
        const entries = await luxartFetch<LuxartPaymentHistory[]>(
          config,
          queryPath("/api/user/credit_history", {
            user_id: user.id,
            lang: luxartLanguage(),
          }),
          undefined,
          "credit history",
        );
        return mapLuxartCreditHistory(
          entries.filter((entry) => Number(entry.resort) === config.resortId),
          user.id,
          user.creditBalanceKc,
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

      const resourceMap = parseEnvironmentMapping("LUXART_RESOURCE_MAP_JSON");
      const resourceId = Number(resourceMap?.[String(lesson.luxartRoomNumber ?? "")]);
      const payload = buildLuxartReservationInsert(lesson, userId, resourceId);
      const result = await luxartFetch<LuxartReservationInsertResult>(
        config,
        "/api/Reservations",
        { method: "POST", body: JSON.stringify(payload) },
        "create reservation",
        true,
      );
      if (!Number.isInteger(result.success)) throw new BookingMutationOutcomeUnknownError();
      if (![1, 2].includes(result.success)) {
        throw new BookingApiError(409, "RESERVATION_REJECTED", result.messaget || "Rezervaci nelze vytvořit.");
      }

      try {
        const refreshed = await this.getReservations();
        const created = refreshed.find((reservation) => result.uuid && reservation.luxartUuid === result.uuid);
        if (created) return created;
      } catch {
        // The successful write response is authoritative. A failed follow-up
        // read must not turn it into a retryable failure and create a duplicate.
      }

      return {
        id: `uuid:${result.uuid ?? randomUUID()}`,
        userId,
        lessonId: lesson.id,
        status: "active",
        reservedAt: new Date().toISOString(),
        priceKc: lesson.priceKc,
        luxartUuid: result.uuid ?? undefined,
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

      const response = await luxartFetch<LuxartReservationDeleteResult[] | LuxartReservationDeleteResult>(
        config,
        queryPath(`/api/Reservations/${encodeURIComponent(reservation.id)}`, {
          kategorie: reservation.luxartCategoryId,
          resort: config.resortId,
        }),
        { method: "DELETE" },
        "cancel reservation",
        true,
      );
      const result = Array.isArray(response) ? response[0] : response;
      if (!result || !Number.isInteger(result.success)) throw new BookingMutationOutcomeUnknownError();
      if (!result || result.success < 0) {
        throw new BookingApiError(409, "CANCELLATION_REJECTED", result?.messaget || "Rezervaci nelze zrušit.");
      }

      return {
        ...reservation,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationFeeKc: Math.max(0, Number(result.storno_poplatek ?? 0)),
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
      const resourceMap = parseEnvironmentMapping("LUXART_RESOURCE_MAP_JSON");
      const resourceId = Number(resourceMap?.[String(lesson.luxartRoomNumber ?? "")]);
      const payload = buildLuxartWatchdogInsert(lesson, userId, resourceId, luxartLanguage());
      const result = await luxartFetch<LuxartWatchdogResult>(
        config,
        watchdogInsertPath(),
        { method: "POST", body: JSON.stringify(payload) },
        "create watchdog",
        true,
      );
      if (!Number.isInteger(result.success)) throw new BookingMutationOutcomeUnknownError();
      if (![1, 2].includes(result.success)) {
        throw new BookingApiError(409, "WATCHDOG_REJECTED", result.messaget || "Hlídání místa nelze vytvořit.");
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
      let watchdogId = _input.waitlistEntryId ? parseLuxartWatchdogId(_input.waitlistEntryId) : null;
      if (!watchdogId && _input.lessonId) {
        const entry = (await this.getWaitlist()).find((candidate) => candidate.lessonId === _input.lessonId);
        watchdogId = entry ? parseLuxartWatchdogId(entry.id) : null;
      }
      if (!watchdogId) throw new BookingApiError(404, "WATCHDOG_NOT_FOUND", "Hlídání místa nebylo nalezeno.");

      const response = await luxartFetch<LuxartWatchdogResult[] | LuxartWatchdogResult>(
        config,
        queryPath(`/api/Watchdog/${watchdogId}`, { resort: config.resortId }),
        { method: "DELETE" },
        "delete watchdog",
        true,
      );
      const result = Array.isArray(response) ? response[0] : response;
      if (!result || !Number.isInteger(result.success)) throw new BookingMutationOutcomeUnknownError();
      if (!result || result.success < 0) {
        throw new BookingApiError(409, "WATCHDOG_DELETE_REJECTED", result?.messaget || "Hlídání místa nelze odebrat.");
      }
    },

    async createTopup(_input: CreateTopupInput): Promise<PaymentTopup> {
      const userId = requireCurrentUserId();
      const paymentMethodId = Number(process.env.LUXART_STRIPE_PAYMENT_METHOD_ID);
      const payload = buildLuxartCreditPaymentInsert(_input, userId, paymentMethodId);
      const result = await luxartFetch<LuxartPaymentResult>(
        config,
        "/api/Payment",
        { method: "POST", body: JSON.stringify(payload) },
        "credit payment",
        true,
      );
      if (!Number.isInteger(result.success)) throw new BookingMutationOutcomeUnknownError();
      if (result.success < 1) {
        throw new BookingApiError(409, "PAYMENT_REJECTED", result.messaget || "Luxart platbu nepřijal.");
      }
      return mapLuxartCreditPayment(result, _input, userId);
    },
  };
}
