# Luxart API — ověřený kontrakt a přístup

Aktualizace: 2026-08-29

## Potvrzeno

- Veřejná dokumentace je dostupná na `http://api.memberzone.online:9295/Help` a 2026-08-29 vrátila HTTP 200.
- Dokumentace uvádí stejný kontrakt pro testovací i produkční API.
- Dokumentovaný resort Zone4You je `1`.
- Luxart má posílat všechny standardní emailové notifikace. Nová aplikace je nesmí posílat duplicitně.
- Dobití kreditu se po úspěšné platbě zapisuje přes `POST api/Payment`; `POST api/Payment/Cancel` se pro prosté dobití nepoužívá.
- Zone4You API je podle Luxartu instalované na serveru klienta na portu `9759`, ale jeho zpřístupnění zajišťuje IT Zone4You.

## Živá kontrola přístupu

- `/Help` na veřejném testovacím serveru je dostupné.
- Přímé volání datového `api/Lesson` i `api/Login` z vývojového prostředí vrátilo HTTP 401 bez těla.
- Testovací klientské účty z emailu tedy samy o sobě nenahrazují síťovou nebo serverovou autorizaci API.
- Aplikace nyní podporuje oddělenou serverovou gateway autentizaci `none` / Basic / Bearer / vlastní `X-*` hlavičku. Režim musí potvrdit IT a tajné hodnoty patří pouze do secret store; klientský login se pro gateway autentizaci nikdy nepoužije. Outbound adapter odmítá redirect, aby gateway hlavičku nepřenesl na jiný cíl.
- Do vyjasnění se žádné heslo ani hash nesmí zapisovat do logu, repozitáře, URL monitoringu nebo browser storage.

## Kontrakt pro všechny lekce

Pilot načte bez whitelistu všechny záznamy vrácené:

`GET api/Lesson?resort=1&date_start=...&id_kategorie=0&user_id=...&pocet_dni_dopredu=7&id_service=0&lang=cz`

`Lesson_data` obsahuje minimálně:

- datum a čas, délku, ID a název lekce;
- instruktora a ID původního instruktora pro detekci záskoku;
- cenu, sál, kapacitu, obsazenost a volná místa;
- kapacitu pro členy/nečleny a `user_posible` pro konkrétního klienta;
- kategorii, typ a variantu lekce.

UI proto nesmí mít pevný seznam povolených sálů ani typů. Neznámá hodnota se musí zobrazit pod bezpečným fallbackem, ne zahodit.

Squash, stolní tenis a masáže nejsou v dokumentaci vedené jako `Lesson_data`. Používají samostatné oblasti `Courts`, `Services` a `Freetime`; nejsou automaticky součástí věty „všechny lekce“.

## Endpointy kritické pro pilot

1. `POST api/Login?login=...&password=<MD5>&member_card_number=...` → `User_data`.
2. `GET api/User?user_id=...` → aktuální klient a kredit.
3. `GET api/Lesson?...` → všechny lekce na sedm dní.
4. `POST api/Reservations` → vytvoření rezervace.
5. `GET api/Reservations?user_id=...` → rezervace klienta.
6. `DELETE api/Reservations/{id}?kategorie=...&resort=1` → storno a případný storno poplatek.
7. Veřejná dokumentace popisuje `POST api/Reservations/watchdog_III` jako hlídání místa rozšířené o jazyk, `GET api/watchdog_II/user` pro aktivní záznamy a `DELETE api/Watchdog/{id}` pro odebrání. Model neobsahuje pořadí ve frontě; UI proto nesmí slibovat klasickou čekací listinu ani automatickou rezervaci.
8. `POST api/Payment` → připsání úspěšné Stripe platby do kreditu. Veřejný model potvrzuje `uuid` jako kolekci (`["KREDIT"]` pro kredit), `user_id`, `amount`, `id_payment_shop`, `id_payment_pp_1`, `id_payment_pp_2`, `zpusob_uhrady` a elektronické `zpusob_odeslani=0`; nepopisuje enum platební metody ani deduplikační záruku.

## Co musí dodat IT Zone4You do 24 hodin

- hostname nebo IP pro API na portu `9759`;
- způsob přístupu: veřejná HTTPS URL, VPN, nebo allowlist statické odchozí IP hostingu;
- firewall/NAT pravidlo a potvrzení, zda je přístup omezen na konkrétní zdrojové IP;
- platný TLS certifikát; produkční booking na HTTPS nesmí serverově ani z browseru záviset na nechráněném HTTP loginu;
- odpověď, proč veřejné testovací datové endpointy vracejí 401 a jaké serverové autentizační údaje nebo hlavičky vyžadují;
- explicitní potvrzení gateway režimu pro `LUXART_API_AUTH_MODE`; i režim bez hlavičky musí být vědomě potvrzený po úspěšném read-only testu;
- bezpečný testovací režim, ve kterém lze vytvořit a zrušit rezervaci bez dopadu na reálné klienty.

## Zbývající kontraktní otázky pro Luxart

- přesný význam `id_resource_1` pro rezervaci skupinové lekce a jeho vazba na `cislo_salu`;
- mapování Zone4You sálů, kategorií, typů a variant na čitelné názvy;
- zda Zone4You test DB používá zdokumentovanou kombinaci `watchdog_III` + `watchdog_II/user` + `DELETE Watchdog/{id}` a zda je Luxart email šablona aktivní;
- status kódy rezervací a jejich mapování na aktivní, zrušenou, absolvovanou a no-show rezervaci;
- zda API samo vynucuje rezervační okno, minimální kredit a storno pravidla;
- které emailové šablony mají být aktivní pro rezervaci, storno, watchdog hlídání místa, ICS a dobití kreditu.
