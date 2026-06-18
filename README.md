# Zone4You Booking

Prezentacni booking engine pro Zone4You. Aktualni stav je Next.js aplikace nad mock Luxart adapterem, pripravena na napojeni realneho Luxart API po dodani aktualni `/Help` dokumentace pro port `9759`.

## Spusteni

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3007
```

Demo URL:

```text
http://localhost:3007
```

Klientsky Vercel preview link je Shareable Link s tokenem v URL. Nepatri do verejneho repozitare; aktualni odkaz je soucasti handoff zpravy.

## Overeni

```bash
npm run typecheck
npm run build
npm audit --omit=dev
APP_BASE_URL=http://localhost:3007 npm run smoke:api
```

## Demo klient

- login: `demo@zone4you.cz`
- heslo: `1234`
- karta: `Z4Y-2048`

V aplikaci je tlacitko `Reset demo`, ktere vrati mock data do cisteho startovniho stavu.

## Architektura

- `src/lib/domain.ts` drzi stabilni datovy kontrakt.
- `src/lib/mockLuxart.ts` je in-memory demo provider.
- `src/lib/realLuxartAdapter.ts` je skeleton pro realne Luxart API.
- `src/app/api/*` jsou BFF route handlery pripravene pro pozdejsi prepnuti UI na serverovou vrstvu.
- `src/app/page.tsx` je klientsky booking dashboard pro prezentaci.

## API routes

- `GET /api/booking/snapshot`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/lessons`
- `GET /api/reservations`
- `POST /api/reservations`
- `DELETE /api/reservations/:reservationId`
- `GET /api/waitlist`
- `POST /api/waitlist`
- `DELETE /api/waitlist/:waitlistEntryId`
- `GET /api/credit/transactions`
- `POST /api/topups`
- `POST /api/demo/reset`

## Co chybi od Luxartu

- aktualni URL `http(s)://<host>:9759/Help`
- endpoint a model pro lekce
- endpoint a model pro rezervace
- endpoint a model pro storno
- endpoint a model pro waiting list
- potvrzeni login flow: `password` vs. `member_card_number`
- potvrzeni, kdo posila emailove notifikace

Do te doby lze rozvijet UI, BFF routes, Stripe skeleton, testy a demo data bez blokace.
