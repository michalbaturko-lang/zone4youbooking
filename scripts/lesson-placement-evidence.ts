import { createHash } from "node:crypto";
import type { Lesson } from "../src/lib/domain";

export function lessonPlacementEvidence(
  lessons: Array<Pick<Lesson, "id" | "luxartRoomNumber">>,
  label: string,
) {
  const placements: string[] = [];
  const roomNumbers = new Set<number>();

  for (const lesson of lessons) {
    const roomNumber = lesson.luxartRoomNumber;
    if (!Number.isSafeInteger(roomNumber) || Number(roomNumber) < 1) {
      throw new Error(`${label} contains a lesson without a positive Luxart room number.`);
    }
    placements.push(`${lesson.id}\0${roomNumber}`);
    roomNumbers.add(Number(roomNumber));
  }

  return {
    roomPlacementSetSha256: createHash("sha256")
      .update(placements.sort().join("\n"), "utf8")
      .digest("hex"),
    roomNumbers: [...roomNumbers].sort((left, right) => left - right),
  };
}
