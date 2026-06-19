# Zone4You Booking - stav a Luxart integrační plán

Datum auditu: 2026-06-18

## 1. Aktuální stav repozitáře

Repozitář `michalbaturko-lang/zone4youbooking` je v tuto chvíli hlavně statický prototyp a dokumentační balíček.

Produkční Vercel deployment z odkazu klienta:
- projekt: `zone4youbooking`
- deployment id: `dpl_GhpyLJ227FpRdGNBHBrnxBdEbfJz`
- datum: 2026-01-24
- branch/commit: `main@407a2c5`
- stav: statický HTML prototyp

Novější větev:
- branch: `claude/review-booking-redesign-VpnPW`
- commit: `aedd5d4`
- publikovaná větev: `gh-pages@e98c59a`
- datum posledního push/deploye: 2026-02-27
- obsah: dokumentace, Scope of Work, funkční specifikace, návrh AI chatbota, fotky instruktorů, statický prototyp

Technicky důležité:
- V repu není `package.json`, backend, databáze, serverové API routy ani integrační klient.
- `vercel.json` pouze publikuje aktuální adresář jako statický output.
- `index-app.html` a `scheduler-redesign.html` nepoužívají `fetch`, `XMLHttpRequest` ani žádný Luxart endpoint.
- Login je pouze lokální přepínač `isLoggedIn`.
- Rezervace se ukládají jen do `localStorage` pod klíčem `z4y_reservations`.
- Obsazenost lekce se generuje náhodně v prohlížeči.

Závěr: aktuální stav není booking engine. Je to dobře použitelný UX prototyp a podklad pro implementaci.

## 2. Co říká komunikace s Luxartem

Z poslaného vlákna s Luxartem:

- API bylo zprovozněno na serveru klienta na portu `9759`.
- API je napojené na testovací verzi databáze.
- Je potřeba kontaktovat IT Zone4You, aby API zpřístupnilo vývojářům.
- API zatím neposílá emaily.
- Luxart chce vědět, které funkce budeme používat, aby připravil příslušné emailové šablony a doladil procesy na konkrétních službách.

Starší testovací API:
- původní adresa dokumentace byla `http://62.109.132.9:9295/Help`
- aktuálně přes IP vrací IIS chybu `Bad Request - Invalid Hostname`, takže se na ni nedá spolehnout jako na živou dokumentaci

Veřejně dohledané zdroje:
- `https://www.memberpro.cz/Pages/Download.aspx` obsahuje vzdálenou podporu, PDF k reportům, Firebird nástroje a UDF knihovny; REST API dokumentace tam veřejně odkazovaná není.
- Sitemap `memberpro.cz` ukazuje jen hlavní stránku, download, reference a kontakt.
- `https://www.luxart-it.cz/download.aspx` také neobsahuje REST API dokumentaci.
- DNS stopa `api.memberzone.cz` míří na původní IP `62.109.132.9`, ale `/Help` i konkrétní `/Help/Api/...` URL nyní vrací `Bad Request - Invalid Hostname` / případně 404 mimo port 9295.
- Veřejné vyhledávání podle přesných endpointů `GET-api-Login_login_password_member_card_number`, `User_data`, `POST-api-Payment` nenašlo použitelnou indexovanou dokumentaci Luxart/Member Pro.

Známé odpovědi Luxartu z února 2026:

- Pro login se má použít `GET api/Login/{login}/{password}/{member_card_number}`.
- Login vrací strukturu `User_data`.
- Aktuální stav kreditu je součástí `User_data`.
- Po loginu se dá volat `GET api/User/{user_id}` pro aktuální `User_data`.
- `resort` je pro Zone4You vždy `1`.
- CORS Luxart očekává vyřešený na API serveru klienta, ale pro produkční web je bezpečnější volat Luxart ze serverové části naší aplikace.
- HTTPS je na rozhodnutí klienta, Luxart ho doporučuje.
- Dobití kreditu online:
  - platební brána je na naší straně
  - po úspěšné platbě se Luxartu pošle `POST api/Payment`
  - pro dobití kreditu se neposílá `POST api/Payment/Cancel`
  - `Uuid = KREDIT`
  - `user_id = id klienta z loginu`
  - `Amount = částka`
  - `id_payment_shop = náš identifikátor platby`
  - `id_payment_pp_1` a `id_payment_pp_2` = identifikátor z platební brány
  - `zpusob_uhrady = 3`
  - `zpusob_odeslani = 0`

Doplnění z historické session:

- Předchozí agent také narazil na to, že API a aktuální web jsou za firewallem / blokované pro přístup zvenčí.
- V historii se objevují dostupné oblasti API: `Login`, `User_data`, `Lesson`, `Reservations`, `Payment`. Chybí ale konkrétní aktuální dokumentace endpointů a modelů.
- Klient později potvrdil:
  - storno lhůta: 4 hodiny před lekcí
  - pozdní storno: 100 Kč
  - no-show: 100 Kč
  - Stripe přístupy dodá později
- V historii se uvádí heslo = číslo karty, ale Luxart endpoint rozlišuje `password` a `member_card_number`, takže tento login flow je potřeba při integračním testu ověřit.
- V předchozí session údajně vznikly soubory `docs/faze1-tasky.md` a `docs/CODEX-TASK-zone4you-booking.md`, ale v aktuálním repozitáři nejsou přítomné. Pokud existují jen lokálně ve starém prostředí, bude potřeba je znovu vytvořit nebo získat ze zálohy.

## 3. Blokery před implementací proti reálnému API

Kritické:

1. Chybí aktuální hostname/IP adresa serveru Zone4You, na kterém běží port `9759`.
2. Chybí potvrzení, zda je port `9759` dostupný z vývojářských IP a z produkčního hostingu.
3. Chybí aktuální `/Help` dokumentace pro Zone4You instanci.
4. Chybí rozhodnutí, jestli produkční API poběží přes HTTPS.
5. Chybí přesná dokumentace endpointů pro lekce, rezervace, rušení rezervací a waiting list.
6. Chybí Stripe test/live klíče klienta.

Důležité:

1. Rozhodnout, zda emaily bude posílat naše aplikace, Luxart, nebo kombinace. Musí být jeden zdroj pravdy, jinak hrozí duplicitní notifikace.
2. Ověřit vztah hesla a čísla členské karty při reálném login testu.
3. Vyjasnit minimální kredit pro rezervaci: cena konkrétní lekce vs. fixní minimální zůstatek.
4. Vyjasnit Reformer odlišnosti: cena, kapacita, storno lhůta, waiting list.
5. Potvrdit doménu `booking.zone4you.cz` a DNS.

## 4. Doporučená architektura implementace

Aktuální statický prototyp doporučuji převést na server-renderovanou webovou aplikaci, ideálně Next.js + TypeScript.

Navržené vrstvy:

1. `app` / UI
   - denní a týdenní rozvrh
   - login
   - moje rezervace
   - profil/kredit
   - dobití kreditu

2. Serverové API naší aplikace
   - `/api/auth/login`
   - `/api/auth/me`
   - `/api/schedule`
   - `/api/reservations`
   - `/api/reservations/cancel`
   - `/api/waitlist`
   - `/api/payments/checkout`
   - `/api/payments/webhook`

3. Luxart adapter
   - jediná vrstva, která zná konkrétní Luxart endpointy, parametry a response mapping
   - runtime config přes env proměnné
   - retry/timeouts/logging
   - testovací mock adapter pro lokální vývoj bez přístupu na port `9759`

4. Stripe adapter
   - Checkout nebo Payment Intents
   - po úspěšném webhooku zavolat Luxart `POST api/Payment`
   - idempotence přes náš payment id

5. Notifications
   - rozhodnout jeden primární systém: naše aplikace vs. Luxart
   - pokud naše aplikace: Resend/SendGrid + WhatsApp Business API/Twilio
   - pokud Luxart: dodat Luxartu seznam template ID a proměnných

Proč serverová vrstva, i když Luxart píše, že API vrací CORS:

- Login heslo nesmí zůstávat v browser logice ani v query stringu, pokud tomu lze zabránit.
- Produkční web poběží na HTTPS; přímé volání `http://...:9759` z browseru by způsobilo mixed-content problém.
- Pokud bude API dostupné jen z vybraných IP/VPN, serverová proxy je praktičtější než přímý browser access.
- Snáz se drží session, audit log, idempotence plateb a bezpečnost rezervací.

## 5. MVP endpoint checklist

Níže jsou funkce, které potřebujeme potvrdit proti aktuální Luxart dokumentaci.

### Auth a uživatel

- Login klienta
  - známý endpoint: `GET api/Login/{login}/{password}/{member_card_number}`
  - otevřené: existuje bezpečnější `POST api/Login`?
  - výstup: `User_data`, hlavně `user_id`, jméno, email, kredit, členství

- Aktuální klient
  - známý endpoint: `GET api/User/{user_id}`
  - výstup: aktuální `User_data`

- Zapomenuté heslo
  - potřeba potvrdit endpoint a jestli Luxart pošle email 1030

### Rozvrh a lekce

- Seznam lekcí/služeb v období
  - z komunikace víme o endpointu typu `api/Lesson`
  - potřeba potvrdit parametry: `resort`, datum od/do, typ služby, sál, instruktor
  - potřeba mapovat: lesson id, service id, název, čas, délka, instruktor, zástup, sál, kapacita, obsazeno, cena, rezervovatelné od/do

- Detail lekce
  - potřeba potvrdit endpoint
  - potřeba znát kapacitu, cenu, storno pravidla, waiting list stav

### Rezervace

- Seznam rezervací klienta
  - z komunikace víme o endpointu typu `api/Reservations`
  - potřeba potvrdit parametry a response model

- Vytvoření rezervace
  - potřeba potvrdit endpoint, payload, response a chybové kódy
  - business pravidla na naší straně i v Luxartu:
    - klient musí být přihlášený
    - rezervace maximálně 48 hodin dopředu
    - kredit se strhává při rezervaci
    - dostatečný kredit
    - zákaz duplicitní rezervace stejné lekce

- Zrušení rezervace
  - potřeba potvrdit endpoint
  - pravidla:
    - zrušení >= 4 h před lekcí: vrátit kredit
    - zrušení < 4 h před lekcí: poplatek 100 Kč
    - no-show: poplatek 100 Kč

### Waiting list

- Zápis na waiting list
- Zrušení waiting list zápisu
- Pozice klienta ve waiting listu
- Automatické zařazení po uvolnění místa
- Pravidlo při nedostatku kreditu: přeskočit na dalšího
- Maximum 10 lidí na lekci

Toto je přesně oblast, kterou chce Luxart doladit na konkrétních službách.

### Kredit a platby

- Zobrazení kreditu
  - přes `User_data`

- Dobití kreditu
  - Stripe platba u nás
  - po úspěchu zavolat `POST api/Payment`
  - nutná idempotence: stejný Stripe webhook nesmí dobít kredit dvakrát

- Historie transakcí
  - potřeba potvrdit endpoint u Luxartu
  - pokud neexistuje, držet vlastní platební historii jen pro Stripe top-upy a Luxart číst jako zdroj kreditu

## 6. Odpověď pro Luxart: používané funkce

Navržená odpověď Luxartu:

> Dobrý den,
>
> pro nový frontend Zone4You budeme ve Fázi 1 používat tyto funkce API:
>
> 1. Přihlášení klienta a načtení `User_data`.
> 2. Načtení aktuálního klienta včetně kreditu.
> 3. Načtení rozvrhu skupinových lekcí a Reformer lekcí.
> 4. Načtení obsazenosti, ceny, instruktora, sálu a rezervovatelnosti lekce.
> 5. Zápis rezervace služby/lekce.
> 6. Zrušení rezervace služby/lekce.
> 7. Waiting list: zápis, zrušení zápisu, pozice klienta a automatické přesunutí na lekci při uvolnění místa.
> 8. Dobití kreditu: platební bránu řešíme u nás, po úspěšné platbě posíláme `POST api/Payment` s `Uuid=KREDIT`.
> 9. Zapomenuté heslo/reset hesla, pokud je endpoint dostupný.
>
> Registraci nových klientů přes web ve Fázi 1 nepoužíváme. Admin rozhraní, správa rozvrhu, klientů a statistik zůstává v Luxart/Member Pro.
>
> Prosíme o aktuální URL k `/Help` dokumentaci na Zone4You serveru s API na portu 9759, seznam endpointů/payloadů pro uvedené funkce a informaci, zda bude API dostupné přes HTTPS.
>
> Dále prosíme potvrdit, které emaily má posílat Luxart a které naše aplikace, aby nedocházelo k duplicitám. Pokud budou emaily přes Luxart, pro Fázi 1 předpokládáme zejména: reset hesla, potvrzení rezervace, zrušení služby, uvolnění místa / waiting list, dobití kreditu a případně ICS potvrzení.

## 7. Odpověď pro IT Zone4You: přístup na API

Navržená odpověď IT:

> Dobrý den,
>
> podle Luxartu běží testovací API pro Zone4You na vašem serveru na portu 9759. Prosíme o:
>
> 1. hostname nebo IP adresu serveru,
> 2. potvrzení URL dokumentace, ideálně `http(s)://<host>:9759/Help`,
> 3. informaci, zda je port 9759 dostupný z internetu, přes VPN, nebo pouze interně,
> 4. případné IP allowlist požadavky,
> 5. potvrzení, zda je na API dostupné HTTPS,
> 6. testovací přihlašovací údaje klienta,
> 7. potvrzení, zda má API povolené CORS pro `booking.zone4you.cz`, pokud bychom testovali přímé browser volání.
>
> Preferujeme serverové volání z našeho backendu, ale pro lokální integrační testy potřebujeme přístup k `/Help` a testovacím endpointům.

## 8. Doporučený implementační postup

### Krok 1 - Přístup a dokumentace

- Získat host/IP pro port `9759`.
- Otevřít `/Help`.
- Exportovat endpointy a modely, nebo ručně uložit HTML dokumentaci.
- Ověřit testovací login.

### Krok 2 - Technická migrace repa

- Převést statický prototyp na Next.js + TypeScript.
- Zachovat aktuální vizuální styl z `index-app.html`.
- Rozdělit UI na komponenty: schedule, lesson detail, auth, reservations, credit, profile.
- Přidat env config:
  - `LUXART_API_BASE_URL`
  - `LUXART_RESORT_ID=1`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `APP_BASE_URL`

### Krok 3 - Luxart adapter

- Implementovat adapter s mock režimem.
- Přidat integrační testy proti mock datům.
- Přidat live smoke script pro testovací API, spouštěný pouze s env proměnnými.

### Krok 4 - MVP flow

Pořadí implementace:

1. Login + session + `User_data`.
2. Rozvrh z Luxartu.
3. Detail lekce s obsazeností/cenou.
4. Moje rezervace.
5. Vytvoření rezervace.
6. Zrušení rezervace.
7. Stripe top-up + `POST api/Payment`.
8. Waiting list.
9. Email/WhatsApp notifikace podle zvoleného zdroje.

### Krok 5 - Akceptační scénáře

Minimální testovací scénáře:

1. Klient se přihlásí a vidí kredit.
2. Klient vidí rozvrh na 48 hodin dopředu.
3. Klient se zarezervuje na lekci s volnou kapacitou.
4. Kredit se po rezervaci sníží.
5. Klient vidí rezervaci v "Moje rezervace".
6. Klient zruší rezervaci více než 4 hodiny předem a kredit se vrátí.
7. Klient nemůže rezervovat při nedostatečném kreditu.
8. Plná lekce nabídne waiting list.
9. Po uvolnění místa se klient z waiting listu automaticky přesune, pokud má dost kreditu.
10. Stripe top-up připíše kredit v Luxartu přes `POST api/Payment` právě jednou.

## 9. Rozhodnutí pro klienta

Tyto body je potřeba potvrdit před ostrou implementací:

1. Produkční doména: `booking.zone4you.cz`.
2. HTTPS pro web i API.
3. Minimální kredit pro rezervaci.
4. Přesná pravidla Reformer lekcí.
5. Zda emaily odesílá Luxart, naše aplikace, nebo rozděleně.
6. WhatsApp Business API poskytovatel.
7. Stripe účet a test/live klíče.
8. Finální potvrzení storno/no-show pravidel v Luxartu: 4 h / 100 Kč / 100 Kč.

## 10. Krátký verdikt

Historická session pomáhá hlavně s business pravidly a implementačním rozsahem: potvrzuje storno 4 h, pozdní storno 100 Kč, no-show 100 Kč a to, že Stripe klíče ještě nebyly dodané. Nepomáhá ale s hlavním technickým blokátorem: stále chybí aktuální `/Help` dokumentace a přístup na Zone4You API na portu `9759`.

Luxart API je podle komunikace připravené jako testovací backend, ale současný repozitář na něj není napojený. Nejbližší smysluplná práce je integrační spike proti reálné `/Help` dokumentaci na portu `9759`, poté migrace statického prototypu na aplikaci se serverovou integrační vrstvou.
