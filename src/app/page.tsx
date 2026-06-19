"use client";

import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  DoorOpen,
  Loader2,
  LockKeyhole,
  Search,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { bookingApiClient } from "@/lib/bookingApiClient";
import { bookingRules as fallbackRules } from "@/lib/bookingRules";
import type { BookingRules, BookingSnapshot, Lesson, LoginInput, Reservation, WaitlistEntry } from "@/lib/domain";

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

function occupancyClass(lesson: Lesson) {
  const state = occupancyState(lesson);
  return state.tone === "available" ? "status-available" : state.tone === "few" ? "status-few" : "status-full";
}

function roomClass(roomName: Lesson["roomName"]) {
  return `room-${roomName.toLowerCase().replaceAll(" ", "-").replace("á", "a")}`;
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

function sortLessons(lessons: Lesson[]) {
  return [...lessons].sort((first, second) => new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime());
}

function groupLessonsByTime(lessons: Lesson[]) {
  const groups = new Map<string, Lesson[]>();
  sortLessons(lessons).forEach((lesson) => {
    const time = formatTime(lesson.startsAt);
    groups.set(time, [...(groups.get(time) ?? []), lesson]);
  });
  return Array.from(groups, ([time, groupedLessons]) => ({ time, lessons: groupedLessons }));
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
  const todayKey = dateKey(new Date().toISOString());

  const days = useMemo(() => Array.from(new Set(sortLessons(lessons).map((lesson) => dateKey(lesson.startsAt)))), [lessons]);
  const lessonById = useMemo(() => new Map(lessons.map((lesson) => [lesson.id, lesson])), [lessons]);

  const filteredLessons = useMemo(() => {
    return sortLessons(lessons).filter((lesson) => {
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

  const weekTimes = useMemo(() => {
    const uniqueTimes = Array.from(new Set(filteredLessons.map((lesson) => formatTime(lesson.startsAt))));
    return uniqueTimes.sort((first, second) => first.localeCompare(second, "cs-CZ", { numeric: true }));
  }, [filteredLessons]);

  const activeReservations = reservations.filter((reservation) => reservation.status === "active");
  const waitingEntries = waitlist.filter((entry) => entry.status === "waiting");
  const hasActiveFilters = room !== "Všechny" || category !== "Všechny" || query.trim().length > 0;

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

  async function handleLogin(
    input: LoginInput = { login: "tereza.novakova@email.cz", password: "1234", memberCardNumber: "Z4Y-2048" },
  ) {
    await withBusy(
      "login",
      () => bookingApiClient.login(input),
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
    <>
      <header className="header">
        <div className="header-content">
          <button className="logo" onClick={() => setSection("schedule")} aria-label="Zone4You rozvrh">
            <div className="logo-icon">Z4Y</div>
            <span>Zone4You</span>
          </button>

          <div className="user-section">
            <button
              className={`btn btn-outline header-nav-button ${section === "schedule" ? "active" : ""}`}
              onClick={() => setSection("schedule")}
            >
              Rozvrh
            </button>
            <button
              className={`btn btn-outline header-nav-button ${section === "reservations" ? "active" : ""}`}
              onClick={() => setSection("reservations")}
            >
              Moje rezervace
            </button>
            <button
              className={`btn btn-outline header-nav-button ${section === "credit" ? "active" : ""}`}
              onClick={() => setSection("credit")}
            >
              Kredit
            </button>
            {snapshot?.user && (
              <button
                className={`btn btn-outline header-nav-button ${section === "profile" ? "active" : ""}`}
                onClick={() => setSection("profile")}
              >
                Profil
              </button>
            )}
            {snapshot?.user ? (
              <>
                <div className="credit-display">{money(snapshot.user.creditBalanceKc)}</div>
                <button className="btn btn-primary auth-button" onClick={handleLogout}>
                  Odhlásit
                </button>
              </>
            ) : (
              <button className="btn btn-primary auth-button" onClick={() => setModal("login")}>
                Přihlásit se
              </button>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div className="toast-container">
          <div className="toast">{toast}</div>
        </div>
      )}

      <main className="main">
        {section === "schedule" && (
          <section id="scheduleSection">
            <div className="view-section">
              <div className="view-toggle" aria-label="Pohled rozvrhu">
                <button className={`view-btn ${view === "day" ? "active" : ""}`} onClick={() => setView("day")}>
                  Den
                </button>
                <button className={`view-btn ${view === "week" ? "active" : ""}`} onClick={() => setView("week")}>
                  Týden
                </button>
              </div>

              <div className="day-selector" aria-label="Výběr dne">
                {days.map((day) => (
                  <button
                    key={day}
                    className={`day-btn ${selectedDay === day ? "active" : ""} ${todayKey === day ? "today" : ""}`}
                    onClick={() => {
                      setSelectedDay(day);
                      setView("day");
                    }}
                  >
                    {formatDay(`${day}T12:00:00`, "short")}
                  </button>
                ))}
              </div>
            </div>

            <div className="legend" aria-label="Filtr místnosti">
              {rooms.map((item) => (
                <button
                  key={item}
                  className={`legend-item ${room === item ? "active" : ""}`}
                  onClick={() => setRoom(item)}
                  type="button"
                >
                  <span className={`legend-dot ${item === "Všechny" ? "room-all" : roomClass(item as Lesson["roomName"])}`} />
                  {item}
                </button>
              ))}
            </div>

            <div className="filter-section">
              <span className="filter-label">Typ lekce:</span>
              <div className="filter-chips">
                {categories.map((item) => (
                  <button key={item} className={`filter-chip ${category === item ? "active" : ""}`} onClick={() => setCategory(item)}>
                    {item}
                  </button>
                ))}
              </div>
              <label className="schedule-search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lekce, instruktor, sál" />
              </label>
              {hasActiveFilters && (
                <button className="filter-reset" onClick={clearFilters}>
                  Zrušit filtry
                </button>
              )}
            </div>

            {view === "day" && (
              <div className="schedule-day active">
                {visibleDayGroups.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title="Žádné lekce neodpovídají filtrům" actionLabel="Zrušit filtry" onAction={clearFilters} />
                ) : (
                  visibleDayGroups.map(({ day, lessons: dayLessons }) => (
                    <div key={day} className="day-block">
                      <h2 className="section-title">{formatDay(`${day}T12:00:00`, "long")}</h2>
                      {groupLessonsByTime(dayLessons).map((group) => (
                        <div className="time-group" key={group.time}>
                          <div className="time-group-header">{group.time}</div>
                          {group.lessons.map((lesson) => (
                            <LessonRow
                              key={lesson.id}
                              lesson={lesson}
                              rules={rules}
                              reservation={reservationFor(lesson, reservations)}
                              waitlistEntry={waitlistFor(lesson, waitlist)}
                              onOpen={() => openLesson(lesson)}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}

            {view === "week" && (
              <div className="schedule-week active">
                {filteredLessons.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title="Žádné lekce neodpovídají filtrům" actionLabel="Zrušit filtry" onAction={clearFilters} />
                ) : (
                  <>
                    <table className="week-table">
                      <colgroup>
                        <col className="week-time-col" />
                        {days.map((day) => (
                          <col key={day} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Čas</th>
                          {days.map((day) => (
                            <th key={day} className={todayKey === day ? "today-col" : ""}>
                              {formatDay(`${day}T12:00:00`, "short")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weekTimes.map((time) => (
                          <tr key={time}>
                            <td>{time}</td>
                            {days.map((day) => {
                              const cellLessons = filteredLessons.filter(
                                (lesson) => dateKey(lesson.startsAt) === day && formatTime(lesson.startsAt) === time,
                              );
                              return (
                                <td key={`${day}-${time}`}>
                                  {cellLessons.map((lesson) => (
                                    <button
                                      key={lesson.id}
                                      className={`week-lesson ${roomClass(lesson.roomName)}`}
                                      onClick={() => openLesson(lesson)}
                                    >
                                      <span className="week-lesson-name">{lesson.name}</span>
                                      <span className="week-lesson-time">
                                        {formatTime(lesson.startsAt)} - {formatTime(lesson.endsAt)}
                                      </span>
                                    </button>
                                  ))}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="week-mobile-list">
                      {visibleLessonsByDay
                        .filter(({ lessons: dayLessons }) => dayLessons.length > 0)
                        .map(({ day, lessons: dayLessons }) => (
                          <section className="week-mobile-day" key={day}>
                            <h2 className="section-title">{formatDay(`${day}T12:00:00`, "long")}</h2>
                            <div className="time-group">
                              {dayLessons.map((lesson) => (
                                <LessonRow
                                  key={lesson.id}
                                  lesson={lesson}
                                  rules={rules}
                                  reservation={reservationFor(lesson, reservations)}
                                  waitlistEntry={waitlistFor(lesson, waitlist)}
                                  onOpen={() => openLesson(lesson)}
                                />
                              ))}
                            </div>
                          </section>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {section === "reservations" && (
          <section className="my-reservations active">
            <h2 className="section-title">Moje rezervace</h2>
            {!snapshot?.user ? (
              <EmptyState
                icon={<LockKeyhole />}
                title="Rezervace jsou dostupné po přihlášení"
                actionLabel="Přihlásit se"
                onAction={() => setModal("login")}
              />
            ) : (
              <div className="reservations-list">
                {activeReservations.length === 0 && waitingEntries.length === 0 ? (
                  <EmptyState icon={<CalendarDays />} title="Zatím žádné aktivní rezervace" />
                ) : (
                  <>
                    {activeReservations.map((reservation) => {
                      const lesson = lessonById.get(reservation.lessonId);
                      return (
                        <div className="reservation-card" key={reservation.id}>
                          <div className="reservation-info">
                            <h4>{lesson ? activeReservationLabel(reservation, lesson) : "Rezervace"}</h4>
                            <p>{lesson ? `${lesson.roomName} • ${money(reservation.priceKc)}` : money(reservation.priceKc)}</p>
                          </div>
                          <button className="btn-cancel" disabled={busy === `cancel-${reservation.id}`} onClick={() => handleCancel(reservation)}>
                            {busy === `cancel-${reservation.id}` ? "Ruším..." : "Zrušit"}
                          </button>
                        </div>
                      );
                    })}

                    {waitingEntries.map((entry) => {
                      const lesson = lessonById.get(entry.lessonId);
                      if (!lesson) return null;
                      return (
                        <div className="reservation-card waitlist-card" key={entry.id}>
                          <div className="reservation-info">
                            <h4>{lesson.name}</h4>
                            <p>
                              Čekací listina #{entry.position} • {formatDateTime(lesson.startsAt)}
                            </p>
                          </div>
                          <button className="btn btn-outline" disabled={busy === `waitlist-${lesson.id}`} onClick={() => handleWaitlist(lesson)}>
                            Odebrat
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {section === "credit" && (
          <section className="my-reservations active">
            <div className="credit-header">
              <h2 className="section-title">Kredit a platby</h2>
              <div className="credit-balance">{snapshot?.user ? money(snapshot.user.creditBalanceKc) : "Nepřihlášeno"}</div>
            </div>

            <div className="credit-grid">
              <div className="credit-card">
                <h3>Dobít kredit</h3>
                <div className="topup-grid">
                  {rules.topupAmounts.map((amount) => (
                    <button key={amount} className="btn btn-outline" onClick={() => handleTopup(amount)} disabled={busy === `topup-${amount}`}>
                      {busy === `topup-${amount}` ? <Loader2 className="spin" size={16} /> : <CreditCard size={16} />}
                      {money(amount)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="credit-card">
                <h3>Historie kreditu</h3>
                {snapshot?.transactions.length ? (
                  <div className="transactions-list">
                    {snapshot.transactions.slice(0, 6).map((transaction) => (
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
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<WalletCards />} title="Historie se zobrazí po přihlášení" compact />
                )}
              </div>
            </div>
          </section>
        )}

        {section === "profile" && (
          <section className="my-reservations active">
            <h2 className="section-title">Profil klienta</h2>
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
                    <dt>Kredit</dt>
                    <dd>{money(snapshot.user.creditBalanceKc)}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <EmptyState icon={<UserRound />} title="Profil se zobrazí po přihlášení" actionLabel="Přihlásit se" onAction={() => setModal("login")} />
            )}
          </section>
        )}
      </main>

      <nav className="mobile-tabbar" aria-label="Navigace">
        <button className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}>
          <CalendarDays size={18} />
          <span>Rozvrh</span>
        </button>
        <button className={section === "reservations" ? "active" : ""} onClick={() => setSection("reservations")}>
          <Check size={18} />
          <span>Rezervace</span>
        </button>
        <button className={section === "credit" ? "active" : ""} onClick={() => setSection("credit")}>
          <WalletCards size={18} />
          <span>Kredit</span>
        </button>
        {snapshot?.user && (
          <button className={section === "profile" ? "active" : ""} onClick={() => setSection("profile")}>
            <UserRound size={18} />
            <span>Profil</span>
          </button>
        )}
      </nav>

      {modal === "login" && <LoginModal busy={busy} onClose={() => setModal(null)} onLogin={handleLogin} />}

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
    </>
  );
}

function LessonRow({
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
  const reservable = canReserve(lesson, rules);

  return (
    <button className="lesson-row" onClick={onOpen}>
      <div className="lesson-time">
        <span>{formatTime(lesson.startsAt)}</span>
        <small>{formatTime(lesson.endsAt)}</small>
      </div>
      <div className={`lesson-info ${roomClass(lesson.roomName)}`}>
        <div className="lesson-name">{lesson.name}</div>
        <div className="lesson-meta">
          {lesson.instructorName} • {lesson.roomName} • {money(lesson.priceKc)}
        </div>
      </div>
      <div className="lesson-badges">
        {booked && <span className="reservation-badge">Rezervováno</span>}
        {listed && <span className="reservation-badge wait">Čekací listina #{waitlistEntry?.position}</span>}
        {!booked && !listed && !reservable && <span className="reservation-badge muted">Rezervace později</span>}
        <span className={`lesson-status ${occupancyClass(lesson)}`}>{state.label}</span>
      </div>
    </button>
  );
}

function LoginModal({
  busy,
  onClose,
  onLogin,
}: {
  busy: string | null;
  onClose: () => void;
  onLogin: (input: LoginInput) => void;
}) {
  const [login, setLogin] = useState("tereza.novakova@email.cz");
  const [password, setPassword] = useState("1234");
  const [memberCardNumber, setMemberCardNumber] = useState("Z4Y-2048");

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin({ login, password, memberCardNumber });
  }

  return (
    <div className="modal-overlay open" role="dialog" aria-modal="true" aria-label="Přihlášení">
      <div className="modal login-modal">
        <div className="modal-header">
          <h3 className="modal-title">Přihlášení</h3>
          <button className="modal-close" onClick={onClose} aria-label="Zavřít">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <form className="login-form" onSubmit={submitLogin}>
            <label className="login-field">
              <span>Email</span>
              <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="email" />
            </label>
            <label className="login-field">
              <span>Heslo</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <label className="login-field">
              <span>Číslo karty</span>
              <input value={memberCardNumber} onChange={(event) => setMemberCardNumber(event.target.value)} autoComplete="off" />
            </label>
            <div className="modal-actions">
              <button className="btn btn-outline" type="button" onClick={onClose}>
                Zavřít
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy === "login"}>
                {busy === "login" ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />}
                Přihlásit se
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
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
    <div className="modal-overlay open" role="dialog" aria-modal="true" aria-label={lesson.name}>
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title">{lesson.name}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Zavřít">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-instructor-section">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="modal-instructor-photo" src={lesson.instructorPhoto} alt="" />
            <div className="modal-instructor-info">
              <h4>{lesson.instructorName}</h4>
              <p>{lesson.instructorSpecialization}</p>
            </div>
          </div>

          <div className="modal-description">
            <div className="modal-description-title">O lekci</div>
            <div className="modal-description-text">{lesson.description}</div>
          </div>

          <div className="modal-info">
            <div className="modal-info-row">
              <span className="modal-info-label">Čas</span>
              <span className="modal-info-value">
                {formatTime(lesson.startsAt)} - {formatTime(lesson.endsAt)}
              </span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">Den</span>
              <span className="modal-info-value">{formatDateTime(lesson.startsAt)}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">Místnost</span>
              <span className="modal-info-value">{lesson.roomName}</span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">Volná místa</span>
              <span className="modal-info-value">
                {state.free}/{lesson.capacity}
              </span>
            </div>
            <div className="modal-info-row">
              <span className="modal-info-label">Cena</span>
              <span className="modal-info-value">{money(lesson.priceKc)}</span>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-outline" onClick={onClose}>
              Zavřít
            </button>
            {!isLoggedIn ? (
              <button className="btn btn-primary" onClick={onLogin}>
                <LockKeyhole size={16} />
                Přihlásit se
              </button>
            ) : reservation ? (
              <button className="btn btn-outline" disabled>
                <Check size={16} />
                Rezervováno
              </button>
            ) : isFull ? (
              <button className="btn btn-primary" onClick={onWaitlist} disabled={actionBusy}>
                {actionBusy ? <Loader2 className="spin" size={16} /> : <Clock size={16} />}
                {waitlistEntry ? `Odebrat z čekací listiny #${waitlistEntry.position}` : "Zapsat na čekací listinu"}
              </button>
            ) : !reservable ? (
              <button className="btn btn-outline" disabled>
                Rezervace bude otevřená později
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onReserve} disabled={actionBusy}>
                {actionBusy ? <Loader2 className="spin" size={16} /> : <DoorOpen size={16} />}
                Rezervovat
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  actionLabel,
  onAction,
  compact,
}: {
  icon: ReactNode;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty-state compact" : "empty-state"}>
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {actionLabel && onAction && (
        <button className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
