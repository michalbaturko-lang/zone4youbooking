# Zone4You IT — příjem a vyhodnocení odpovědi

Aktualizace: 2026-09-12

Tento checklist slouží pouze k vyhodnocení technické odpovědi. Není souhlasem s deployem, DNS změnou ani živou Luxart mutací. Hesla, tokeny, privátní klíče a klientské přihlašovací údaje se do tohoto souboru ani do repozitáře nevkládají.

## 1. Záznam odpovědi bez tajných hodnot

| Položka | Přijatá odpověď | Stav |
|---|---|---|
| Datum a technický kontakt | 11. 9. 2026, odpověď Zone4You IT | přijato |
| API kontrakt a root | objednaný kontrakt je REST na interním portu `9759`; IT potvrdilo zveřejnění `9191`. Z dřívější zprávy Luxartu lze odvodit kandidátní hostname `api.memberzone.online`, ale IT nepotvrdilo, že jeho `9191` překládá na Zone4You `9759` | blokuje test |
| Testovací databáze potvrzena | Luxart 1. 4. potvrdil test DB za interním portem `9759`; IT nepotvrdilo, že veřejný `9191` vede právě na ni | blokuje test |
| Síťová cesta | kandidátní `api.memberzone.online:9191` je dosažitelný, ale aktuálně publikuje jiný SOAP kontrakt; Zone4You REST `/Help` a `/api/Lesson` na něm nejsou dostupné | chybné nebo nepotvrzené směrování |
| Gateway autentizace | v odpovědi neuvedena; nelze z toho odvodit režim `none` | nepotvrzeno |
| Bezpečný kanál pro secrets | secret store / jiný schválený kanál | čeká se |
| Read-only test povolen | výslovně neuvedeno | nepotvrzeno |
| Jedna rezervace a storno povoleny | port je určen „kvůli rezervacím“, ale testovací mutace ani storno nejsou výslovně povoleny | nepotvrzeno |
| `cislo_salu` → `id_resource` | vlastník nebo úplná tabulka | čeká se |
| Watchdog a Luxart notifikace | endpointy a aktivní šablony potvrzeny / nepotvrzeny | čeká se |
| DNS vlastník | jméno/role, ne přístupové údaje | čeká se |
| Staging hostname | dostupný / návrh / nedostupný | čeká se |

## 2. Automatické rozhodnutí o dalším kroku

### Vyhodnocení odpovědi z 11. 9. 2026

- Je potvrzená dohoda Luxart ↔ Zone4You IT o zveřejnění nového portu `9191` pro rezervace.
- Historický port `9759` proto nelze dál automaticky považovat za externí vstupní port.
- Podle celé e-mailové historie má `9191` pravděpodobně být veřejný překlad na interní REST port `9759`, ale přesný hostitel a vazbu musí potvrdit IT; konfigurace ji nesmí předpokládat.
- Formulace „zveřejnění portu“ neprokazuje veřejný hostname/IP, překlad na interní REST port, HTTPS ani gateway režim.
- `api.memberzone.online:9191` může být zamýšlený veřejný Zone4You cíl, ale v současné podobě není použitelný: vrací jiný SOAP kontrakt a nikoli REST aplikaci popsanou Luxartem. Nejpravděpodobnější je chybné přesměrování, jiný cílový web v IIS nebo chybějící path binding; potvrdit a opravit to musí IT.

### A — lze spustit read-only Luxart ověření

Musí být současně známé:

- přesná veřejná API + `/Help` URL pro Zone4You REST `memberzone_rest_v1` a potvrzení překladu na interní port `9759`;
- bezpečná síťová cesta;
- explicitní gateway auth režim;
- potvrzení testovací databáze;
- výslovné povolení read-only testu;
- případné credentials jsou vložené mimo e-mail a repozitář.

Poté lze spustit pouze složenou read-only bránu `verify:luxart-d1`, která nejprve ověří explicitní REST kontrakt, přesný schválený HTTPS origin, `/Help`, potvrzený gateway režim a resort 1 a až potom provede autentizovaný CS/EN read-only test. Port odvodí z originu a nepoužívá jej jako náhradu za identitu kontraktu. Výstup smí obsahovat jen agregované počty, rozsah dat, čísla sálů a hashe množiny výskytů — nikdy osobní data nebo syrové odpovědi.

### B — lze připravit řízené rezervační UAT

K podmínkám A musí navíc existovat:

- výslovné povolení jedné testovací rezervace a jejího storna;
- určený testovací klient a bezpečná testovací lekce předané schváleným kanálem;
- úplné mapování každého pozorovaného `cislo_salu` na `id_resource`;
- potvrzená business pravidla a jejich schválený profil;
- PostgreSQL booking ledger a rate limiter na stagingu;
- připravený návrat testovacího klienta do původního stavu.

Dokud kterákoli podmínka chybí, booking mutace zůstávají vypnuté.

### C — odpověď není dostatečná

Read-only test se nespouští, pokud chybí síťová cesta, gateway režim, potvrzení test DB nebo read-only povolení. Nezabezpečený veřejný HTTP endpoint není produkční řešení; lze jej výslovně přijmout pouze pro dočasný stagingový test.

## 3. Co po přijetí odpovědi ověřit

1. Zkontrolovat, že URL neobsahuje username, heslo ani token.
2. Ověřit `/Help` a gateway konfiguraci bez klientského loginu.
3. Spustit anonymní i přihlášený český a anglický read-only feed pro přesně sedm pražských kalendářních dnů.
4. Porovnat počet a hash všech anonymních i personalizovaných výskytů, sály a Reformer; neznámý sál ani `user_posible=0` nesmí položku zahodit a každá přihlášená položka musí mít binární rezervovatelnost.
5. Získat úplné mapování všech skutečně pozorovaných čísel sálů.
6. Teprve po samostatné autoritě připravit staging, alert, rollback a jedno řízené UAT.
7. Produkční deploy, DNS a cutover zůstávají samostatně schvalované akce.

### Síťové pozorování 11.–12. 9. 2026

- Neautentizovaný probe veřejné referenční dokumentace Luxartu na portu `9295` prošel: HTTP 200 a rozpoznaná stránka `API dokumentace`.
- Obvyklé veřejné Zone4You hostname varianty na portu `9191` při HTTP i HTTPS z tohoto vývojového připojení timeoutovaly.
- Toto pozorování nedokazuje, že je port obecně zavřený: IT může používat jiný hostname, VPN nebo allowlist. Dokazuje pouze, že bez přesné URL není z aktuálního připojení dosažitelná žádná zjevná veřejná varianta.
- Následný explicitní kandidátní test `api.memberzone.online:9191` ukázal jinou službu: HTTP kořen odpověděl 200 obecnou indexovou stránkou, ale `/Help` odpovědělo 404 a HTTPS selhalo, protože port mluví pouze prostým HTTP. Naproti tomu referenční `:9295/Help` ve stejném okamžiku znovu odpovědělo 200 a bylo rozpoznáno jako Luxart API dokumentace.
- Původní Luxart zpráva označuje `api.memberzone.online:9295` za referenční testovací API a současně uvádí, že API u klienta musí veřejně zpřístupnit jeho IT. Z toho plyne, že samotné doplnění `:9191` ke stejnému Luxart hostname není potvrzená ani funkční Zone4You URL.
- Hostname `api.memberzone.online` tím není trvale vyloučený: IT nebo Luxart mohou na jeho samostatném portu 9191 později správně zveřejnit Zone4You reverse proxy. Release brána proto nerozhoduje podle hostname, ale vyžaduje schválený SHA-256 otisk přesného HTTPS originu, funkční `/Help` a následný autentizovaný read-only důkaz ze stejného originu. Současná podoba `http://api.memberzone.online:9191` tyto podmínky nesplňuje.
- Starší přiložená zpráva Luxartu z 1. 4. 2026 výslovně uvádí, že API připojené k testovací databázi bylo spuštěno na serveru Zone4You na portu `9759`. Nejpravděpodobnější pracovní interpretace je proto veřejné přesměrování `9191` na interní `9759`; zůstává to ale hypotéza, dokud IT nepotvrdí host a vazbu portů.
- Následná IPv4 kontrola běžných Zone4You hostname variant timeoutovala na portech `9191` i `9759` pro HTTP i HTTPS. Všechny zjištěné názvy míří na stejný veřejný okraj, ale tento výsledek nerozliší neaplikované pravidlo, jiný cílový host, VPN ani zdrojový allowlist.
- HTTP kořen `api.memberzone.online:9191` veřejně vypisuje názvy aplikačních adresářů a konfiguračních souborů jiné služby. Bez credentials byl načten pouze veřejný `Service1.svc` a jeho WSDL; jde o starší SOAP/WCF kontrakt s rezervačními operacemi, ne o REST API s `api/Lesson`. Konfigurační soubory otevřeny nebyly. Pokud server spravuje Luxart, je vhodné vypnout directory browsing; tato služba se nesmí zaměnit za Zone4You API.
- Nebyl odeslán login, heslo, cookie ani autorizační hlavička a nebyla provedena žádná API mutace.

## 4. Výsledek vyhodnocení

- Read-only integrace: `NEPOVOLENA` — chybí veřejný šifrovaný Zone4You REST origin, potvrzení překladu na `9759`, test DB a auth režim
- Rezervační UAT: `NEPOVOLENO` — chybí read-only důkaz, explicitní testovací autorita, mapování sálů a úplná business pravidla
- Deployment: vždy `NEAUTORIZOVÁN`, dokud nevznikne samostatné schválení
- DNS/cutover: vždy `NEAUTORIZOVÁN`, dokud nevznikne samostatné schválení
- Nejbližší bezpečný krok: získat od IT přesný veřejný hostname/IP, celé HTTPS URL a potvrzení, že port `9191` směruje na interní REST port `9759` a testovací databázi Zone4You. Poté se spustí pouze neautentizovaný `npm run probe:luxart-help`; klientské přihlašovací údaje se použijí až po bezpečném transportním a gateway důkazu. Endpoint monitor je aktivní každé dvě hodiny a zůstává tichý, dokud se stav významně nezmění.
- Help probe při chybějícím REST `/Help` bezpečně načte pouze veřejný kořen a `/Service1.svc?wsdl`. Rozliší SOAP/WCF službu a veřejný directory listing, ale nikdy nenásleduje odkazy na konfiguraci, neposílá cookie ani Authorization a v každém takovém případě vrátí `NO-GO`; ani nalezená REST dokumentace sama nepovoluje credentials nebo launch.
- Chybějící položky a vlastník: veřejná adresa/překlad/HTTPS/test DB/auth — Zone4You IT; endpoint semantics a notifikace — Luxart; mutační UAT a pravidla — Zone4You + Luxart.
