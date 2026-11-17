// Validate the BFF boundary before a successful response becomes render state.
// TypeScript types alone do not protect against truncated proxy responses or
// an incompatible deployed build returning a different JSON shape.
import { parseExplicitLuxartDateTime } from "./luxartContract";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function texts(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "string");
}
function numbers(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}
function list(value: unknown, valid: (item: Record<string, unknown>) => boolean) {
  return Array.isArray(value) && value.every((item) => object(item) && valid(item));
}
function cutoff(value: unknown) {
  return object(value) && (
    (value.mode === "lesson_day_midnight" && value.timeZone === "Europe/Prague") ||
    (value.mode === "hours_before_start" && Number.isInteger(value.hours) && Number(value.hours) > 0)
  );
}
function policy(value: Record<string, unknown>) {
  return cutoff(value.freeCancellationCutoff) && numbers(value, ["lateCancelFeeKc", "noShowFeeKc"]) &&
    typeof value.lateCancellationAllowed === "boolean";
}

export function isBookingSnapshotResponse(value: unknown): boolean {
  if (!object(value) || !object(value.rules) || !object(value.capabilities)) return false;
  const r = value.rules;
  const c = value.capabilities;
  if (!numbers(r, ["minimumCreditForReservationKc", "reservationHoldKc", "reservationWindowHours", "resortId"]) ||
    !Number.isInteger(r.scheduleDays) || Number(r.scheduleDays) < 1 || Number(r.scheduleDays) > 31 ||
    !policy(r) || !object(r.reformerCancellation) ||
    !(r.reformerCancellation.mode === "same_as_group" || (r.reformerCancellation.mode === "custom" && policy(r.reformerCancellation))) ||
    !Array.isArray(r.topupAmounts) || !r.topupAmounts.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0) ||
    !["reservationsEnabled", "waitlistEnabled", "topupsEnabled", "forgotPasswordEnabled", "englishEnabled"].every((k) => typeof c[k] === "boolean") ||
    !["demo", "stripe", "disabled"].includes(String(c.topupMode)) ||
    !["demo", "confirmed", "unconfirmed"].includes(String(c.businessRulesStatus)) || c.favoritesSync !== "device") return false;
  if (value.user !== null && (!object(value.user) || !texts(value.user, ["id", "login", "fullName", "email"]) ||
    !numbers(value.user, ["creditBalanceKc"]) ||
    !["phone", "membership", "memberCardNumber"].every((k) => value.user && object(value.user) && (value.user[k] === undefined || typeof value.user[k] === "string")))) return false;
  return list(value.lessons, (l) =>
    texts(l, ["id", "name", "description", "roomName", "category", "instructorName", "instructorSpecialization"]) &&
    numbers(l, ["durationMinutes", "capacity", "occupiedCount", "priceKc"]) &&
    Boolean(parseExplicitLuxartDateTime(l.startsAt)) && Boolean(parseExplicitLuxartDateTime(l.endsAt)) &&
    typeof l.waitlistEnabled === "boolean" &&
    (l.canCurrentUserReserve === undefined || typeof l.canCurrentUserReserve === "boolean")) &&
    list(value.reservations, (r) => texts(r, ["id", "userId", "lessonId"]) &&
      ["active", "cancelled", "attended", "no_show"].includes(String(r.status)) && numbers(r, ["priceKc"]) && Boolean(parseExplicitLuxartDateTime(r.reservedAt))) &&
    list(value.waitlist, (w) => texts(w, ["id", "userId", "lessonId"]) && numbers(w, ["position"]) &&
      ["waiting", "promoted", "left", "expired"].includes(String(w.status))) &&
    list(value.transactions, (t) => texts(t, ["id", "userId", "type"]) && numbers(t, ["amountKc", "balanceAfterKc"]) &&
      Boolean(parseExplicitLuxartDateTime(t.occurredAt)) && (t.note === undefined || typeof t.note === "string"));
}
