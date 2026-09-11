export type ID = string;
export type ISODateTime = string;
export type Currency = "CZK";

export type ReservationStatus = "active" | "cancelled" | "attended" | "no_show";
export type WaitlistStatus = "waiting" | "promoted" | "left" | "expired";

export type CreditTransactionType =
  | "reservation_charge"
  | "reservation_refund"
  | "late_cancel_fee"
  | "no_show_fee"
  | "topup"
  | "waitlist_charge";

export interface User {
  id: ID;
  login: string;
  fullName: string;
  email: string;
  phone?: string;
  memberCardNumber?: string;
  membership?: string;
  creditBalanceKc: number;
}

export interface Lesson {
  id: ID;
  luxartLessonId?: string;
  serviceId?: string;
  luxartCategoryId?: number;
  luxartRoomNumber?: number;
  luxartGender?: string;
  name: string;
  description: string;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  durationMinutes: number;
  instructorName: string;
  substituteInstructorName?: string;
  instructorPhoto?: string;
  instructorSpecialization: string;
  roomName: string;
  category: string;
  capacity: number;
  occupiedCount: number;
  availableCount?: number;
  priceKc: number;
  reservationOpensAt?: ISODateTime;
  reservationClosesAt?: ISODateTime;
  waitlistEnabled: boolean;
  favorite?: boolean;
}

export interface Reservation {
  id: ID;
  userId: ID;
  lessonId: ID;
  status: ReservationStatus;
  reservedAt: ISODateTime;
  cancelledAt?: ISODateTime;
  priceKc: number;
  holdAmountKc?: number;
  cancellationFeeKc?: number;
  creditTransactionId?: ID;
  luxartUuid?: string;
  luxartCategoryId?: number;
}

export interface WaitlistEntry {
  id: ID;
  userId: ID;
  lessonId: ID;
  position: number;
  status: WaitlistStatus;
  joinedAt?: ISODateTime;
  promotedAt?: ISODateTime;
}

export interface CreditTransaction {
  id: ID;
  userId: ID;
  type: CreditTransactionType;
  amountKc: number;
  balanceAfterKc: number;
  occurredAt: ISODateTime;
  relatedReservationId?: ID;
  relatedTopupId?: ID;
  note?: string;
}

export interface PaymentTopup {
  id: ID;
  userId: ID;
  amountKc: number;
  currency: Currency;
  provider: "stripe";
  idempotencyKey: string;
  providerSessionId?: string;
  providerPaymentIntentId?: string;
  status: "pending" | "succeeded" | "failed";
  createdAt: ISODateTime;
  paidAt?: ISODateTime;
}

export interface LoginInput {
  login: string;
  password: string;
  memberCardNumber?: string;
}

export interface LoginResult {
  user: User;
}

export interface LessonQuery {
  from: ISODateTime;
  to: ISODateTime;
  resortId?: number;
  instructorName?: string;
  roomName?: string;
  lessonType?: string;
}

export interface CreateTopupInput {
  amountKc: number;
  provider: "stripe";
  idempotencyKey: string;
  providerSessionId?: string;
  providerPaymentIntentId?: string;
}

export interface LuxartAdapter {
  login(input: LoginInput): Promise<LoginResult>;
  logout(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
  getLessons(query: LessonQuery): Promise<Lesson[]>;
  getReservations(): Promise<Reservation[]>;
  getWaitlist(): Promise<WaitlistEntry[]>;
  getCreditTransactions(): Promise<CreditTransaction[]>;
  createReservation(input: { lessonId: ID }): Promise<Reservation>;
  cancelReservation(input: { reservationId: ID }): Promise<Reservation>;
  joinWaitlist(input: { lessonId: ID }): Promise<WaitlistEntry>;
  leaveWaitlist(input: { waitlistEntryId?: ID; lessonId?: ID }): Promise<void>;
  createTopup(input: CreateTopupInput): Promise<PaymentTopup>;
}

export interface BookingSnapshot {
  user: User | null;
  lessons: Lesson[];
  reservations: Reservation[];
  waitlist: WaitlistEntry[];
  transactions: CreditTransaction[];
}

export interface BookingCapabilities {
  reservationsEnabled: boolean;
  waitlistEnabled: boolean;
  topupsEnabled: boolean;
  topupMode: "demo" | "stripe" | "disabled";
  businessRulesStatus: "demo" | "confirmed" | "unconfirmed";
  favoritesSync: "device";
  forgotPasswordEnabled: false;
  englishEnabled: true;
}

export type FreeCancellationCutoff = {
  mode: "lesson_day_midnight";
  timeZone: "Europe/Prague";
} | {
  mode: "hours_before_start";
  hours: number;
};

export interface CancellationPolicy {
  freeCancellationCutoff: FreeCancellationCutoff;
  lateCancelFeeKc: number;
  noShowFeeKc: number;
  lateCancellationAllowed: boolean;
}

export type ReformerCancellationPolicy = {
  mode: "same_as_group";
} | ({
  mode: "custom";
} & CancellationPolicy);

export interface BookingRules {
  resortId: number;
  scheduleDays: number;
  freeCancellationCutoff: FreeCancellationCutoff;
  lateCancelFeeKc: number;
  noShowFeeKc: number;
  lateCancellationAllowed: boolean;
  reformerCancellation: ReformerCancellationPolicy;
  minimumCreditForReservationKc: number;
  reservationHoldKc: number;
  reservationWindowHours: number;
  topupAmounts: number[];
}
