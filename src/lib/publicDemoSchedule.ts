import snapshot from "../../config/public-schedule-snapshot.json";
import type { DemoScheduleSource, Lesson } from "./domain";
import { bookingRules } from "./bookingRules";
import { addZone4YouCalendarDays, zone4YouDateKey } from "./zone4YouTime";

export function usesPublicDemoSchedule(environment = process.env) {
  return environment.LUXART_MOCK !== "false" && environment.ZONE4YOU_DEMO_SCHEDULE === "public_snapshot";
}

export function publicDemoScheduleReady(now = new Date()) {
  const today = zone4YouDateKey(now);
  return today >= snapshot.validFrom &&
    addZone4YouCalendarDays(today, bookingRules.scheduleDays - 1) <= snapshot.validTo;
}

export function demoScheduleVersion() {
  return usesPublicDemoSchedule()
    ? `public:${snapshot.sources.map((source) => source.sha256.slice(0, 16)).join(":")}`
    : "synthetic-v1";
}

export function publicDemoScheduleSource(): DemoScheduleSource | undefined {
  if (!usesPublicDemoSchedule()) return undefined;
  return {
    url: snapshot.sourceUrl,
    capturedAt: snapshot.capturedAt,
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    version: demoScheduleVersion(),
  };
}

export function publicDemoLessons(): Lesson[] {
  return snapshot.lessons.map(({ resourceId: _resourceId, ...lesson }) => ({
    ...lesson,
    description: "Lekce převzatá z veřejného rozvrhu Zone4you.",
    instructorSpecialization: "",
    category: lesson.roomName === "Reformer" ? "Reformer" : "Lekce",
    // No prices are exposed in the public scheduler. Zero is an internal
    // placeholder only; pricePublished=false prevents displaying it as free.
    priceKc: 0,
    pricePublished: false,
    reservationOpensAt: new Date(Date.parse(lesson.startsAt) - bookingRules.reservationWindowHours * 3_600_000).toISOString(),
    reservationClosesAt: lesson.startsAt,
    waitlistEnabled: true,
  }));
}
