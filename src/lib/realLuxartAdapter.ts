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

interface RealLuxartConfig {
  baseUrl: string;
  resortId: number;
  timeoutMs: number;
}

function loadConfig(): RealLuxartConfig {
  const baseUrl = process.env.LUXART_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("Missing LUXART_API_BASE_URL. Set LUXART_MOCK=true until Luxart sends the current API URL.");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    resortId: Number(process.env.LUXART_RESORT_ID ?? "1"),
    timeoutMs: Number(process.env.LUXART_TIMEOUT_MS ?? "12000"),
  };
}

async function luxartFetch<T>(config: RealLuxartConfig, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Luxart API returned ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function notMapped(method: string): never {
  throw new Error(
    `${method} is ready as a RealLuxartAdapter method, but endpoint mapping is waiting for the current /Help documentation.`,
  );
}

export function createRealLuxartAdapter(): LuxartAdapter {
  const config = loadConfig();

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const login = encodeURIComponent(input.login);
      const password = encodeURIComponent(input.password);
      const card = encodeURIComponent(input.memberCardNumber ?? "");

      // Known from Luxart communication:
      // GET api/Login/{login}/{password}/{member_card_number} returns User_data.
      const userData = await luxartFetch<unknown>(config, `/api/Login/${login}/${password}/${card}`);
      notMapped(`login response mapping (${JSON.stringify(userData).slice(0, 80)}...)`);
    },

    async logout(): Promise<void> {
      return;
    },

    async getCurrentUser(): Promise<User | null> {
      notMapped("getCurrentUser");
    },

    async getLessons(_query: LessonQuery): Promise<Lesson[]> {
      notMapped("getLessons");
    },

    async getReservations(): Promise<Reservation[]> {
      notMapped("getReservations");
    },

    async getWaitlist(): Promise<WaitlistEntry[]> {
      notMapped("getWaitlist");
    },

    async getCreditTransactions(): Promise<CreditTransaction[]> {
      notMapped("getCreditTransactions");
    },

    async createReservation(_input: { lessonId: string }): Promise<Reservation> {
      notMapped("createReservation");
    },

    async cancelReservation(_input: { reservationId: string }): Promise<Reservation> {
      notMapped("cancelReservation");
    },

    async joinWaitlist(_input: { lessonId: string }): Promise<WaitlistEntry> {
      notMapped("joinWaitlist");
    },

    async leaveWaitlist(_input: { waitlistEntryId?: string; lessonId?: string }): Promise<void> {
      notMapped("leaveWaitlist");
    },

    async createTopup(_input: CreateTopupInput): Promise<PaymentTopup> {
      // Known future mapping after Stripe success:
      // POST api/Payment with Uuid=KREDIT, user_id, Amount, id_payment_shop,
      // id_payment_pp_1, id_payment_pp_2, zpusob_uhrady=3, zpusob_odeslani=0.
      notMapped("createTopup");
    },
  };
}
