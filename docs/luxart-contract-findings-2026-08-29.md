# Luxart API — ověřený kontrakt a přístup

Aktualizace: 2026-09-14

## Potvrzeno

- Veřejná dokumentace je dostupná na `http://api.memberzone.online:9295/Help` a 2026-08-29 vrátila HTTP 200.
- Veřejný příklad `Lesson_data.date_time` používá explicitní UTC čas (`Z`); XML příklad téhož pole používá explicitní offset `+02:00`. Integrace proto přijímá pouze existující ISO datum a čas s `Z` nebo číselným offsetem a nejednoznačný čas bez zóny odmítne bezpečnou chybou.
- Dokumentace uvádí stejný kontrakt pro testovací i produkční API.
- Dokumentovaný resort Zone4You je `1`.
- Luxart má posílat všechny standardní emailové notifikace. Nová aplikace je nesmí posílat duplicitně.
- Dobití kreditu se po úspěšné platbě zapisuje přes `POST api/Payment`; `POST api/Payment/Cancel` se pro prosté dobití nepoužívá.
- Zone4You API je podle Luxartu instalované na serveru klienta na portu `9759`, ale jeho zpřístupnění zajišťuje IT Zone4You.
- Luxart 14. 9. potvrdil stejný REST kontrakt, Zone4You testovací databázi a přístupový model HTTPS + IP allowlist + Basic Auth. Přesný veřejný hostname a certifikát musí dodat IT.

## Živá kontrola přístupu

- `/Help` na veřejném testovacím serveru je dostupné.
- Přímé volání datového `api/Lesson` i `api/Login` z vývojového prostředí vrátilo HTTP 401 bez těla.
- Testovací klientské účty z emailu tedy samy o sobě nenahrazují síťovou nebo serverovou autorizaci API.
- Potvrzeným režimem oddělené serverové gateway autentizace je Basic Auth. Tajné hodnoty patří pouze do secret store; klientský login se pro gateway autentizaci nikdy nepoužije. Outbound adapter odmítá redirect, aby gateway hlavičku nepřenesl na jiný cíl.
- Vstupní časy lekcí, rezervací, historie kreditu a watchdogu jsou validované stejně přísně. Neexistující kalendářní datum, čas bez zóny ani nepřípustný UTC offset se nesmí tiše převést podle časové zóny serveru.
- Odpověď `GET api/User` musí vrátit stejné `user_id`, jaké je v podepsané session a query. Neshoda se odmítne před zobrazením profilu, kreditu nebo kreditní historie.
- Zobrazované texty z API mají podle pole omezený typ a délku; řídicí znaky se odmítnou, zatímco víceřádkový popis lekce zůstává podporovaný.
- Luxart potvrdil pětidenní ukládání klientského password hashe do logu. Protože API přijímá tento hash jako přihlašovací údaj, jde o znovupoužitelný credential a live login zůstává zablokovaný, dokud proxy, webserver, aplikace i monitoring nebudou `login`, `password` a `member_card_number` vynechávat nebo redigovat. Žádné heslo ani hash se nesmí zapisovat do repozitáře, URL monitoringu nebo browser storage.

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

Počet volných míst se bere z autoritativního pole `volno`, nikoli pouhým odečtením `obsazeno` od `kapacita`. Tím se zachovají omezení členských/nečlenských kvót. Záporná hodnota, hodnota nad kapacitou nebo součet `obsazeno + volno` nad kapacitou zneplatní celý feed místo zobrazení falešné dostupnosti.

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

- přesnou veřejnou HTTPS URL a platný TLS certifikát;
- reverse proxy/NAT z veřejné cesty na interní REST službu `9759`, včetně `/Help` na stejném originu;
- allowlist odsouhlasených statických odchozích IP adres booking backendu;
- vypnutí veřejného directory listingu;
- potvrzení redakce `login`, `password` a `member_card_number` ve vlastní proxy a webserverové vrstvě;
- bezpečný testovací režim, ve kterém lze vytvořit a zrušit rezervaci bez dopadu na reálné klienty.

Luxart musí samostatně odstranit stejné citlivé parametry ze svých aplikačních a navazujících logů. Sdílené testovací Basic Auth údaje se neukládají ani nepoužijí přes HTTP; dedikované údaje se vyžádají bezpečným kanálem po ověření HTTPS a allowlistu.

## Zbývající kontraktní otázky pro Luxart

- přesný význam `id_resource_1` pro rezervaci skupinové lekce a jeho vazba na `cislo_salu`;
- mapování Zone4You sálů, kategorií, typů a variant na čitelné názvy;
- zda Zone4You test DB používá zdokumentovanou kombinaci `watchdog_III` + `watchdog_II/user` + `DELETE Watchdog/{id}` a zda je Luxart email šablona aktivní;
- status kódy rezervací a jejich mapování na aktivní, zrušenou, absolvovanou a no-show rezervaci;
- zda API samo vynucuje rezervační okno, minimální kredit a storno pravidla;
- které emailové šablony mají být aktivní pro rezervaci, storno, watchdog hlídání místa, ICS a dobití kreditu.
