# Luxart API — read-only kontrola kontraktu 11. 9. 2026

Tento záznam je pouze neosobní read-only evidence veřejné referenční dokumentace. Není důkazem dostupnosti Zone4You instance na portu `9191`, souhlasem s mutací ani autoritou k deployi.

## Zjištění

- Referenční `http://api.memberzone.online:9295/Help` odpovědělo HTTP 200.
- Neautentizovaný `GET /api/Lesson` odpověděl 401; žádné přihlašovací údaje ani osobní data nebyly odeslány.
- Ve 21:04 CEST byl proti stejnému referenčnímu originu spuštěn i skutečný projektový read-only adapter v explicitním staging diagnostickém režimu. Anonymní CZ/EN načtení skončilo očekávaným `401`; tím je ověřeno, že veřejný kontrakt sice odpovídá implementaci, ale datová cesta vyžaduje autentizaci. Testovací login nebyl přes HTTP odeslán a ověřovač nyní takový pokus technicky odmítne ještě před vytvořením adapteru nebo síťovým požadavkem.
- Dokumentace uvádí potřebné kontrakty pro login, všechny `Lesson` položky, seznam/vytvoření/storno rezervace a watchdog.
- Automatický `verify:luxart-public-contract` ověřuje 11 používaných endpointů podle jejich HTTP metody, přesného titulku a povinných polí. Výstup je vždy `referenceOnly=true`, `launchAuthority=false` a neobsahuje cílový hostname ani syrové HTML.
- Aktuální dokumentace rozlišuje dvě podoby členské karty: odpověď `POST api/Login` uvádí `member_card`, zatímco `GET api/User` uvádí také `member_card_number`. Adaptér přijímá obě varianty a při jejich současné přítomnosti dává přednost `member_card_number`.
- Storno odpověď obsahuje `storno_poplatek`; UI proto nesmí částku domýšlet a ukazuje hodnotu vrácenou Luxartem.
- Veřejná ukázka storna vrací `success: 1`, ale význam ostatních celočíselných hodnot nepopisuje. Adapter proto pro rezervaci i watchdog přijímá pouze dříve používané úspěšné kódy `1`/`2`; `0`, záporná i jiná kladná hodnota jsou odmítnuty. Přesný enum musí potvrdit živý UAT, nikdy se však nesmí ukázat falešné úspěšné storno.
- `Lesson_data` obsahuje mimo jiné datum a čas, službu, cenu, název, popis, kapacity/obsazenost, `cislo_salu`, instruktora a příznak rezervovatelnosti. To odpovídá pilotnímu rozsahu všech lekcí, všech sálů a Reformeru.
- Dokumentace popisuje `user_posible` jako „Může konkrétní klient?“, ale neuvádí enum. Mapper proto přijme pouze binární `0`/`1` (a nepřítomnou hodnotu u anonymního feedu). Všechny lekce zůstávají ve výpisu, avšak personalizovaná rezervační cesta vyžaduje známou hodnotu: `0` zablokuje klienta a chybějící či jiný kód zastaví POST ještě před Luxartem. Živý read-only test musí potvrdit skutečné hodnoty Zone4You instance.
- Release-grade read-only kontrola proto po testovacím loginu znovu načte celý český i anglický rozvrh. Vyžaduje shodný počet i hash výskytů proti anonymnímu feedu, binární způsobilost každé lekce a shodné počty povolených/nepovolených položek mezi jazyky; důkaz neukládá názvy účtů ani ID lekcí.
- Runtime validace nyní pokrývá i celé seznamy rezervací, watchdogu a historie kreditu. Cizí resort, watchdog jiného klienta, neplatná povinná ID/data/částky, duplicitní výsledné identifikátory nebo objekt místo očekávaného pole způsobí bezpečné odmítnutí celé odpovědi; adaptér nevytvoří ani neschová částečný falešný stav účtu.
- Stejná ochrana platí přímo uvnitř adaptéru pro seznam lekcí. Pokud Luxart vrátí dvě položky se stejným ID výskytu, interní předrezervační načtení skončí bezpečnou chybou ještě před vytvořením payloadu; konfliktní sál nebo resource se proto nemůže vyřešit pořadím řádků.
- Po mutaci se validuje objekt, celočíselný stav a povinné výsledné hodnoty. Rezervace bez Luxart `uuid` je úspěšná jen tehdy, když ji následný seznam jednoznačně potvrdí; chybějící potvrzení, vadný storno poplatek, prázdná/mnohonásobná delete odpověď nebo neplatné `id_mp` po platbě přechází do stavu nejistého výsledku pro ruční reconciliation. Adaptér negeneruje náhradní náhodné ID a klientovi nevrací syrový `messaget` z upstreamu.
- Nový automatický `probe:luxart-help` na referenčním portu `9295` v 12:43 CEST prošel s HTTP 200 a klasifikací `ready`; bezpečný výstup neobsahuje hostname ani credentials.
- Stejný probe na zjevné veřejné Zone4You variantě s portem `9191` skončil connect timeoutem. Host ale nebyl IT potvrzen, proto jde pouze o negativní kandidátní pozorování, nikoli o definitivní stav portu.
- Samostatný kandidátní test stejného Luxart hostname na portu `9191` v 16:17 CEST dosáhl HTTP služby, ale `/Help` vrátilo 404, HTTPS nebylo podporováno a kořen byl pouze obecný HTML index. Současný referenční `:9295/Help` přitom znovu prošel s HTTP 200 a klasifikací `ready`. Port `9191` proto není záměnný za REST origin na `9295` a pouhá změna portu v konfiguraci by integraci rozbila.
- Původní Luxart zpráva z 1. 4. 2026 potvrzuje API na serveru Zone4You na interním portu `9759` a testovací databázi. Port `9191` je proto pravděpodobný veřejný překlad na tuto službu, nikoli port referenčního Luxart hostu; přesný NAT/reverse-proxy vztah musí potvrdit IT.
- Následný neautentizovaný IPv4 probe běžných Zone4You hostname variant na portech `9191` i `9759` skončil connect timeoutem přes HTTP i HTTPS. To je konzistentní s neaktivním pravidlem, jiným hostem, VPN nebo allowlistem, ale samo o sobě žádnou variantu nepotvrzuje.
- Kořen služby `api.memberzone.online:9191` zveřejňuje directory listing s názvy aplikačních adresářů a konfiguračních souborů. Bez credentials byl načten pouze odkazovaný `Service1.svc` a jeho veřejné WSDL. Opakované ověření ve 21:16 CEST potvrdilo mimo jiné operace `Login`, `GetClient`, `GetResource`, `GetServices`, `GetReservation`, `SetReservation`, `UPD_Reservation` a `DEL_Reservation`; jde tedy skutečně o rezervační SOAP/WCF službu, nikoli o dokumentované REST `api/Lesson`. Žádný konfigurační soubor nebyl otevřen. Správce má vypnout directory browsing a IT s Luxartem musí písemně určit, zda je pro nový booking autoritativní REST kontrakt na `9295`, nebo tento SOAP kontrakt na `9191`.

### Strojový audit SOAP/WCF kandidáta

Ve 21:47 CEST proběhl nový čistě neautentizovaný audit veřejného WSDL a importů `xsd0`, `xsd2` a `xsd3`:

- 4/4 dokumenty byly dostupné bez přesměrování;
- 8/8 potřebných kandidátních operací bylo přítomných;
- strukturální SHA-256 operací, návratových tabulek a relevantních polí: `ea560236c6623987b0ea881f33b675134fe3c16199512936619802ee0ba210b8`;
- `GetReservation` dokumentuje čas, resource, cenu, obsazenost a kapacitu; `GetResource` a `GetServices` poskytují kandidátní číselníky; `Login` vrací klienta a kredit;
- kontrakt ale nedokumentuje samostatnou operaci `Lesson`, volbu jazyka, ekvivalent REST `user_posible`, watchdog, identitu Zone4You testovací databáze ani HTTPS transport.

Výsledek je proto `ok=true` pro strukturální veřejný kontrakt, ale `pilotCompatibility.status=unproven` a `launchAuthority=false`. Není to důkaz, že `GetReservation` vrací úplný stejný soubor všech lekcí jako REST `api/Lesson`, ani povolení použít testovací klientské údaje přes HTTP.

## Aktuální automatický důkaz kontraktu

Znovu ověřeno ve 21:39 CEST:

```bash
npm run verify:luxart-public-contract
```

- výsledek: `ok=true`;
- ověřeno: `11/11` endpointů;
- chybějící pole nebo neočekávaný dokument: `0`;
- sémantický SHA-256 nad názvy endpointů a jejich dokumentovanými poli: `869beb3af67e648854462982b15f099aad622992dbbc81c2ec5bb4c9afc7bf20`.

První běh ve 21:38 CEST krátce vrátil `500` pouze pro dokumentační stránku `POST api/Reservations/watchdog_III`. Tři bezprostřední read-only kontroly stejné stránky následně shodně vrátily HTTP 200 a celý 11endpointový verifier znovu prošel se stejným sémantickým hashem. Jde o pozorovanou přechodnou nestabilitu referenční dokumentace, nikoli živý Zone4You důkaz; release autoritu má nadále až D1 proti potvrzenému šifrovanému test originu.

Sémantický otisk záměrně ignoruje CSS, bundlované asset URL a další prezentační HTML. Při změně názvu endpointu nebo datových polí se naopak změní a povinné pole použité adaptérem způsobí `NO-GO` výsledek.

## Release dopad

Adaptér lze dál vyvíjet a lokálně testovat proti REST kontraktu na `9295`. Současný `RealLuxartAdapter` volá JSON endpointy `/api/Login`, `/api/User`, `/api/Lesson`, `/api/Reservations`, `/api/Watchdog` a `/api/Payment`; se SOAP/WCF `Service1.svc` na `9191` není kompatibilní bez nové transportní a mapovací vrstvy. Živý D1 se otevře až po písemném určení autoritativního kontraktu, potvrzení přesného Zone4You cíle a testovací databáze a dodání bezpečného šifrovaného přístupu. Rezervační zápisy zůstanou vypnuté až do samostatně povoleného UAT, mapování všech pozorovaných sálů, PostgreSQL ledgeru, úplných business pravidel, rollbacku a výslovného cutover schválení.

Pokud Luxart vybere SOAP, musí před implementací potvrdit zejména: zda `GetReservation` vrací všechny skupinové lekce a Reformer; hodnotu `ID_ACTIVITY_IN` pro Zone4You; význam `ID`, `ID_DETAIL`, `ID_ACTIVITY`, `ID_RESOURCE`, `POCET_VLATNICH` a `READ_OLNLY`; ekvivalent osobní rezervovatelnosti; získání seznamu klientových rezervací; jazykovou strategii; ekvivalent watchdogu; stabilní chybové kódy; a bezpečný HTTPS test origin. Teprve potom lze přidat samostatný SOAP adapter za existující rozhraní `LuxartAdapter` a znovu použít současnou doménu, UI a release brány.
