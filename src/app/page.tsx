"use client";

import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  DoorOpen,
  Loader2,
  LockKeyhole,
  Search,
  Star,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { BookingApiClientError, bookingApiClient } from "@/lib/bookingApiClient";
import {
  availablePlacesForLesson,
  bookingRules as fallbackRules,
  canCancelLessonAt,
  freeCancellationDeadlineForLesson,
  isReformerLesson,
} from "@/lib/bookingRules";
import type { BookingCapabilities, BookingRules, BookingSnapshot, Lesson, LoginInput, Reservation, WaitlistEntry } from "@/lib/domain";
import { useI18n } from "./providers";
import type { Locale, Translate } from "@/lib/i18n";
import {
  addZone4YouCalendarDays,
  zone4YouDateKey,
  zone4YouTimeZone,
} from "@/lib/zone4YouTime";

type ViewMode = "day" | "week";
type Section = "schedule" | "reservations" | "credit" | "profile";
type Modal = "login" | "lesson" | null;
type LoadFailure = { requestId?: string };
type ToastState = { message: string; tone: "success" | "warning" | "error"; persistent?: boolean };
const allFilter = "__all__";
const favoriteServicesStoragePrefix = "zone4youbooking.favoriteServices";
const maximumStoredFavoriteServices = 512;
const maximumStoredFavoriteBytes = 64 * 1024;
const maximumFavoriteKeyLength = 256;
const modalFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
const fallbackCapabilities: BookingCapabilities = {
  reservationsEnabled: false,
  waitlistEnabled: false,
  topupsEnabled: false,
  topupMode: "disabled",
  businessRulesStatus: "unconfirmed",
  favoritesSync: "device",
  forgotPasswordEnabled: false,
  englishEnabled: true,
};

function favoriteStorageKey(owner: string) {
  return `${favoriteServicesStoragePrefix}:${owner}`;
}

function validStoredFavoriteKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumFavoriteKeyLength &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function readStoredFavoriteServices(owner: string) {
  const storageKey = favoriteStorageKey(owner);
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return undefined;
    if (new Blob([stored]).size > maximumStoredFavoriteBytes) throw new Error("Favorite storage is too large.");
    const parsed = JSON.parse(stored) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length > maximumStoredFavoriteServices ||
      !parsed.every(validStoredFavoriteKey)
    ) {
      throw new Error("Favorite storage is invalid.");
    }
    return Array.from(new Set(parsed));
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Storage can be blocked entirely. Favorites still work for this page session.
    }
    return undefined;
  }
}

function writeStoredFavoriteServices(owner: string, favoriteIds: string[]) {
  try {
    if (
      favoriteIds.length > maximumStoredFavoriteServices ||
      !favoriteIds.every(validStoredFavoriteKey)
    ) return false;
    const serialized = JSON.stringify(favoriteIds);
    if (new Blob([serialized]).size > maximumStoredFavoriteBytes) return false;
    window.localStorage.setItem(favoriteStorageKey(owner), serialized);
    return true;
  } catch {
    return false;
  }
}

function modalFocusables(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(modalFocusableSelector))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

function useAccessibleModal(onClose: () => void, initialFocusSelector: string) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    document.body.style.overflow = "hidden";
    const initialTarget = dialog?.querySelector<HTMLElement>(initialFocusSelector) ?? dialog;
    initialTarget?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [initialFocusSelector]);

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = modalFocusables(dialog);
    if (focusables.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return { dialogRef, onDialogKeyDown };
}

const englishLessonNames: Record<string, string> = {
  "ZDRAVÁ ZÁDA": "HEALTHY BACK",
  "RANNÍ JOGA": "MORNING YOGA",
  "POWER JOGA": "POWER YOGA",
};

const englishLessonDescriptions: Record<string, string> = {
  HIIT: "High-intensity interval training alternating short bursts of exercise with recovery.",
  "BODY FORMING": "An aerobic strength class focused on full-body toning.",
  SPINNING: "An energetic group workout on stationary bikes and an effective cardio session.",
  "ZDRAVÁ ZÁDA": "A health-focused class for back release, core stability and better posture.",
  PILATES: "Controlled movement, breathing and strengthening of the deep stabilizing system.",
  "POWER JOGA": "Dynamic yoga for strength, mobility and a calm end to the day.",
  REFORMER: "A Reformer machine class with individual guidance and precise resistance work.",
  "HEAT easy": "A lighter H.E.A.T. session suitable for beginners and recovery days.",
  PUMPING: "A full-body strength class using adjustable barbells.",
  "RANNÍ JOGA": "A gentle morning class to wake up, stretch and start the day calmly.",
};

const englishSpecializations: Record<string, string> = {
  "H.E.A.T., kondiční lekce": "H.E.A.T., fitness classes",
  "Zdravá záda, pilates": "Healthy Back, Pilates",
  "Jóga, mobilita": "Yoga, mobility",
  "Pumping, síla": "Pumping, strength",
};

function money(value: number, locale: Locale = "cs") {
  return `${value.toLocaleString(locale === "en" ? "en-GB" : "cs-CZ")} Kč`;
}

function dateKey(value: string) {
  return zone4YouDateKey(value);
}

function formatDay(value: string, locale: Locale, style: "short" | "long" = "short") {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00.000Z`) : new Date(value);
  const browserLocale = locale === "en" ? "en-GB" : "cs-CZ";
  const weekday = new Intl.DateTimeFormat(browserLocale, { weekday: style, timeZone: zone4YouTimeZone }).format(date);
  const day = new Intl.DateTimeFormat(browserLocale, {
    day: "numeric",
    month: "numeric",
    timeZone: zone4YouTimeZone,
  }).format(date);
  return `${weekday} ${day}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone4YouTimeZone,
  }).format(new Date(value));
}

function formatDateTime(value: string, locale: Locale = "cs") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone4YouTimeZone,
  }).format(new Date(value));
}

function occupancyState(lesson: Lesson, t: Translate) {
  const free = Math.max(0, availablePlacesForLesson(lesson));
  if (free === 0) return { label: t("status.full"), tone: "full", free };
  if (free <= 2) return { label: t("status.last", { count: free }), tone: "few", free };
  return { label: t("status.free", { count: free }), tone: "available", free };
}

function occupancyClass(lesson: Lesson, t: Translate) {
  const state = occupancyState(lesson, t);
  return state.tone === "available" ? "status-available" : state.tone === "few" ? "status-few" : "status-full";
}

function roomClass(roomName: Lesson["roomName"]) {
  return `room-${roomName.toLowerCase().replaceAll(" ", "-").replace("á", "a")}`;
}

function favoriteKey(lesson: Lesson) {
  return lesson.serviceId ? `service:${lesson.serviceId}` : `name:${lesson.name.trim().toLocaleLowerCase("cs-CZ")}`;
}

function displayLessonName(lesson: Lesson, locale: Locale) {
  return locale === "en" ? englishLessonNames[lesson.name] ?? lesson.name : lesson.name;
}

function displayLessonDescription(lesson: Lesson, locale: Locale) {
  return locale === "en" ? englishLessonDescriptions[lesson.name] ?? lesson.description : lesson.description;
}

function displaySpecialization(lesson: Lesson, locale: Locale) {
  return locale === "en"
    ? englishSpecializations[lesson.instructorSpecialization] ?? lesson.instructorSpecialization
    : lesson.instructorSpecialization;
}

function displayInstructorName(name: string, locale: Locale) {
  return locale === "en" && name === "Reformer tým" ? "Reformer team" : name;
}

function displayRoomName(roomName: string, locale: Locale) {
  if (locale !== "en") return roomName;
  return roomName.replace(/^Sál\s+(\d+)$/i, "Studio $1");
}

function displayCategory(category: string, locale: Locale) {
  if (locale !== "en") return category;
  return ({ Síla: "Strength", Zdraví: "Health", Ostatní: "Other" } as Record<string, string>)[category] ?? category;
}

function canReserve(lesson: Lesson, rules: BookingRules) {
  const now = Date.now();
  const start = new Date(lesson.startsAt).getTime();
  return start > now && start - now <= rules.reservationWindowHours * 60 * 60 * 1000;
}

function hasMinimumCredit(creditBalanceKc: number, rules: BookingRules) {
  return Number.isFinite(creditBalanceKc) && creditBalanceKc >= rules.minimumCreditForReservationKc;
}

function addDaysToKey(dayKey: string, offset: number) {
  return addZone4YouCalendarDays(dayKey, offset);
}

function reservationHold(reservation: Reservation, rules: BookingRules) {
  return reservation.holdAmountKc ?? rules.reservationHoldKc;
}

function reservationFor(lesson: Lesson, reservations: Reservation[]) {
  return reservations.find((reservation) => reservation.lessonId === lesson.id && reservation.status === "active");
}

function waitlistFor(lesson: Lesson, waitlist: WaitlistEntry[]) {
  return waitlist.find((entry) => entry.lessonId === lesson.id && entry.status === "waiting");
}

function activeReservationLabel(reservation: Reservation, lesson: Lesson | undefined, locale: Locale, t: Translate) {
  if (!lesson) return t("reservations.active");
  return `${displayLessonName(lesson, locale)}, ${formatDateTime(lesson.startsAt, locale)}`;
}

function sortLessons(lessons: Lesson[]) {
  return [...lessons].sort((first, second) => new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime());
}

function groupLessonsByTime(lessons: Lesson[]) {
  const groups = new Map<string, Lesson[]>();
  sortLessons(lessons).forEach((lesson) => {
    const time = formatTime(lesson.startsAt);
    groups.set(time, [...(groups.get(time) ?? []), lesson]);
  });
  return Array.from(groups, ([time, groupedLessons]) => ({ time, lessons: groupedLessons }));
}

export default function Home() {
  const { locale, setLocale, t } = useI18n();
  const [snapshot, setSnapshot] = useState<BookingSnapshot | null>(null);
  const [rules, setRules] = useState<BookingRules>(fallbackRules);
  const [capabilities, setCapabilities] = useState<BookingCapabilities>(fallbackCapabilities);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("schedule");
  const [view, setView] = useState<ViewMode>("day");
  const [room, setRoom] = useState(allFilter);
  const [category, setCategory] = useState(allFilter);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [favoriteServiceIds, setFavoriteServiceIds] = useState<string[]>([]);
  const [favoriteOwner, setFavoriteOwner] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<"success" | "cancelled" | null>(null);
  const [mutationOutcomeUncertain, setMutationOutcomeUncertain] = useState(false);

  async function refresh(nextLocale: Locale = locale) {
    try {
      const next = await bookingApiClient.snapshot(nextLocale);
      setSnapshot(next);
      setRules(next.rules);
      setCapabilities(next.capabilities);
      setSelectedDay((current) => current ?? dateKey(new Date().toISOString()));
      setLoadFailure(null);
      return next;
    } catch (error) {
      setLoadFailure({
        ...(error instanceof BookingApiClientError && error.requestId
          ? { requestId: error.requestId }
          : {}),
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [locale]);

  useEffect(() => {
    if (!snapshot) return;
    const owner = snapshot.user?.id ?? "anonymous";
    if (favoriteOwner === owner) return;
    const stored = readStoredFavoriteServices(owner);
    if (stored !== undefined) {
      setFavoriteServiceIds(stored);
      setFavoriteOwner(owner);
      return;
    }
    const seeded = Array.from(new Set(snapshot.lessons.filter((lesson) => lesson.favorite).map(favoriteKey)));
    setFavoriteServiceIds(seeded);
    writeStoredFavoriteServices(owner, seeded);
    setFavoriteOwner(owner);
  }, [favoriteOwner, snapshot]);

  useEffect(() => {
    if (!toast || toast.persistent) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const returnedPayment = parameters.get("payment");
    if (returnedPayment === "success" || returnedPayment === "cancelled") {
      setPaymentReturn(returnedPayment);
      setSection("credit");
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
    }
  }, [locale, t]);

  const lessons = snapshot?.lessons ?? [];
  const reservations = snapshot?.reservations ?? [];
  const waitlist = snapshot?.waitlist ?? [];
  const todayKey = dateKey(new Date().toISOString());
  const scheduleDays = Math.max(1, rules.scheduleDays ?? fallbackRules.scheduleDays);

  const days = useMemo(
    () => Array.from({ length: scheduleDays }, (_, index) => addDaysToKey(todayKey, index)),
    [scheduleDays, todayKey],
  );
  const lessonById = useMemo(() => new Map(lessons.map((lesson) => [lesson.id, lesson])), [lessons]);
  const rooms = useMemo(
    () => [allFilter, ...Array.from(new Set(lessons.map((lesson) => lesson.roomName))).sort((a, b) => a.localeCompare(b, "cs-CZ"))],
    [lessons],
  );
  const categories = useMemo(
    () => [allFilter, ...Array.from(new Set(lessons.map((lesson) => lesson.category))).sort((a, b) => a.localeCompare(b, "cs-CZ"))],
    [lessons],
  );

  const filteredLessons = useMemo(() => {
    return sortLessons(lessons).filter((lesson) => {
      if (room !== allFilter && lesson.roomName !== room) return false;
      if (category !== allFilter && lesson.category !== category) return false;
      if (favoriteOnly && !favoriteServiceIds.includes(favoriteKey(lesson))) return false;
      if (view === "day" && selectedDay && dateKey(lesson.startsAt) !== selectedDay) return false;
      const haystack = `${lesson.name} ${lesson.instructorName} ${lesson.roomName}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
  }, [lessons, room, category, favoriteOnly, favoriteServiceIds, selectedDay, query, view]);

  const visibleLessonsByDay = useMemo(() => {
    return days.map((day) => ({
      day,
      lessons: filteredLessons.filter((lesson) => dateKey(lesson.startsAt) === day),
    }));
  }, [days, filteredLessons]);

  const visibleDayGroups = useMemo(
    () => visibleLessonsByDay.filter(({ day, lessons: dayLessons }) => (view !== "day" || day === selectedDay) && dayLessons.length > 0),
    [selectedDay, view, visibleLessonsByDay],
  );

  const weekTimes = useMemo(() => {
    const uniqueTimes = Array.from(new Set(filteredLessons.map((lesson) => formatTime(lesson.startsAt))));
    return uniqueTimes.sort((first, second) => first.localeCompare(second, "cs-CZ", { numeric: true }));
  }, [filteredLessons]);

  const activeReservations = reservations.filter((reservation) => reservation.status === "active");
  const waitingEntries = waitlist.filter((entry) => entry.status === "waiting");
  const hasActiveFilters = room !== allFilter || category !== allFilter || favoriteOnly || query.trim().length > 0;
  const mutationBlockReason = mutationOutcomeUncertain
    ? "reconciliation"
    : loadFailure
      ? "stale"
      : null;

  async function withBusy<T>(
    key: string,
    action: () => Promise<T>,
    success?: string,
    options: {
      refreshAfter?: boolean;
      preserveConfirmedResultOnRefreshFailure?: boolean;
      lockOnTransportFailure?: boolean;
    } = {},
  ) {
    const refreshAfter = options.refreshAfter ?? true;
    setBusy(key);
    try {
      const result = await action();
      if (refreshAfter) {
        try {
          await refresh();
        } catch (error) {
          if (!options.preserveConfirmedResultOnRefreshFailure) throw error;
          if (success) setToast({ message: success, tone: "success" });
          return result;
        }
      }
      if (success) setToast({ message: success, tone: "success" });
      return result;
    } catch (error) {
      const reconciliationRequired =
        error instanceof BookingApiClientError &&
        (
          error.code === "BOOKING_RECONCILIATION_REQUIRED" ||
          (options.lockOnTransportFailure === true && error.status === 0)
        );
      if (reconciliationRequired) {
        setMutationOutcomeUncertain(true);
      }
      const authenticationExpired =
        error instanceof BookingApiClientError &&
        error.status === 401 &&
        Boolean(snapshot?.user);
      if (authenticationExpired) {
        setSnapshot((current) => current ? {
          ...current,
          user: null,
          reservations: [],
          waitlist: [],
          transactions: [],
        } : current);
        setSelectedLesson(null);
        setSection("schedule");
        setModal("login");
        setToast({
          message: [
            t("toast.sessionExpired"),
            error.requestId ? t("error.supportReference", { requestId: error.requestId }) : "",
          ].filter(Boolean).join(" "),
          tone: "error",
        });
      } else {
        const message = error instanceof Error ? error.message : t("toast.actionError");
        setToast({
          message: [
            message,
            error instanceof BookingApiClientError && error.requestId
              ? t("error.supportReference", { requestId: error.requestId })
              : "",
          ].filter(Boolean).join(" "),
          tone: "error",
          persistent: reconciliationRequired,
        });
      }
      return null;
    } finally {
      setBusy(null);
    }
  }

  function mutationIsBlocked() {
    if (!mutationOutcomeUncertain && !loadFailure) return false;
    setToast({
      message: mutationOutcomeUncertain
        ? t("toast.reconciliationRequired")
        : t("toast.staleMutationBlocked"),
      tone: mutationOutcomeUncertain ? "error" : "warning",
      persistent: mutationOutcomeUncertain,
    });
    return true;
  }

  function openLesson(lesson: Lesson) {
    setSelectedLesson(lesson);
    setModal("lesson");
  }

  async function handleLogin(input: LoginInput) {
    const result = await withBusy(
      "login",
      () => bookingApiClient.login(input, locale),
      t("toast.login"),
    );
    if (result) setModal(null);
  }

  async function handleLogout() {
    await withBusy("logout", () => bookingApiClient.logout(locale), t("toast.logout"));
    setSection("schedule");
  }

  async function handleReservation(lesson: Lesson) {
    if (mutationIsBlocked()) return;
    if (!capabilities.reservationsEnabled) {
      setToast({ message: t("toast.bookingReadOnly"), tone: "warning" });
      return;
    }
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    if (!hasMinimumCredit(snapshot.user.creditBalanceKc, rules)) {
      setToast({
        message: t("toast.insufficientCredit", { amount: money(rules.minimumCreditForReservationKc, locale) }),
        tone: "warning",
      });
      return;
    }
    const result = await withBusy(
      `reserve-${lesson.id}`,
      () => bookingApiClient.createReservation(lesson.id, locale),
      t("toast.reserved", { lesson: displayLessonName(lesson, locale) }),
      { preserveConfirmedResultOnRefreshFailure: true, lockOnTransportFailure: true },
    );
    if (result) setModal(null);
  }

  async function handleCancel(reservation: Reservation) {
    if (mutationIsBlocked()) return;
    if (!capabilities.reservationsEnabled) {
      setToast({ message: t("toast.bookingReadOnly"), tone: "warning" });
      return;
    }
    const result = await withBusy(
      `cancel-${reservation.id}`,
      () => bookingApiClient.cancelReservation(reservation.id, locale),
      undefined,
      { preserveConfirmedResultOnRefreshFailure: true, lockOnTransportFailure: true },
    );
    if (!result) return;
    const fee = result.reservation.cancellationFeeKc;
    setToast({
      message: fee && fee > 0
        ? t("toast.cancelledWithFee", { fee: money(fee, locale) })
        : fee === 0
          ? t("toast.cancelledFree")
          : t("toast.cancelled"),
      tone: fee && fee > 0 ? "warning" : "success",
    });
  }

  async function handleWaitlist(lesson: Lesson) {
    if (mutationIsBlocked()) return;
    if (!capabilities.waitlistEnabled) {
      setToast({ message: t("toast.waitlistUnavailable"), tone: "warning" });
      return;
    }
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    const existing = waitlistFor(lesson, waitlist);
    const result = existing
      ? await withBusy(
        `waitlist-${lesson.id}`,
        () => bookingApiClient.leaveWaitlist(existing.id, locale),
        t("toast.waitlistLeft"),
        { preserveConfirmedResultOnRefreshFailure: true },
      )
      : await withBusy(
        `waitlist-${lesson.id}`,
        () => bookingApiClient.joinWaitlist(lesson.id, locale),
        t("toast.waitlistJoined"),
        { preserveConfirmedResultOnRefreshFailure: true },
      );
    if (result) setModal(null);
  }

  async function handleTopup(amount: number) {
    if (mutationIsBlocked()) return;
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    if (capabilities.topupMode === "stripe") {
      const checkout = await withBusy(
        `topup-${amount}`,
        () => bookingApiClient.createStripeCheckout(amount, locale),
        undefined,
        { refreshAfter: false },
      );
      if (checkout) window.location.assign(checkout.url);
      return;
    }
    await withBusy(
      `topup-${amount}`,
      () => bookingApiClient.createTopup(amount, locale),
      t("toast.topup", { amount: money(amount, locale) }),
      { preserveConfirmedResultOnRefreshFailure: true },
    );
  }

  function clearFilters() {
    setRoom(allFilter);
    setCategory(allFilter);
    setFavoriteOnly(false);
    setQuery("");
  }

  function toggleFavorite(lesson: Lesson) {
    setFavoriteServiceIds((current) => {
      const key = favoriteKey(lesson);
      const isFavorite = current.includes(key);
      const next = isFavorite
        ? current.filter((favoriteId) => favoriteId !== key)
        : [...current, key];
      const owner = snapshot?.user?.id ?? "anonymous";
      const persisted = writeStoredFavoriteServices(owner, next);
      setToast({
        message: persisted
          ? isFavorite ? t("toast.favoriteRemoved") : t("toast.favoriteAdded")
          : t("toast.favoriteStorageUnavailable"),
        tone: persisted ? "success" : "warning",
      });
      return next;
    });
  }

  async function retrySnapshot() {
    setBusy("refresh");
    if (!snapshot) setLoading(true);
    try {
      await refresh();
    } catch {
      // refresh stores a persistent, privacy-safe failure state.
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={34} />
        <p>{t("loading")}</p>
      </main>
    );
  }

  if (!snapshot && loadFailure) {
    return (
      <main className="load-error-screen" role="alert" aria-live="assertive">
        <div className="load-error-card">
          <div className="load-error-icon" aria-hidden="true">!</div>
          <h1>{t("error.loadTitle")}</h1>
          <p>{t("error.loadBody")}</p>
          {loadFailure.requestId && (
            <p className="support-reference">{t("error.supportReference", { requestId: loadFailure.requestId })}</p>
          )}
          <button className="btn btn-primary" type="button" onClick={retrySnapshot} disabled={busy === "refresh"}>
            {busy === "refresh" ? <Loader2 className="spin" size={16} /> : null}
            {t("error.retry")}
          </button>
          <div className="language-switch load-error-language" aria-label="Language">
            <button className={locale === "cs" ? "active" : ""} onClick={() => setLocale("cs")} aria-pressed={locale === "cs"}>
              CS
            </button>
            <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>
              EN
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="header">
        <div className="header-content">
          <button className="logo" onClick={() => setSection("schedule")}>
            <div className="logo-icon">Z4Y</div>
            <span>Zone4You</span>
          </button>

          <div className="user-section">
            <button
              className={`btn btn-outline header-nav-button ${section === "schedule" ? "active" : ""}`}
              onClick={() => setSection("schedule")}
            >
              {t("nav.schedule")}
            </button>
            <button
              className={`btn btn-outline header-nav-button ${section === "reservations" ? "active" : ""}`}
              onClick={() => setSection("reservations")}
            >
              {t("nav.reservations")}
            </button>
            <button
              className={`btn btn-outline header-nav-button ${section === "credit" ? "active" : ""}`}
              onClick={() => setSection("credit")}
            >
              {t("nav.credit")}
            </button>
            {snapshot?.user && (
              <button
                className={`btn btn-outline header-nav-button ${section === "profile" ? "active" : ""}`}
                onClick={() => setSection("profile")}
              >
                {t("nav.profile")}
              </button>
            )}
            {snapshot?.user ? (
              <>
                <div className="credit-display">{money(snapshot.user.creditBalanceKc, locale)}</div>
                <button className="btn btn-primary auth-button" onClick={handleLogout}>
                  {t("auth.logout")}
                </button>
              </>
            ) : (
              <button className="btn btn-primary auth-button" onClick={() => setModal("login")}>
                {t("auth.login")}
              </button>
            )}
            <div className="language-switch" aria-label="Language">
              <button className={locale === "cs" ? "active" : ""} onClick={() => setLocale("cs")} aria-pressed={locale === "cs"}>
                CS
              </button>
              <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} aria-pressed={locale === "en"}>
                EN
              </button>
            </div>
          </div>
        </div>
      </header>

      {capabilities.businessRulesStatus === "demo" && (
        <div className="demo-banner" role="status">
          <span className="demo-banner-full">
            <strong>{t("demo.label")}</strong>
            <span>{t("demo.description")}</span>
          </span>
          <strong className="demo-banner-mobile">{t("demo.mobile")}</strong>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            {toast.message}
          </div>
        </div>
      )}

      {loadFailure && snapshot && (
        <div className="runtime-error-banner" role="alert">
          <div>
            <strong>{t("error.staleTitle")}</strong>
            <span>{t("error.staleBody")}</span>
            {loadFailure.requestId && (
              <span className="support-reference">{t("error.supportReference", { requestId: loadFailure.requestId })}</span>
            )}
          </div>
          <button className="btn btn-outline" type="button" onClick={retrySnapshot} disabled={busy === "refresh"}>
            {busy === "refresh" ? <Loader2 className="spin" size={16} /> : null}
            {t("error.retry")}
          </button>
        </div>
      )}

      <main className="main">
        {section === "schedule" && (
          <section id="scheduleSection">
            <div className="view-section">
              <div className="view-toggle" aria-label={t("view.scheduleLabel")}>
                <button className={`view-btn ${view === "day" ? "active" : ""}`} onClick={() => setView("day")}>
                  {t("view.day")}
                </button>
                <button className={`view-btn ${view === "week" ? "active" : ""}`} onClick={() => setView("week")}>
                  {t("view.week")}
                </button>
              </div>

              <div className="day-selector" aria-label={t("view.dayPickerLabel")}>
                {days.map((day) => (
                  <button
                    key={day}
                    className={`day-btn ${selectedDay === day ? "active" : ""} ${todayKey === day ? "today" : ""}`}
                    onClick={() => {
                      setSelectedDay(day);
                      setView("day");
                    }}
                  >
                    {formatDay(day, locale, "short")}
                  </button>
                ))}
              </div>
            </div>

            <div className="legend" aria-label={t("filter.roomLabel")}>
              {rooms.map((item) => (
                <button
                  key={item}
                  className={`legend-item ${room === item ? "active" : ""}`}
                  onClick={() => setRoom(item)}
                  type="button"
                >
                  <span className={`legend-dot ${item === allFilter ? "room-all" : roomClass(item)}`} />
                  {item === allFilter ? t("filter.all") : displayRoomName(item, locale)}
                </button>
              ))}
            </div>

            <div className="filter-section">
              <span className="filter-label">{t("filter.lessonType")}</span>
              <div className="filter-chips" aria-label={t("filter.lessonType")}>
                {categories.map((item) => (
                  <button key={item} className={`filter-chip ${category === item ? "active" : ""}`} onClick={() => setCategory(item)}>
                    {item === allFilter ? t("filter.all") : displayCategory(item, locale)}
                  </button>
                ))}
                <button
                  className={`filter-chip favorite-filter ${favoriteOnly ? "active" : ""}`}
                  onClick={() => setFavoriteOnly((current) => !current)}
                  type="button"
                >
                  <Star size={14} />
                  {t("filter.favorites")}
                </button>
              </div>
              <label className="schedule-search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filter.search")} />
              </label>
              {hasActiveFilters && (
                <button className="filter-reset" onClick={clearFilters}>
                  {t("filter.clear")}
                </button>
              )}
            </div>

            {view === "day" && (
              <div className="schedule-day active">
                {visibleDayGroups.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title={t("filter.empty")} actionLabel={t("filter.clear")} onAction={clearFilters} />
                ) : (
                  visibleDayGroups.map(({ day, lessons: dayLessons }) => (
                    <div key={day} className="day-block">
                      <h2 className="section-title">{formatDay(day, locale, "long")}</h2>
                      {groupLessonsByTime(dayLessons).map((group) => (
                        <div className="time-group" key={group.time}>
                          <div className="time-group-header">{group.time}</div>
                          {group.lessons.map((lesson) => (
                            <LessonRow
                              key={lesson.id}
                              lesson={lesson}
                              rules={rules}
                              reservationsEnabled={capabilities.reservationsEnabled}
                              reservation={reservationFor(lesson, reservations)}
                              waitlistEntry={waitlistFor(lesson, waitlist)}
                              isFavorite={favoriteServiceIds.includes(favoriteKey(lesson))}
                              locale={locale}
                              t={t}
                              onOpen={() => openLesson(lesson)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {view === "week" && (
              <div className="schedule-week active">
                {filteredLessons.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title={t("filter.empty")} actionLabel={t("filter.clear")} onAction={clearFilters} />
                ) : (
                  <>
                    <table className="week-table">
                      <colgroup>
                        <col className="week-time-col" />
                        {days.map((day) => (
                          <col key={day} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          <th>{t("table.time")}</th>
                          {days.map((day) => (
                            <th key={day} className={todayKey === day ? "today-col" : ""}>
                              {formatDay(day, locale, "short")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weekTimes.map((time) => (
                          <tr key={time}>
                            <td>{time}</td>
                            {days.map((day) => {
                              const cellLessons = filteredLessons.filter(
                                (lesson) => dateKey(lesson.startsAt) === day && formatTime(lesson.startsAt) === time,
                              );
                              return (
                                <td key={`${day}-${time}`}>
                                  {cellLessons.map((lesson) => (
                                    <button
                                      key={lesson.id}
                                      className={`week-lesson ${roomClass(lesson.roomName)}`}
                                      onClick={() => openLesson(lesson)}
                                    >
                                      <span className="week-lesson-name">{displayLessonName(lesson, locale)}</span>
                                      <span className="week-lesson-time">
                                        {formatTime(lesson.startsAt)} - {formatTime(lesson.endsAt)}
                                      </span>
                                    </button>
                                  ))}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="week-mobile-list">
                      {visibleLessonsByDay
                        .filter(({ lessons: dayLessons }) => dayLessons.length > 0)
                        .map(({ day, lessons: dayLessons }) => (
                          <section className="week-mobile-day" key={day}>
                            <h2 className="section-title">{formatDay(day, locale, "long")}</h2>
                            <div className="time-group">
                              {dayLessons.map((lesson) => (
                                <LessonRow
                                  key={lesson.id}
                                  lesson={lesson}
                                  rules={rules}
                                  reservationsEnabled={capabilities.reservationsEnabled}
                                  reservation={reservationFor(lesson, reservations)}
                                  waitlistEntry={waitlistFor(lesson, waitlist)}
                                  isFavorite={favoriteServiceIds.includes(favoriteKey(lesson))}
                                  locale={locale}
                                  t={t}
                                  onOpen={() => openLesson(lesson)}
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {section === "reservations" && (
          <section className="my-reservations active">
            <h2 className="section-title">{t("reservations.title")}</h2>
            {!snapshot?.user ? (
              <EmptyState
                icon={<LockKeyhole />}
                title={t("reservations.loginRequired")}
                actionLabel={t("auth.login")}
                onAction={() => setModal("login")}
              />
            ) : (
              <div className="reservations-list">
                {activeReservations.length === 0 && waitingEntries.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title={t("reservations.empty")} />
                ) : (
                  <>
                    {activeReservations.map((reservation) => {
                      const lesson = lessonById.get(reservation.lessonId);
                      const cancellationOpen = capabilities.reservationsEnabled && lesson
                        ? canCancelLessonAt(lesson, rules)
                        : false;
                      const policyVisible = ["demo", "confirmed"].includes(capabilities.businessRulesStatus);
                      const reformerDemoPolicyPending = capabilities.businessRulesStatus === "demo" && Boolean(lesson && isReformerLesson(lesson));
                      return (
                        <div className="reservation-card" key={reservation.id}>
                          <div className="reservation-info">
                            <h4>{activeReservationLabel(reservation, lesson, locale, t)}</h4>
                            <p>
                              {lesson
                                ? policyVisible
                                  ? t("reservations.holdAndPrice", { room: displayRoomName(lesson.roomName, locale), hold: money(reservationHold(reservation, rules), locale), price: money(reservation.priceKc, locale) })
                                  : t("reservations.roomAndPrice", { room: displayRoomName(lesson.roomName, locale), price: money(reservation.priceKc, locale) })
                                : policyVisible
                                  ? t("reservations.hold", { hold: money(reservationHold(reservation, rules), locale) })
                                  : t("reservations.priceOnly", { price: money(reservation.priceKc, locale) })}
                            </p>
                            {lesson && policyVisible && !reformerDemoPolicyPending && (
                              <span className="reservation-note">
                                {t("reservations.freeCancelUntil", { deadline: formatDateTime(freeCancellationDeadlineForLesson(lesson, rules), locale) })}
                              </span>
                            )}
                            {capabilities.businessRulesStatus !== "confirmed" && (
                              <span className="reservation-note">
                                {capabilities.businessRulesStatus === "demo"
                                  ? reformerDemoPolicyPending
                                    ? t("reservations.reformerPolicyPending")
                                    : t("reservations.demoPolicy")
                                  : t("reservations.policyPending")}
                              </span>
                            )}
                          </div>
                          <button
                            className="btn-cancel"
                            disabled={Boolean(mutationBlockReason) || !cancellationOpen || busy === `cancel-${reservation.id}`}
                            onClick={() => handleCancel(reservation)}
                          >
                            {!capabilities.reservationsEnabled
                              ? t("reservations.temporarilyUnavailable")
                              : mutationBlockReason === "reconciliation"
                                ? t("lesson.reconciliationRequired")
                                : mutationBlockReason === "stale"
                                  ? t("lesson.refreshRequired")
                                  : !cancellationOpen
                                    ? t("reservations.cancelClosed")
                                    : busy === `cancel-${reservation.id}`
                                      ? t("reservations.cancelling")
                                      : t("reservations.cancel")}
                          </button>
                        </div>
                      );
                    })}

                    {waitingEntries.map((entry) => {
                      const lesson = lessonById.get(entry.lessonId);
                      if (!lesson) return null;
                      return (
                        <div className="reservation-card waitlist-card" key={entry.id}>
                          <div className="reservation-info">
                            <h4>{displayLessonName(lesson, locale)}</h4>
                            <p>
                              {t("reservations.waitlistPosition", { position: entry.position, date: formatDateTime(lesson.startsAt, locale) })}
                            </p>
                          </div>
                          <button className="btn btn-outline" disabled={Boolean(mutationBlockReason) || !capabilities.waitlistEnabled || busy === `waitlist-${lesson.id}`} onClick={() => handleWaitlist(lesson)}>
                            {t("reservations.remove")}
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {section === "credit" && (
          <section className="my-reservations active">
            <div className="credit-header">
              <h2 className="section-title">{t("credit.title")}</h2>
              <div className="credit-balance">{snapshot?.user ? money(snapshot.user.creditBalanceKc, locale) : t("credit.notLoggedIn")}</div>
            </div>

            {paymentReturn && (
              <div className={`payment-return ${paymentReturn}`} role="status">
                {paymentReturn === "success" ? <Clock size={20} /> : <X size={20} />}
                <span>{t(paymentReturn === "success" ? "toast.paymentPending" : "toast.paymentCancelled")}</span>
                <button type="button" onClick={() => setPaymentReturn(null)} aria-label={t("common.close")}>
                  <X size={18} />
                </button>
              </div>
            )}

            <div className="credit-grid">
              <div className="credit-card">
                <h3>{t("credit.topup")}</h3>
                {capabilities.topupsEnabled ? (
                  <div className="topup-grid">
                    {rules.topupAmounts.map((amount) => (
                      <button key={amount} className="btn btn-outline" onClick={() => handleTopup(amount)} disabled={Boolean(mutationBlockReason) || busy === `topup-${amount}`}>
                        {busy === `topup-${amount}` ? <Loader2 className="spin" size={16} /> : <CreditCard size={16} />}
                        {money(amount, locale)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="feature-unavailable">{t("credit.topupUnavailable")}</p>
                )}
              </div>

              <div className="credit-card">
                <h3>{t("credit.history")}</h3>
                {snapshot?.transactions.length ? (
                  <div className="transactions-list">
                    {snapshot.transactions.slice(0, 6).map((transaction) => (
                      <div className="transaction-row" key={transaction.id}>
                        <div>
                          <strong>{transaction.note ?? transaction.type}</strong>
                          <span>{formatDateTime(transaction.occurredAt, locale)}</span>
                        </div>
                        <b className={transaction.amountKc >= 0 ? "plus" : "minus"}>
                          {transaction.amountKc >= 0 ? "+" : ""}
                          {money(transaction.amountKc, locale)}
                        </b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<WalletCards />} title={t("credit.historyLogin")} compact />
                )}
              </div>
            </div>
          </section>
        )}

        {section === "profile" && (
          <section className="my-reservations active">
            <h2 className="section-title">{t("profile.title")}</h2>
            {snapshot?.user ? (
              <div className="profile-grid">
                <div className="profile-card">
                  <div className="avatar">{snapshot.user.fullName.slice(0, 2).toUpperCase()}</div>
                  <h3>{snapshot.user.fullName}</h3>
                  <p>{snapshot.user.membership}</p>
                </div>
                <dl className="profile-details">
                  <div>
                    <dt>{t("profile.email")}</dt>
                    <dd>{snapshot.user.email}</dd>
                  </div>
                  <div>
                    <dt>{t("profile.phone")}</dt>
                    <dd>{snapshot.user.phone}</dd>
                  </div>
                  <div>
                    <dt>{t("profile.credit")}</dt>
                    <dd>{money(snapshot.user.creditBalanceKc, locale)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <EmptyState icon={<UserRound />} title={t("profile.login")} actionLabel={t("auth.login")} onAction={() => setModal("login")} />
            )}
          </section>
        )}
      </main>

      <nav className="mobile-tabbar" aria-label={t("nav.label")}>
        <button className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}>
          <CalendarDays size={18} />
          <span>{t("nav.schedule")}</span>
        </button>
        <button className={section === "reservations" ? "active" : ""} onClick={() => setSection("reservations")}>
          <Check size={18} />
          <span>{t("nav.reservationsShort")}</span>
        </button>
        <button className={section === "credit" ? "active" : ""} onClick={() => setSection("credit")}>
          <WalletCards size={18} />
          <span>{t("nav.credit")}</span>
        </button>
        {snapshot?.user && (
          <button className={section === "profile" ? "active" : ""} onClick={() => setSection("profile")}>
            <UserRound size={18} />
            <span>{t("nav.profile")}</span>
          </button>
        )}
      </nav>

      {modal === "login" && <LoginModal busy={busy} onClose={() => setModal(null)} onLogin={handleLogin} />}

      {modal === "lesson" && selectedLesson && (
        <LessonModal
          lesson={selectedLesson}
          rules={rules}
          reservationsEnabled={capabilities.reservationsEnabled}
          waitlistEnabled={capabilities.waitlistEnabled}
          businessRulesStatus={capabilities.businessRulesStatus}
          mutationBlockReason={mutationBlockReason}
          reservation={reservationFor(selectedLesson, reservations)}
          waitlistEntry={waitlistFor(selectedLesson, waitlist)}
          isFavorite={favoriteServiceIds.includes(favoriteKey(selectedLesson))}
          isLoggedIn={Boolean(snapshot?.user)}
          creditBalanceKc={snapshot?.user?.creditBalanceKc}
          busy={busy}
          onClose={() => setModal(null)}
          onReserve={() => handleReservation(selectedLesson)}
          onWaitlist={() => handleWaitlist(selectedLesson)}
          onToggleFavorite={() => toggleFavorite(selectedLesson)}
          onLogin={() => setModal("login")}
        />
      )}
    </>
  );
}

function LessonRow({
  lesson,
  rules,
  reservationsEnabled,
  reservation,
  waitlistEntry,
  isFavorite,
  locale,
  t,
  onOpen,
}: {
  lesson: Lesson;
  rules: BookingRules;
  reservationsEnabled: boolean;
  reservation?: Reservation;
  waitlistEntry?: WaitlistEntry;
  isFavorite: boolean;
  locale: Locale;
  t: Translate;
  onOpen: () => void;
}) {
  const state = occupancyState(lesson, t);
  const booked = Boolean(reservation);
  const listed = Boolean(waitlistEntry);
  const reservable = canReserve(lesson, rules);

  return (
    <button className="lesson-row" onClick={onOpen}>
      <div className="lesson-time">
        <span>{formatTime(lesson.startsAt)}</span>
        <small>{formatTime(lesson.endsAt)}</small>
      </div>
      <div className={`lesson-info ${roomClass(lesson.roomName)}`}>
        <div className="lesson-name">{displayLessonName(lesson, locale)}</div>
        <div className="lesson-meta">
          {displayInstructorName(lesson.instructorName, locale)} • {displayRoomName(lesson.roomName, locale)} • {money(lesson.priceKc, locale)}
        </div>
      </div>
      <div className="lesson-badges">
        {booked && (
          <span className="reservation-badge">
            <Check size={13} />
            {t("status.reserved")}
          </span>
        )}
        {listed && (
          <span className="reservation-badge wait">
            <Clock size={13} />
            {t("status.waitlist", { position: waitlistEntry?.position ?? "" })}
          </span>
        )}
        {isFavorite && <Star className="favorite-indicator" size={15} fill="currentColor" aria-hidden="true" />}
        {!booked && !listed && (!reservationsEnabled || !reservable) && (
          <span className="reservation-badge muted">
            {reservationsEnabled ? t("status.reservationLater") : t("status.bookingUnavailable")}
          </span>
        )}
        <span className={`lesson-status ${occupancyClass(lesson, t)}`}>{state.label}</span>
      </div>
    </button>
  );
}

function LoginModal({
  busy,
  onClose,
  onLogin,
}: {
  busy: string | null;
  onClose: () => void;
  onLogin: (input: LoginInput) => void;
}) {
  const { t } = useI18n();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const titleId = useId();
  const { dialogRef, onDialogKeyDown } = useAccessibleModal(onClose, "[data-modal-initial-focus]");

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin({ login, password });
  }

  return (
    <div
      className="modal-overlay open"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onDialogKeyDown}
    >
      <div className="modal login-modal">
        <div className="modal-header">
          <h3 className="modal-title" id={titleId}>{t("login.title")}</h3>
          <button className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="login-help">
            {t("login.help")}
          </p>
          <form className="login-form" onSubmit={submitLogin}>
            <label className="login-field">
              <span>{t("login.surname")}</span>
              <input
                data-modal-initial-focus
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                maxLength={254}
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
              />
            </label>
            <label className="login-field">
              <span>{t("login.password")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                maxLength={128}
                autoComplete="current-password"
              />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline" type="button" onClick={onClose}>
                {t("common.close")}
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy === "login"}>
                {busy === "login" ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
                {t("auth.login")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function LessonModal({
  lesson,
  rules,
  reservationsEnabled,
  waitlistEnabled,
  businessRulesStatus,
  mutationBlockReason,
  reservation,
  waitlistEntry,
  isFavorite,
  isLoggedIn,
  creditBalanceKc,
  busy,
  onClose,
  onReserve,
  onWaitlist,
  onToggleFavorite,
  onLogin,
}: {
  lesson: Lesson;
  rules: BookingRules;
  reservationsEnabled: boolean;
  waitlistEnabled: boolean;
  businessRulesStatus: BookingCapabilities["businessRulesStatus"];
  mutationBlockReason: "stale" | "reconciliation" | null;
  reservation?: Reservation;
  waitlistEntry?: WaitlistEntry;
  isFavorite: boolean;
  isLoggedIn: boolean;
  creditBalanceKc?: number;
  busy: string | null;
  onClose: () => void;
  onReserve: () => void;
  onWaitlist: () => void;
  onToggleFavorite: () => void;
  onLogin: () => void;
}) {
  const { locale, t } = useI18n();
  const state = occupancyState(lesson, t);
  const isFull = state.free === 0;
  const reservable = canReserve(lesson, rules);
  const hasEnoughCredit = creditBalanceKc !== undefined && hasMinimumCredit(creditBalanceKc, rules);
  const actionBusy = busy === `reserve-${lesson.id}` || busy === `waitlist-${lesson.id}`;
  const policyVisible = ["demo", "confirmed"].includes(businessRulesStatus);
  const reformerDemoPolicyPending = businessRulesStatus === "demo" && isReformerLesson(lesson);
  const titleId = useId();
  const { dialogRef, onDialogKeyDown } = useAccessibleModal(onClose, "[data-modal-initial-focus]");

  return (
    <div
      className="modal-overlay open"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onDialogKeyDown}
    >
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title" id={titleId}>{displayLessonName(lesson, locale)}</h3>
          <div className="modal-header-actions">
            <button
              className={`modal-favorite ${isFavorite ? "active" : ""}`}
              onClick={onToggleFavorite}
              aria-label={isFavorite ? t("favorite.remove") : t("favorite.add")}
              aria-pressed={isFavorite}
            >
              <Star size={18} fill={isFavorite ? "currentColor" : "none"} />
            </button>
            <button
              className="modal-close"
              data-modal-initial-focus
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="modal-body">
          <div className="modal-instructor-section">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="modal-instructor-photo" src={lesson.instructorPhoto} alt="" />
            <div className="modal-instructor-info">
              <h4>{displayInstructorName(lesson.instructorName, locale)}</h4>
              <p>{displaySpecialization(lesson, locale)}</p>
            </div>
          </div>

          <div className="modal-description">
            <div className="modal-description-title">{t("lesson.about")}</div>
            <div className="modal-description-text">{displayLessonDescription(lesson, locale)}</div>
          </div>

          <div className="modal-info">
            <div className="modal-info-row">
              <span className="modal-info-label">{t("lesson.time")}</span>
              <span className="modal-info-value">
                {formatTime(lesson.startsAt)} - {formatTime(lesson.endsAt)}
              </span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">{t("lesson.day")}</span>
              <span className="modal-info-value">{formatDateTime(lesson.startsAt, locale)}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">{t("lesson.room")}</span>
              <span className="modal-info-value">{displayRoomName(lesson.roomName, locale)}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">{t("lesson.freePlaces")}</span>
              <span className="modal-info-value">
                {state.free}/{lesson.capacity}
              </span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">{t("lesson.price")}</span>
              <span className="modal-info-value">{money(lesson.priceKc, locale)}</span>
            </div>
            {policyVisible && (
              <div className="modal-info-row">
                <span className="modal-info-label">{t("lesson.creditHold")}</span>
                <span className="modal-info-value">{money(rules.reservationHoldKc, locale)}</span>
              </div>
            )}
            {policyVisible && !reformerDemoPolicyPending ? (
                <div className="modal-info-row">
                  <span className="modal-info-label">{t("lesson.cancelOnline")}</span>
                  <span className="modal-info-value">
                    {t("lesson.freeCancelUntil", { date: formatDateTime(freeCancellationDeadlineForLesson(lesson, rules), locale) })}
                  </span>
                </div>
            ) : reformerDemoPolicyPending ? (
              <div className="modal-info-row">
                <span className="modal-info-label">{t("lesson.bookingPolicy")}</span>
                <span className="modal-info-value">{t("lesson.reformerPolicyPending")}</span>
              </div>
            ) : (
              <div className="modal-info-row">
                <span className="modal-info-label">{t("lesson.bookingPolicy")}</span>
                <span className="modal-info-value">{t("lesson.policyPending")}</span>
              </div>
            )}
            {businessRulesStatus === "demo" && !reformerDemoPolicyPending && (
              <div className="modal-info-row">
                <span className="modal-info-label">{t("lesson.bookingPolicy")}</span>
                <span className="modal-info-value">{t("lesson.demoPolicy")}</span>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose}>
              {t("common.close")}
            </button>
            {!isLoggedIn ? (
              <button className="btn btn-primary" onClick={onLogin}>
                <LockKeyhole size={16} />
                {t("auth.login")}
              </button>
            ) : !reservationsEnabled ? (
              <button className="btn btn-outline" disabled>
                {t("lesson.bookingUnavailable")}
              </button>
            ) : mutationBlockReason ? (
              <button className="btn btn-outline" disabled>
                {mutationBlockReason === "reconciliation"
                  ? t("lesson.reconciliationRequired")
                  : t("lesson.refreshRequired")}
              </button>
            ) : reservation ? (
              <button className="btn btn-outline" disabled>
                <Check size={16} />
                {t("status.reserved")}
              </button>
            ) : businessRulesStatus !== "demo" && lesson.canCurrentUserReserve === false ? (
              <button className="btn btn-outline" disabled>
                {t("lesson.notEligible")}
              </button>
            ) : businessRulesStatus !== "demo" && lesson.canCurrentUserReserve === undefined ? (
              <button className="btn btn-outline" disabled>
                {t("lesson.eligibilityUnavailable")}
              </button>
            ) : isFull && waitlistEnabled ? (
              <button className="btn btn-primary" onClick={onWaitlist} disabled={actionBusy}>
                {actionBusy ? <Loader2 className="spin" size={16} /> : <Clock size={16} />}
                {waitlistEntry ? t("lesson.waitlistLeave", { position: waitlistEntry.position }) : t("lesson.waitlistJoin")}
              </button>
            ) : isFull || !reservable ? (
              <button className="btn btn-outline" disabled>
                {t("lesson.reservationLater")}
              </button>
            ) : !hasEnoughCredit ? (
              <button className="btn btn-outline" disabled>
                {t("lesson.insufficientCredit", { amount: money(rules.minimumCreditForReservationKc, locale) })}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onReserve} disabled={actionBusy}>
                {actionBusy ? <Loader2 className="spin" size={16} /> : <DoorOpen size={16} />}
                {t("lesson.reserve")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  actionLabel,
  onAction,
  compact,
}: {
  icon: ReactNode;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {actionLabel && onAction && (
        <button className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
