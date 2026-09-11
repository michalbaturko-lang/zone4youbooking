export const zone4YouTimeZone = "Europe/Prague";

const zone4YouDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone4YouTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function zone4YouDateKey(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Zone4You date.");
  const parts = Object.fromEntries(
    zone4YouDateFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addZone4YouCalendarDays(dayKey: string, offset: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match || !Number.isInteger(offset)) throw new Error("Invalid Zone4You calendar date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const base = new Date(Date.UTC(year, month - 1, day, 12));
  if (base.toISOString().slice(0, 10) !== dayKey) {
    throw new Error("Invalid Zone4You calendar date.");
  }
  return new Date(Date.UTC(year, month - 1, day + offset, 12)).toISOString().slice(0, 10);
}

function zone4YouLocalParts(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone4YouTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

export function zone4YouStartOfDay(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) throw new Error("Invalid Zone4You calendar date.");
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  };
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  if (new Date(targetAsUtc).toISOString().slice(0, 10) !== dayKey) {
    throw new Error("Invalid Zone4You calendar date.");
  }

  // Resolve the IANA time zone iteratively instead of assuming a fixed UTC
  // offset. This remains correct on Prague daylight-saving transition days.
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = zone4YouLocalParts(new Date(candidate));
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const adjustment = targetAsUtc - localAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate).toISOString();
}

export function zone4YouScheduleRange(now = new Date(), days = 7) {
  if (!Number.isInteger(days) || days < 1 || days > 31) {
    throw new Error("Zone4You schedule range must contain 1 to 31 calendar days.");
  }
  const fromDay = zone4YouDateKey(now);
  const toDay = addZone4YouCalendarDays(fromDay, days);
  return {
    // Luxart consumes the YYYY-MM-DD part. UTC midnight keeps the interval
    // length deterministic across Prague daylight-saving transitions.
    from: `${fromDay}T00:00:00.000Z`,
    to: `${toDay}T00:00:00.000Z`,
  };
}
