# Zone4You Booking - integracni pripravenost

Datum: 2026-06-18

## Stav

Aplikace ma oddeleny doménovy model, mock Luxart adapter a serverove API routy. To znamena, ze do prichodu aktualni Luxart dokumentace muzeme rozvijet booking flow bez vazby na konkretni REST payloady.

## Co je pripravene

- `LuxartAdapter` interface v `src/lib/domain.ts`
- mock provider v `src/lib/mockLuxart.ts`
- real provider skeleton v `src/lib/realLuxartAdapter.ts`
- adapter provider prepinany pres `LUXART_MOCK`
- BFF routes v `src/app/api/*`
- API smoke script `npm run smoke:api`
- demo reset endpoint `POST /api/demo/reset`

## Env promenne

```bash
LUXART_MOCK=true
LUXART_API_BASE_URL=http://zone4you-api-host:9759
LUXART_RESORT_ID=1
LUXART_TIMEOUT_MS=12000
```

Pro demo nechte `LUXART_MOCK=true`. Po dodani dokumentace a pristupu k API se bude testovat `LUXART_MOCK=false`.

## RealLuxartAdapter TODO

1. Login
   - znamy endpoint: `GET api/Login/{login}/{password}/{member_card_number}`
   - nutne namapovat `User_data` na `User`

2. Current user
   - znamy endpoint: `GET api/User/{user_id}`
   - kredit je soucasti `User_data`

3. Lessons
   - cekame na aktualni endpointy/modely pro `Lesson`
   - nutne overit kapacitu, obsazenost, cenu, sal, instruktora, zastup, rezervovatelnost

4. Reservations
   - cekame na aktualni endpointy/modely pro `Reservations`
   - nutne overit create/cancel payloady a chyby

5. Waitlist
   - cekame na endpointy pro zapis, odebrani, pozici a auto-promote

6. Top-up
   - po Stripe uspechu volat `POST api/Payment`
   - potvrzene hodnoty:
     - `Uuid=KREDIT`
     - `zpusob_uhrady=3`
     - `zpusob_odeslani=0`

## Smoke testy

Lokální demo:

```bash
npm run dev -- --port 3007
APP_BASE_URL=http://localhost:3007 npm run smoke:api
```

Scenar testu:

1. reset mock dat
2. login demo klienta
3. snapshot
4. vytvoreni rezervace
5. zruseni rezervace
6. zapis/odebrani z waiting listu
7. dobit kreditu
8. finalni snapshot
