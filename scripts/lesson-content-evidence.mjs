import { createHash } from "node:crypto";

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalText(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string when present.`);
  return value;
}

function optionalPositiveInteger(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer when present.`);
  return value;
}

function optionalDateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(requiredText(value, label));
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp when present.`);
  return date.toISOString();
}

export function lessonContentSetSha256(lessons, label) {
  if (!Array.isArray(lessons)) throw new Error(`${label} must be a lesson array.`);

  const rows = lessons.map((lesson, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!lesson || typeof lesson !== "object" || Array.isArray(lesson)) {
      throw new Error(`${itemLabel} must be a lesson object.`);
    }
    const startsAt = new Date(requiredText(lesson.startsAt, `${itemLabel}.startsAt`));
    const endsAt = new Date(requiredText(lesson.endsAt, `${itemLabel}.endsAt`));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new Error(`${itemLabel} must contain a valid increasing time interval.`);
    }
    if (!Number.isSafeInteger(lesson.durationMinutes) || lesson.durationMinutes < 1) {
      throw new Error(`${itemLabel}.durationMinutes must be a positive integer.`);
    }
    if (endsAt.getTime() - startsAt.getTime() !== lesson.durationMinutes * 60_000) {
      throw new Error(`${itemLabel}.durationMinutes must match the lesson interval.`);
    }
    if (!Number.isSafeInteger(lesson.capacity) || lesson.capacity < 0) {
      throw new Error(`${itemLabel}.capacity must be a non-negative integer.`);
    }
    if (typeof lesson.priceKc !== "number" || !Number.isFinite(lesson.priceKc) || lesson.priceKc < 0) {
      throw new Error(`${itemLabel}.priceKc must be a finite non-negative number.`);
    }
    if (typeof lesson.waitlistEnabled !== "boolean") {
      throw new Error(`${itemLabel}.waitlistEnabled must be boolean.`);
    }
    if (typeof lesson.description !== "string") {
      throw new Error(`${itemLabel}.description must be a string.`);
    }

    return JSON.stringify([
      requiredText(lesson.id, `${itemLabel}.id`),
      optionalText(lesson.luxartLessonId, `${itemLabel}.luxartLessonId`),
      optionalText(lesson.serviceId, `${itemLabel}.serviceId`),
      optionalPositiveInteger(lesson.luxartCategoryId, `${itemLabel}.luxartCategoryId`),
      optionalPositiveInteger(lesson.luxartRoomNumber, `${itemLabel}.luxartRoomNumber`),
      optionalText(lesson.luxartGender, `${itemLabel}.luxartGender`),
      requiredText(lesson.name, `${itemLabel}.name`),
      lesson.description,
      startsAt.toISOString(),
      endsAt.toISOString(),
      lesson.durationMinutes,
      requiredText(lesson.instructorName, `${itemLabel}.instructorName`),
      optionalText(lesson.substituteInstructorName, `${itemLabel}.substituteInstructorName`),
      requiredText(lesson.instructorSpecialization, `${itemLabel}.instructorSpecialization`),
      requiredText(lesson.roomName, `${itemLabel}.roomName`),
      requiredText(lesson.category, `${itemLabel}.category`),
      lesson.capacity,
      lesson.priceKc,
      optionalDateTime(lesson.reservationOpensAt, `${itemLabel}.reservationOpensAt`),
      optionalDateTime(lesson.reservationClosesAt, `${itemLabel}.reservationClosesAt`),
      lesson.waitlistEnabled,
    ]);
  });

  return createHash("sha256").update(rows.sort().join("\n"), "utf8").digest("hex");
}
