import type {
  BookingSnapshot,
  CreateTopupInput,
  CreditTransaction,
  Lesson,
  LessonQuery,
  LoginInput,
  LoginResult,
  LuxartAdapter,
  PaymentTopup,
  Reservation,
  User,
  WaitlistEntry,
} from "./domain";
import { bookingRules } from "./bookingRules";

const RESORT_ID = bookingRules.resortId;
const FREE_CANCELLATION_HOURS = bookingRules.freeCancellationHours;
const LATE_CANCEL_FEE_KC = bookingRules.lateCancelFeeKc;
const RESERVATION_WINDOW_HOURS = bookingRules.reservationWindowHours;

const demoUser: User = {
  id: "usr_demo_001",
  login: "demo@zone4you.cz",
  fullName: "Tereza Nováková",
  email: "demo@zone4you.cz",
  phone: "+420 777 123 456",
  memberCardNumber: "Z4Y-2048",
  membership: "Zone4You Active",
  creditBalanceKc: 1450,
};

const lessonDescriptions: Record<string, string> = {
  HIIT:
    "Vysoko intenzivní intervalový trénink střídající krátké úseky intenzivního cvičení s odpočinkem.",
  "BODY FORMING":
    "Aerobně vedená lekce s posilovacími cviky zaměřená na formování postavy.",
  SPINNING:
    "Energetické skupinové cvičení na stacionárních kolech. Skvělý kardio trénink.",
  "ZDRAVÁ ZÁDA":
    "Zdravotní lekce pro uvolnění zad, stabilizaci středu těla a lepší držení těla.",
  PILATES:
    "Kontrolovaný pohyb, dech a posílení hlubokého stabilizačního systému.",
  "POWER JOGA":
    "Dynamická jóga pro sílu, mobilitu a celkové zklidnění po dni.",
  REFORMER:
    "Cvičení na stroji Reformer s individuálnějším vedením a přesnou prací s odporem.",
  "HEAT easy":
    "Lehčí varianta H.E.A.T. tréninku vhodná pro začátečníky a regenerační dny.",
  PUMPING:
    "Silovější lekce s nakládacími činkami zaměřená na celé tělo.",
  "RANNÍ JOGA":
    "Jemná ranní lekce pro probuzení těla, protažení a klidný start dne.",
};

const instructorMeta: Record<string, { photo: string; specialization: string }> = {
  "Zuzana Chlupová": {
    photo: "/images/instructors/chlupova-zuzana.png",
    specialization: "HIIT, Body Forming",
  },
  "Lenka Olivová": {
    photo: "/images/instructors/olivova-lenka.png",
    specialization: "H.E.A.T., kondiční lekce",
  },
  "Petra Uhrová": {
    photo: "/images/instructors/uhrova-petra.png",
    specialization: "Spinning, endurance",
  },
  "Hana Hrnčiariková": {
    photo: "/images/instructors/hrnciarikova-hana.png",
    specialization: "Zdravá záda, pilates",
  },
  "Charlota Treblíková": {
    photo: "/images/instructors/treblikova-charlota.png",
    specialization: "Jóga, mobilita",
  },
  "Pavel Vácha": {
    photo: "/images/instructors/vacha-pavel.png",
    specialization: "Pumping, síla",
  },
  "Reformer tým": {
    photo: "/images/instructors/martincova-lucie.png",
    specialization: "Reformer pilates",
  },
};

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function at(dayOffset: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(startOfToday().getTime() + (dayOffset + 1) * dayMs);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function lessonSeed(
  id: string,
  dayOffset: number,
  time: string,
  durationMinutes: number,
  name: keyof typeof lessonDescriptions,
  roomName: Lesson["roomName"],
  category: Lesson["category"],
  instructorName: keyof typeof instructorMeta,
  capacity: number,
  occupiedCount: number,
  priceKc: number,
  favorite = false,
): Lesson {
  const startsAt = at(dayOffset, time);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  const meta = instructorMeta[instructorName];

  return {
    id,
    luxartLessonId: `lux_${id}`,
    serviceId: `svc_${roomName.toLowerCase().replaceAll(" ", "_")}`,
    name,
    description: lessonDescriptions[name],
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationMinutes,
    instructorName,
    instructorPhoto: meta.photo,
    instructorSpecialization: meta.specialization,
    roomName,
    category,
    capacity,
    occupiedCount,
    priceKc,
    reservationOpensAt: new Date(startsAt.getTime() - RESERVATION_WINDOW_HOURS * hourMs).toISOString(),
    reservationClosesAt: startsAt.toISOString(),
    waitlistEnabled: true,
    favorite,
  };
}

let currentUser: User | null = null;
let userState: User = { ...demoUser };

function createSeedLessons(): Lesson[] {
  return [
  lessonSeed("les_001", 0, "16:30", 50, "HEAT easy", "Sál 2", "Cardio", "Lenka Olivová", 14, 9, 180, true),
  lessonSeed("les_002", 0, "17:30", 50, "SPINNING", "Sál 2", "Cardio", "Petra Uhrová", 16, 15, 180, true),
  lessonSeed("les_003", 0, "18:00", 55, "POWER JOGA", "Sál 1", "Body & Mind", "Charlota Treblíková", 18, 12, 170),
  lessonSeed("les_004", 0, "18:30", 50, "PUMPING", "Sál 1", "Síla", "Pavel Vácha", 14, 14, 190),
  lessonSeed("les_005", 0, "19:00", 55, "REFORMER", "Reformer", "Reformer", "Reformer tým", 6, 6, 320, true),
  lessonSeed("les_006", 1, "7:10", 55, "PILATES", "Sál 1", "Body & Mind", "Hana Hrnčiariková", 16, 6, 170),
  lessonSeed("les_007", 1, "8:30", 55, "PUMPING", "Sál 1", "Síla", "Pavel Vácha", 14, 8, 190),
  lessonSeed("les_008", 1, "9:30", 50, "SPINNING", "Sál 2", "Cardio", "Petra Uhrová", 16, 13, 180),
  lessonSeed("les_009", 1, "16:30", 90, "SPINNING", "Sál 2", "Cardio", "Petra Uhrová", 16, 5, 250),
  lessonSeed("les_010", 1, "17:30", 80, "REFORMER", "Reformer", "Reformer", "Reformer tým", 6, 4, 320),
  lessonSeed("les_011", 2, "8:30", 55, "ZDRAVÁ ZÁDA", "Sál 1", "Zdraví", "Hana Hrnčiariková", 16, 7, 160),
  lessonSeed("les_012", 2, "9:30", 55, "RANNÍ JOGA", "Sál 1", "Body & Mind", "Charlota Treblíková", 18, 11, 170),
  lessonSeed("les_013", 2, "10:20", 50, "SPINNING", "Sál 2", "Cardio", "Petra Uhrová", 16, 16, 180),
  lessonSeed("les_014", 3, "17:00", 55, "BODY FORMING", "Sál 1", "Síla", "Zuzana Chlupová", 16, 10, 180),
  lessonSeed("les_015", 3, "18:00", 50, "HIIT", "Sál 2", "Cardio", "Zuzana Chlupová", 14, 7, 190),
  ];
}

function createSeedReservations(): Reservation[] {
  return [
    {
      id: "res_seed_001",
      userId: demoUser.id,
      lessonId: "les_006",
      status: "active",
      reservedAt: new Date(Date.now() - 2 * hourMs).toISOString(),
      priceKc: 170,
      creditTransactionId: "trx_seed_001",
    },
  ];
}

function createSeedWaitlist(): WaitlistEntry[] {
  return [
    {
      id: "wl_seed_001",
      userId: demoUser.id,
      lessonId: "les_005",
      position: 2,
      status: "waiting",
      joinedAt: new Date(Date.now() - hourMs).toISOString(),
    },
  ];
}

function createSeedTransactions(): CreditTransaction[] {
  return [
    {
      id: "trx_seed_001",
      userId: demoUser.id,
      type: "reservation_charge",
      amountKc: -170,
      balanceAfterKc: 1450,
      occurredAt: new Date(Date.now() - 2 * hourMs).toISOString(),
      relatedReservationId: "res_seed_001",
      note: "Rezervace PILATES",
    },
    {
      id: "trx_seed_002",
      userId: demoUser.id,
      type: "topup",
      amountKc: 1000,
      balanceAfterKc: 1620,
      occurredAt: new Date(Date.now() - 30 * hourMs).toISOString(),
      note: "Dobití kreditu kartou",
    },
  ];
}

let lessons: Lesson[] = createSeedLessons();
let reservations: Reservation[] = createSeedReservations();
let waitlist: WaitlistEntry[] = createSeedWaitlist();
let transactions: CreditTransaction[] = createSeedTransactions();

export interface MockLuxartState {
  loggedIn: boolean;
  userState: User;
  reservations: Reservation[];
  waitlist: WaitlistEntry[];
  transactions: CreditTransaction[];
  occupiedCounts: Record<string, number>;
}

function currentOccupiedCounts() {
  return Object.fromEntries(lessons.map((lesson) => [lesson.id, lesson.occupiedCount]));
}

function applyOccupiedCounts(counts: Record<string, number> = {}) {
  lessons = lessons.map((lesson) => ({
    ...lesson,
    occupiedCount: typeof counts[lesson.id] === "number" ? counts[lesson.id] : lesson.occupiedCount,
  }));
}

export function getMockLuxartState(): MockLuxartState {
  return {
    loggedIn: Boolean(currentUser),
    userState: { ...userState },
    reservations: reservations.map((reservation) => ({ ...reservation })),
    waitlist: waitlist.map((entry) => ({ ...entry })),
    transactions: transactions.map((transaction) => ({ ...transaction })),
    occupiedCounts: currentOccupiedCounts(),
  };
}

export function setMockLuxartState(state: MockLuxartState) {
  userState = { ...state.userState };
  lessons = createSeedLessons();
  reservations = state.reservations.map((reservation) => ({ ...reservation }));
  waitlist = state.waitlist.map((entry) => ({ ...entry }));
  transactions = state.transactions.map((transaction) => ({ ...transaction }));
  applyOccupiedCounts(state.occupiedCounts);
  currentUser = state.loggedIn ? { ...userState } : null;
}

export function resetMockLuxartState(options: { keepLoggedIn?: boolean } = {}) {
  const wasLoggedIn = Boolean(currentUser);
  userState = { ...demoUser };
  lessons = createSeedLessons();
  reservations = createSeedReservations();
  waitlist = createSeedWaitlist();
  transactions = createSeedTransactions();
  currentUser = options.keepLoggedIn && wasLoggedIn ? { ...userState } : null;
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function ensureUser(): User {
  if (!currentUser) {
    throw new Error("Pro tuto akci se prosím přihlaste.");
  }
  return currentUser;
}

function syncCurrentUser() {
  if (currentUser) {
    currentUser = { ...userState };
  }
}

function addTransaction(transaction: Omit<CreditTransaction, "id" | "occurredAt" | "balanceAfterKc">) {
  userState = {
    ...userState,
    creditBalanceKc: userState.creditBalanceKc + transaction.amountKc,
  };
  const saved: CreditTransaction = {
    ...transaction,
    id: uid("trx"),
    occurredAt: new Date().toISOString(),
    balanceAfterKc: userState.creditBalanceKc,
  };
  transactions = [saved, ...transactions];
  syncCurrentUser();
  return saved;
}

function activeReservationFor(lessonId: string) {
  return reservations.find((reservation) => reservation.lessonId === lessonId && reservation.status === "active");
}

function isWithinReservationWindow(lesson: Lesson) {
  const now = Date.now();
  const start = new Date(lesson.startsAt).getTime();
  return start - now <= RESERVATION_WINDOW_HOURS * hourMs && start > now;
}

function sortedLessons(query: LessonQuery) {
  const from = new Date(query.from).getTime();
  const to = new Date(query.to).getTime();
  return lessons
    .filter((lesson) => {
      const start = new Date(lesson.startsAt).getTime();
      if (start < from || start > to) return false;
      if (query.resortId && query.resortId !== RESORT_ID) return false;
      if (query.instructorName && lesson.instructorName !== query.instructorName) return false;
      if (query.roomName && lesson.roomName !== query.roomName) return false;
      if (query.lessonType && lesson.category !== query.lessonType) return false;
      return true;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export const luxartRules = bookingRules;

export const mockLuxartAdapter: LuxartAdapter = {
  async login(input: LoginInput): Promise<LoginResult> {
    if (!input.login || !input.password) {
      throw new Error("Vyplňte login i heslo.");
    }
    currentUser = { ...userState };
    return {
      user: currentUser,
      sessionToken: "mock-session-token",
    };
  },

  async logout(): Promise<void> {
    currentUser = null;
  },

  async getCurrentUser(): Promise<User | null> {
    return currentUser;
  },

  async getLessons(query: LessonQuery): Promise<Lesson[]> {
    return sortedLessons(query);
  },

  async getReservations(): Promise<Reservation[]> {
    const user = ensureUser();
    return reservations.filter((reservation) => reservation.userId === user.id);
  },

  async getWaitlist(): Promise<WaitlistEntry[]> {
    const user = ensureUser();
    return waitlist.filter((entry) => entry.userId === user.id);
  },

  async getCreditTransactions(): Promise<CreditTransaction[]> {
    const user = ensureUser();
    return transactions.filter((transaction) => transaction.userId === user.id);
  },

  async createReservation(input: { lessonId: string }): Promise<Reservation> {
    const user = ensureUser();
    const lesson = lessons.find((item) => item.id === input.lessonId);
    if (!lesson) throw new Error("Lekce nebyla nalezena.");
    if (!isWithinReservationWindow(lesson)) throw new Error("Rezervace jsou otevřené maximálně 48 hodin dopředu.");
    if (activeReservationFor(lesson.id)) throw new Error("Tuto lekci už máte rezervovanou.");
    if (lesson.occupiedCount >= lesson.capacity) throw new Error("Lekce je plná. Můžete se zapsat na čekací listinu.");
    if (user.creditBalanceKc < lesson.priceKc) throw new Error("Nemáte dostatečný kredit pro rezervaci.");

    const reservation: Reservation = {
      id: uid("res"),
      userId: user.id,
      lessonId: lesson.id,
      status: "active",
      reservedAt: new Date().toISOString(),
      priceKc: lesson.priceKc,
    };
    const transaction = addTransaction({
      userId: user.id,
      type: "reservation_charge",
      amountKc: -lesson.priceKc,
      relatedReservationId: reservation.id,
      note: `Rezervace ${lesson.name}`,
    });
    reservation.creditTransactionId = transaction.id;
    reservations = [reservation, ...reservations];
    lessons = lessons.map((item) =>
      item.id === lesson.id ? { ...item, occupiedCount: item.occupiedCount + 1 } : item,
    );
    return reservation;
  },

  async cancelReservation(input: { reservationId: string }): Promise<Reservation> {
    const user = ensureUser();
    const reservation = reservations.find((item) => item.id === input.reservationId && item.userId === user.id);
    if (!reservation) throw new Error("Rezervace nebyla nalezena.");
    if (reservation.status !== "active") throw new Error("Rezervace už není aktivní.");
    const lesson = lessons.find((item) => item.id === reservation.lessonId);
    if (!lesson) throw new Error("Lekce nebyla nalezena.");

    const hoursToStart = (new Date(lesson.startsAt).getTime() - Date.now()) / hourMs;
    const cancellationFeeKc = hoursToStart >= FREE_CANCELLATION_HOURS ? 0 : LATE_CANCEL_FEE_KC;
    const refundKc = Math.max(0, reservation.priceKc - cancellationFeeKc);
    if (refundKc > 0) {
      addTransaction({
        userId: user.id,
        type: "reservation_refund",
        amountKc: refundKc,
        relatedReservationId: reservation.id,
        note: `Vrácení kreditu ${lesson.name}`,
      });
    }
    if (cancellationFeeKc > 0) {
      addTransaction({
        userId: user.id,
        type: "late_cancel_fee",
        amountKc: -cancellationFeeKc,
        relatedReservationId: reservation.id,
        note: `Pozdní storno ${lesson.name}`,
      });
    }

    const cancelled: Reservation = {
      ...reservation,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancellationFeeKc,
    };
    reservations = reservations.map((item) => (item.id === reservation.id ? cancelled : item));
    lessons = lessons.map((item) =>
      item.id === lesson.id ? { ...item, occupiedCount: Math.max(0, item.occupiedCount - 1) } : item,
    );
    return cancelled;
  },

  async joinWaitlist(input: { lessonId: string }): Promise<WaitlistEntry> {
    const user = ensureUser();
    const lesson = lessons.find((item) => item.id === input.lessonId);
    if (!lesson) throw new Error("Lekce nebyla nalezena.");
    const existing = waitlist.find(
      (entry) => entry.lessonId === lesson.id && entry.userId === user.id && entry.status === "waiting",
    );
    if (existing) return existing;
    const lessonWaitlist = waitlist.filter((entry) => entry.lessonId === lesson.id && entry.status === "waiting");
    if (lessonWaitlist.length >= 10) throw new Error("Čekací listina je plná.");
    const entry: WaitlistEntry = {
      id: uid("wl"),
      userId: user.id,
      lessonId: lesson.id,
      position: lessonWaitlist.length + 1,
      status: "waiting",
      joinedAt: new Date().toISOString(),
    };
    waitlist = [...waitlist, entry];
    return entry;
  },

  async leaveWaitlist(input: { waitlistEntryId?: string; lessonId?: string }): Promise<void> {
    const user = ensureUser();
    waitlist = waitlist
      .map((entry) => {
        const matchesEntry = input.waitlistEntryId && entry.id === input.waitlistEntryId;
        const matchesLesson = input.lessonId && entry.lessonId === input.lessonId && entry.userId === user.id;
        if (matchesEntry || matchesLesson) return { ...entry, status: "left" as const };
        return entry;
      })
      .map((entry) => {
        if (entry.status !== "waiting") return entry;
        const sameLesson = waitlist.filter((item) => item.lessonId === entry.lessonId && item.status === "waiting");
        return { ...entry, position: sameLesson.findIndex((item) => item.id === entry.id) + 1 };
      });
  },

  async createTopup(input: CreateTopupInput): Promise<PaymentTopup> {
    const user = ensureUser();
    if (!luxartRules.topupAmounts.includes(input.amountKc)) {
      throw new Error("Vyberte jednu z předdefinovaných částek.");
    }
    const topup: PaymentTopup = {
      id: uid("pay"),
      userId: user.id,
      amountKc: input.amountKc,
      currency: "CZK",
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      providerSessionId: input.providerSessionId ?? uid("cs_mock"),
      providerPaymentIntentId: input.providerPaymentIntentId ?? uid("pi_mock"),
      status: "succeeded",
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };
    addTransaction({
      userId: user.id,
      type: "topup",
      amountKc: input.amountKc,
      relatedTopupId: topup.id,
      note: `Mock Stripe top-up ${input.amountKc.toLocaleString("cs-CZ")} Kč`,
    });
    return topup;
  },
};

export async function getBookingSnapshot(): Promise<BookingSnapshot> {
  const from = startOfToday();
  const to = new Date(from.getTime() + 4 * dayMs);
  const [user, loadedLessons] = await Promise.all([
    mockLuxartAdapter.getCurrentUser(),
    mockLuxartAdapter.getLessons({ from: from.toISOString(), to: to.toISOString(), resortId: RESORT_ID }),
  ]);

  if (!user) {
    return {
      user,
      lessons: loadedLessons,
      reservations: [],
      waitlist: [],
      transactions: [],
    };
  }

  const [loadedReservations, loadedWaitlist, loadedTransactions] = await Promise.all([
    mockLuxartAdapter.getReservations(),
    mockLuxartAdapter.getWaitlist(),
    mockLuxartAdapter.getCreditTransactions(),
  ]);

  return {
    user,
    lessons: loadedLessons,
    reservations: loadedReservations,
    waitlist: loadedWaitlist,
    transactions: loadedTransactions,
  };
}
