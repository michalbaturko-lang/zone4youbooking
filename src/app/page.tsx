"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  CreditCard,
  DoorOpen,
  Heart,
  Loader2,
  LockKeyhole,
  LogOut,
  Search,
  ShieldCheck,
  Sparkles,
  RotateCcw,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bookingApiClient } from "@/lib/bookingApiClient";
import { bookingRules as fallbackRules } from "@/lib/bookingRules";
import type { BookingRules, BookingSnapshot, Lesson, Reservation, WaitlistEntry } from "@/lib/domain";

type ViewMode = "day" | "week";
type Section = "schedule" | "reservations" | "credit" | "profile";
type Modal = "login" | "lesson" | null;

const rooms = ["Všechny", "Sál 1", "Sál 2", "Sál 3", "Reformer"];
const categories = ["Všechny", "Síla", "Cardio", "Body & Mind", "Reformer", "Zdraví"];

function money(value: number) {
  return `${value.toLocaleString("cs-CZ")} Kč`;
}

function dateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: string, style: "short" | "long" = "short") {
  const date = new Date(value);
  const weekday = new Intl.DateTimeFormat("cs-CZ", { weekday: style }).format(date);
  const day = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" }).format(date);
  return `${weekday} ${day}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function occupancyState(lesson: Lesson) {
  const free = Math.max(0, lesson.capacity - lesson.occupiedCount);
  if (free === 0) return { label: "Plno", tone: "full", free };
  if (free <= 2) return { label: `Poslední ${free}`, tone: "few", free };
  return { label: `${free} volných`, tone: "available", free };
}

function canReserve(lesson: Lesson, rules: BookingRules) {
  const now = Date.now();
  const start = new Date(lesson.startsAt).getTime();
  return start > now && start - now <= rules.reservationWindowHours * 60 * 60 * 1000;
}

function reservationFor(lesson: Lesson, reservations: Reservation[]) {
  return reservations.find((reservation) => reservation.lessonId === lesson.id && reservation.status === "active");
}

function waitlistFor(lesson: Lesson, waitlist: WaitlistEntry[]) {
  return waitlist.find((entry) => entry.lessonId === lesson.id && entry.status === "waiting");
}

function activeReservationLabel(reservation: Reservation, lesson?: Lesson) {
  if (!lesson) return "Aktivní rezervace";
  return `${lesson.name}, ${formatDateTime(lesson.startsAt)}`;
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<BookingSnapshot | null>(null);
  const [rules, setRules] = useState<BookingRules>(fallbackRules);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("schedule");
  const [view, setView] = useState<ViewMode>("day");
  const [room, setRoom] = useState("Všechny");
  const [category, setCategory] = useState("Všechny");
  const [query, setQuery] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const next = await bookingApiClient.snapshot();
    setSnapshot(next);
    setRules(next.rules);
    setSelectedDay((current) => current ?? dateKey(next.lessons[0]?.startsAt ?? new Date().toISOString()));
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch((error) => {
      setToast(error instanceof Error ? error.message : "Data se nepodařilo načíst.");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const lessons = snapshot?.lessons ?? [];
  const reservations = snapshot?.reservations ?? [];
  const waitlist = snapshot?.waitlist ?? [];

  const days = useMemo(() => Array.from(new Set(lessons.map((lesson) => dateKey(lesson.startsAt)))), [lessons]);
  const lessonById = useMemo(() => new Map(lessons.map((lesson) => [lesson.id, lesson])), [lessons]);

  const filteredLessons = useMemo(() => {
    return lessons.filter((lesson) => {
      if (room !== "Všechny" && lesson.roomName !== room) return false;
      if (category !== "Všechny" && lesson.category !== category) return false;
      if (view === "day" && selectedDay && dateKey(lesson.startsAt) !== selectedDay) return false;
      const haystack = `${lesson.name} ${lesson.instructorName} ${lesson.roomName}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
  }, [lessons, room, category, selectedDay, query, view]);

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

  const activeReservations = reservations.filter((reservation) => reservation.status === "active");
  const bookedCount = activeReservations.length;
  const waitlistCount = waitlist.filter((entry) => entry.status === "waiting").length;
  const favoriteCount = lessons.filter((lesson) => lesson.favorite).length;

  async function withBusy<T>(key: string, action: () => Promise<T>, success?: string) {
    setBusy(key);
    try {
      const result = await action();
      await refresh();
      if (success) setToast(success);
      return result;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Akce se nepodařila.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function openLesson(lesson: Lesson) {
    setSelectedLesson(lesson);
    setModal("lesson");
  }

  async function handleLogin() {
    await withBusy(
      "login",
      () => bookingApiClient.login({ login: "demo@zone4you.cz", password: "1234", memberCardNumber: "Z4Y-2048" }),
      "Přihlášení proběhlo.",
    );
    setModal(null);
  }

  async function handleLogout() {
    await withBusy("logout", () => bookingApiClient.logout(), "Odhlášeno.");
    setSection("schedule");
  }

  async function handleReservation(lesson: Lesson) {
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    await withBusy(
      `reserve-${lesson.id}`,
      () => bookingApiClient.createReservation(lesson.id),
      `Rezervace ${lesson.name} je potvrzená.`,
    );
    setModal(null);
  }

  async function handleCancel(reservation: Reservation) {
    await withBusy(
      `cancel-${reservation.id}`,
      () => bookingApiClient.cancelReservation(reservation.id),
      "Rezervace byla zrušena a kredit byl přepočten podle storno pravidel.",
    );
  }

  async function handleWaitlist(lesson: Lesson) {
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    const existing = waitlistFor(lesson, waitlist);
    if (existing) {
      await withBusy(
        `waitlist-${lesson.id}`,
        () => bookingApiClient.leaveWaitlist(existing.id),
        "Z čekací listiny jste odhlášeni.",
      );
    } else {
      await withBusy(
        `waitlist-${lesson.id}`,
        () => bookingApiClient.joinWaitlist(lesson.id),
        "Jste zapsáni na čekací listinu.",
      );
    }
    setModal(null);
  }

  async function handleTopup(amount: number) {
    if (!snapshot?.user) {
      setModal("login");
      return;
    }
    await withBusy(
      `topup-${amount}`,
      () => bookingApiClient.createTopup(amount),
      `Kredit byl dobit o ${money(amount)}.`,
    );
  }

  async function handleDemoReset() {
    await bookingApiClient.resetDemo();
    setSection("schedule");
    setView("day");
    setRoom("Všechny");
    setCategory("Všechny");
    setQuery("");
    setSelectedLesson(null);
    setModal(null);
    setSelectedDay(null);
    await refresh();
    setToast("Demo je zpět v čistém startovním stavu.");
  }

  function clearFilters() {
    setRoom("Všechny");
    setCategory("Všechny");
    setQuery("");
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={34} />
        <p>Načítám Zone4You booking...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">Z4Y</div>
          <div>
            <strong>Zone4You Booking</strong>
            <span>prezentační booking build</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="Hlavní navigace">
          <button className={section === "schedule" ? "nav-active" : ""} onClick={() => setSection("schedule")}>
            <CalendarDays size={17} />
            Rozvrh
          </button>
          <button className={section === "reservations" ? "nav-active" : ""} onClick={() => setSection("reservations")}>
            <BadgeCheck size={17} />
            Rezervace
          </button>
          <button className={section === "credit" ? "nav-active" : ""} onClick={() => setSection("credit")}>
            <WalletCards size={17} />
            Kredit
          </button>
          <button className={section === "profile" ? "nav-active" : ""} onClick={() => setSection("profile")}>
            <UserRound size={17} />
            Profil
          </button>
        </nav>

        <div className="user-strip">
          <button className="icon-text-button" onClick={handleDemoReset}>
            <RotateCcw size={17} />
            Reset demo
          </button>
          {snapshot?.user ? (
            <>
              <div className="credit-pill">
                <WalletCards size={17} />
                <span>{money(snapshot.user.creditBalanceKc)}</span>
              </div>
              <button className="icon-text-button" onClick={handleLogout}>
                <LogOut size={17} />
                Odhlásit
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={() => setModal("login")}>
              <LockKeyhole size={17} />
              Přihlásit
            </button>
          )}
        </div>
      </header>

      <section className="hero-band">
        <div>
          <span className="status-badge">
            <ShieldCheck size={15} />
            Demo napojení připravené
          </span>
          <h1>Booking engine, který už se dá klientovi ukázat.</h1>
          <p>
            Kompletní klientská cesta od rozvrhu přes rezervaci až po kredit. Jakmile dorazí finální API dokumentace,
            přepne se integrační vrstva bez změny klientského flow.
          </p>
        </div>
        <div className="hero-metrics" aria-label="Souhrn stavu">
          <div>
            <strong>{bookedCount}</strong>
            <span>aktivní rezervace</span>
          </div>
          <div>
            <strong>{waitlistCount}</strong>
            <span>čekací listina</span>
          </div>
          <div>
            <strong>{favoriteCount}</strong>
            <span>oblíbené lekce</span>
          </div>
        </div>
      </section>

      <section className="status-grid">
        <div className="status-item ready">
          <Check size={18} />
          <div>
            <strong>Produktové flow</strong>
            <span>login, rozvrh, rezervace, storno, waiting list, kredit</span>
          </div>
        </div>
        <div className="status-item warning">
          <CircleAlert size={18} />
          <div>
            <strong>Čekáme na API podklady</strong>
            <span>finální dokumentace pro lekce, rezervace a čekací listinu</span>
          </div>
        </div>
        <div className="status-item ready">
          <CreditCard size={18} />
          <div>
            <strong>Platby připravené</strong>
            <span>dobití kreditu a historie transakcí v demo režimu</span>
          </div>
        </div>
      </section>

      {section === "schedule" && (
        <section className="workspace">
          <aside className="control-rail">
            <div className="rail-block">
              <span className="rail-label">Pohled</span>
              <div className="segmented">
                <button className={view === "day" ? "active" : ""} onClick={() => setView("day")}>
                  Den
                </button>
                <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>
                  Týden
                </button>
              </div>
            </div>

            <div className="rail-block">
              <span className="rail-label">Dny</span>
              <div className="day-list">
                {days.map((day) => (
                  <button key={day} className={selectedDay === day ? "active" : ""} onClick={() => setSelectedDay(day)}>
                    {formatDay(`${day}T12:00:00`, "short")}
                  </button>
                ))}
              </div>
            </div>

            <div className="rail-block">
              <span className="rail-label">Místnost</span>
              <div className="chip-list">
                {rooms.map((item) => (
                  <button key={item} className={room === item ? "active" : ""} onClick={() => setRoom(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="rail-block">
              <span className="rail-label">Typ lekce</span>
              <div className="chip-list">
                {categories.map((item) => (
                  <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="schedule-panel">
            <div className="section-toolbar">
              <div>
                <h2>Rozvrh lekcí</h2>
                <p>Rezervace jsou v demu omezené na 48 hodin dopředu, stejně jako ve specifikaci.</p>
              </div>
              <label className="search-box">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Instruktor, lekce, sál" />
              </label>
            </div>

            <div className={view === "week" ? "week-stack" : "lesson-stack"}>
              {visibleDayGroups.length === 0 ? (
                <div className="filter-empty">
                  <EmptyState icon={<Search />} title="Žádné lekce neodpovídají filtrům" compact />
                  <button className="secondary-button" onClick={clearFilters}>
                    Zrušit filtry
                  </button>
                </div>
              ) : (
                visibleDayGroups.map(({ day, lessons: dayLessons }) => (
                    <div className="day-group" key={day}>
                      <div className="day-group-header">
                        <span>{formatDay(`${day}T12:00:00`, "long")}</span>
                        <small>{dayLessons.length} lekcí</small>
                      </div>
                      <div className="lesson-grid">
                        {dayLessons.map((lesson) => (
                          <LessonCard
                            key={lesson.id}
                            lesson={lesson}
                            rules={rules}
                            reservation={reservationFor(lesson, reservations)}
                            waitlistEntry={waitlistFor(lesson, waitlist)}
                            onOpen={() => openLesson(lesson)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </section>
        </section>
      )}

      {section === "reservations" && (
        <section className="content-band">
          <div className="section-toolbar">
            <div>
              <h2>Moje rezervace</h2>
              <p>Aktivní rezervace, storno pravidla a čekací listina pro přihlášeného klienta.</p>
            </div>
            {!snapshot?.user && (
              <button className="primary-button" onClick={() => setModal("login")}>
                Přihlásit se
              </button>
            )}
          </div>

          {!snapshot?.user ? (
            <EmptyState icon={<LockKeyhole />} title="Rezervace jsou dostupné po přihlášení" />
          ) : (
            <div className="reservation-layout">
              <div className="reservation-column">
                <h3>Aktivní rezervace</h3>
                {activeReservations.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title="Zatím žádné aktivní rezervace" compact />
                ) : (
                  activeReservations.map((reservation) => {
                    const lesson = lessonById.get(reservation.lessonId);
                    return (
                      <div className="reservation-row" key={reservation.id}>
                        <div>
                          <strong>{lesson ? activeReservationLabel(reservation, lesson) : "Rezervace"}</strong>
                          <span>{lesson ? `${lesson.roomName} - ${money(reservation.priceKc)}` : money(reservation.priceKc)}</span>
                        </div>
                        <button
                          className="ghost-danger"
                          disabled={busy === `cancel-${reservation.id}`}
                          onClick={() => handleCancel(reservation)}
                        >
                          {busy === `cancel-${reservation.id}` ? <Loader2 className="spin" size={16} /> : <X size={16} />}
                          Zrušit
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="reservation-column">
                <h3>Čekací listina</h3>
                {waitlist.filter((entry) => entry.status === "waiting").length === 0 ? (
                  <EmptyState icon={<Clock />} title="Na čekací listině nic není" compact />
                ) : (
                  waitlist
                    .filter((entry) => entry.status === "waiting")
                    .map((entry) => {
                      const lesson = lessonById.get(entry.lessonId);
                      return (
                        <div className="reservation-row" key={entry.id}>
                          <div>
                            <strong>{lesson?.name ?? "Lekce"}</strong>
                            <span>
                              Pozice {entry.position}
                              {lesson ? ` - ${formatDateTime(lesson.startsAt)}` : ""}
                            </span>
                          </div>
                          <button className="ghost-button" onClick={() => handleWaitlist(lessonById.get(entry.lessonId)!)}>
                            Odebrat
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {section === "credit" && (
        <section className="content-band">
          <div className="section-toolbar">
            <div>
              <h2>Kredit a platby</h2>
              <p>Platební část je připravená na Stripe. V demu se kredit připíše okamžitě po potvrzení částky.</p>
            </div>
            <div className="large-credit">{snapshot?.user ? money(snapshot.user.creditBalanceKc) : "Nepřihlášeno"}</div>
          </div>

          <div className="credit-layout">
            <div className="topup-panel">
              <h3>Dobít kredit</h3>
              <p>Předdefinované částky dle potvrzené specifikace.</p>
              <div className="topup-grid">
                {rules.topupAmounts.map((amount) => (
                  <button key={amount} onClick={() => handleTopup(amount)} disabled={busy === `topup-${amount}`}>
                    {busy === `topup-${amount}` ? <Loader2 className="spin" size={17} /> : <CreditCard size={17} />}
                    {money(amount)}
                  </button>
                ))}
              </div>
            </div>

            <div className="transaction-panel">
              <h3>Historie kreditu</h3>
              {snapshot?.transactions.length ? (
                snapshot.transactions.slice(0, 6).map((transaction) => (
                  <div className="transaction-row" key={transaction.id}>
                    <div>
                      <strong>{transaction.note ?? transaction.type}</strong>
                      <span>{formatDateTime(transaction.occurredAt)}</span>
                    </div>
                    <b className={transaction.amountKc >= 0 ? "plus" : "minus"}>
                      {transaction.amountKc >= 0 ? "+" : ""}
                      {money(transaction.amountKc)}
                    </b>
                  </div>
                ))
              ) : (
                <EmptyState icon={<WalletCards />} title="Historie se zobrazí po přihlášení" compact />
              )}
            </div>
          </div>
        </section>
      )}

      {section === "profile" && (
        <section className="content-band profile-band">
          <div className="section-toolbar">
            <div>
              <h2>Profil klienta</h2>
              <p>Read-only profil podle Luxart User_data, s možností doplnění chybějících údajů později.</p>
            </div>
          </div>

          {snapshot?.user ? (
            <div className="profile-grid">
              <div className="profile-card">
                <div className="avatar">{snapshot.user.fullName.slice(0, 2).toUpperCase()}</div>
                <h3>{snapshot.user.fullName}</h3>
                <p>{snapshot.user.membership}</p>
              </div>
              <dl className="profile-details">
                <div>
                  <dt>Email</dt>
                  <dd>{snapshot.user.email}</dd>
                </div>
                <div>
                  <dt>Telefon</dt>
                  <dd>{snapshot.user.phone}</dd>
                </div>
                <div>
                  <dt>Členská karta</dt>
                  <dd>{snapshot.user.memberCardNumber}</dd>
                </div>
                <div>
                  <dt>Login model</dt>
                  <dd>Email/jméno + heslo, vztah ke kartě ověříme s Luxartem.</dd>
                </div>
              </dl>
            </div>
          ) : (
            <EmptyState icon={<UserRound />} title="Profil se zobrazí po přihlášení" />
          )}
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}

      {modal === "login" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Přihlášení">
          <div className="modal-card small-modal">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Zavřít">
              <X size={18} />
            </button>
            <LockKeyhole size={26} />
            <h2>Přihlášení klienta</h2>
            <p>Pro prezentaci použijeme demo klienta. Produkční přihlášení se napojí na Luxart po dodání aktuální dokumentace.</p>
            <div className="login-preview">
              <span>demo@zone4you.cz</span>
              <span>heslo 1234</span>
              <span>karta Z4Y-2048</span>
            </div>
            <button className="primary-button full-width" onClick={handleLogin} disabled={busy === "login"}>
              {busy === "login" ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
              Přihlásit demo klienta
            </button>
          </div>
        </div>
      )}

      {modal === "lesson" && selectedLesson && (
        <LessonModal
          lesson={selectedLesson}
          rules={rules}
          reservation={reservationFor(selectedLesson, reservations)}
          waitlistEntry={waitlistFor(selectedLesson, waitlist)}
          isLoggedIn={Boolean(snapshot?.user)}
          busy={busy}
          onClose={() => setModal(null)}
          onReserve={() => handleReservation(selectedLesson)}
          onWaitlist={() => handleWaitlist(selectedLesson)}
          onLogin={() => setModal("login")}
        />
      )}
    </main>
  );
}

function LessonCard({
  lesson,
  rules,
  reservation,
  waitlistEntry,
  onOpen,
}: {
  lesson: Lesson;
  rules: BookingRules;
  reservation?: Reservation;
  waitlistEntry?: WaitlistEntry;
  onOpen: () => void;
}) {
  const state = occupancyState(lesson);
  const booked = Boolean(reservation);
  const listed = Boolean(waitlistEntry);
  return (
    <button className="lesson-card" onClick={onOpen}>
      <div className="lesson-card-top">
        <span className={`room-dot ${lesson.roomName.toLowerCase().replaceAll(" ", "-")}`} />
        <span>{lesson.roomName}</span>
        {lesson.favorite && <Heart className="favorite" size={16} fill="currentColor" />}
      </div>
      <div className="lesson-time-line">
        <strong>{formatTime(lesson.startsAt)}</strong>
        <span>{formatTime(lesson.endsAt)}</span>
      </div>
      <h3>{lesson.name}</h3>
      <div className="instructor-inline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lesson.instructorPhoto} alt="" />
        <span>{lesson.instructorName}</span>
      </div>
      <div className="lesson-meta-row">
        <span>{money(lesson.priceKc)}</span>
        <span className={`capacity ${state.tone}`}>{state.label}</span>
      </div>
      <div className="capacity-bar" aria-label={`Obsazeno ${lesson.occupiedCount} z ${lesson.capacity}`}>
        <span style={{ width: `${Math.min(100, (lesson.occupiedCount / lesson.capacity) * 100)}%` }} />
      </div>
      <div className="lesson-card-footer">
        {booked && <span className="mini-status ok">Rezervováno</span>}
        {listed && <span className="mini-status wait">Čekací listina #{waitlistEntry?.position}</span>}
        {!booked && !listed && !canReserve(lesson, rules) && <span className="mini-status muted">Mimo 48 h okno</span>}
        {!booked && !listed && canReserve(lesson, rules) && state.free > 0 && <span className="mini-status ok">Lze rezervovat</span>}
        {!booked && !listed && state.free === 0 && <span className="mini-status wait">Waiting list</span>}
        <ChevronRight size={17} />
      </div>
    </button>
  );
}

function LessonModal({
  lesson,
  rules,
  reservation,
  waitlistEntry,
  isLoggedIn,
  busy,
  onClose,
  onReserve,
  onWaitlist,
  onLogin,
}: {
  lesson: Lesson;
  rules: BookingRules;
  reservation?: Reservation;
  waitlistEntry?: WaitlistEntry;
  isLoggedIn: boolean;
  busy: string | null;
  onClose: () => void;
  onReserve: () => void;
  onWaitlist: () => void;
  onLogin: () => void;
}) {
  const state = occupancyState(lesson);
  const isFull = state.free === 0;
  const reservable = canReserve(lesson, rules);
  const actionBusy = busy === `reserve-${lesson.id}` || busy === `waitlist-${lesson.id}`;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={lesson.name}>
      <div className="modal-card lesson-modal">
        <button className="modal-close" onClick={onClose} aria-label="Zavřít">
          <X size={18} />
        </button>
        <div className="lesson-modal-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lesson.instructorPhoto} alt="" />
          <div>
            <span className="status-badge subtle">{lesson.category}</span>
            <h2>{lesson.name}</h2>
            <p>{lesson.instructorName} - {lesson.instructorSpecialization}</p>
          </div>
        </div>
        <p className="lesson-description">{lesson.description}</p>
        <div className="detail-grid">
          <div>
            <Clock size={18} />
            <span>{formatDateTime(lesson.startsAt)}</span>
          </div>
          <div>
            <DoorOpen size={18} />
            <span>{lesson.roomName}</span>
          </div>
          <div>
            <WalletCards size={18} />
            <span>{money(lesson.priceKc)}</span>
          </div>
          <div>
            <Activity size={18} />
            <span>
              {lesson.occupiedCount}/{lesson.capacity} obsazeno
            </span>
          </div>
        </div>
        <div className="rules-strip">
          <span>Stržení kreditu při rezervaci</span>
          <span>Storno zdarma do 4 h</span>
          <span>Pozdní storno/no-show 100 Kč</span>
        </div>
        <div className="modal-actions">
          {!isLoggedIn ? (
            <button className="primary-button full-width" onClick={onLogin}>
              <LockKeyhole size={17} />
              Přihlásit se pro rezervaci
            </button>
          ) : reservation ? (
            <button className="secondary-button full-width" disabled>
              <Check size={17} />
              Lekci máte rezervovanou
            </button>
          ) : isFull ? (
            <button className="primary-button full-width" onClick={onWaitlist} disabled={actionBusy}>
              {actionBusy ? <Loader2 className="spin" size={17} /> : <Clock size={17} />}
              {waitlistEntry ? `Odebrat z čekací listiny #${waitlistEntry.position}` : "Zapsat na čekací listinu"}
            </button>
          ) : !reservable ? (
            <button className="secondary-button full-width" disabled>
              Rezervace zatím není otevřená
            </button>
          ) : (
            <button className="primary-button full-width" onClick={onReserve} disabled={actionBusy}>
              {actionBusy ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
              Rezervovat za {money(lesson.priceKc)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
      {icon}
      <strong>{title}</strong>
    </div>
  );
}
