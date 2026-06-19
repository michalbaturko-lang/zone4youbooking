import type { BookingRules } from "./domain";

export const bookingRules: BookingRules = {
  resortId: 1,
  scheduleDays: 7,
  freeCancellationHours: 4,
  lateCancelFeeKc: 100,
  noShowFeeKc: 100,
  minimumCreditForReservationKc: 200,
  reservationHoldKc: 100,
  reservationWindowHours: 48,
  topupAmounts: [500, 1000, 2000, 5000, 10000],
};
