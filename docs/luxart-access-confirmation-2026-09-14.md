# Potvrzení přístupu k Luxart API — 14. 9. 2026

## Potvrzené skutečnosti

1. Interní port Zone4You `9759` publikuje stejný REST kontrakt `memberzone_rest_v1`, podle kterého je integrace implementovaná.
2. Instance je připojená k testovací databázi Zone4You.
3. Veřejný hostname a platný TLS certifikát musí dodat IT Zone4You.
4. API vyžaduje HTTPS, omezení na určené zdrojové IP adresy a samostatnou gateway autentizaci Basic Auth.
5. Luxart uvedl, že hash klientského hesla z login požadavku ukládá do logu po dobu pěti dnů.

Nabídnuté sdílené testovací gateway údaje se neukládají do repozitáře ani dokumentace a nebudou použity přes HTTP. Dedikované údaje se vyžádají bezpečným kanálem až po ověření přesného HTTPS originu a IP allowlistu.

## Bezpečnostní rozhodnutí

Hash hesla odesílaný na `POST /api/Login` je pro toto API znovupoužitelný přihlašovací údaj. Pětidenní retence proto nesplňuje bezpečnostní podmínku D1 a živý klientský login zůstává zablokovaný.

Před prvním přihlášením musí být na všech vrstvách — reverse proxy, IIS/webserver, aplikace i APM/monitoring — parametry `login`, `password` a `member_card_number` úplně vynechány z logů nebo nevratně redigovány. Potřebujeme písemné potvrzení osoby či provozní role, která změnu provedla nebo ověřila.

## Zbývající odpovědnosti

### IT Zone4You

- zaregistrovat veřejný hostname, nasadit platný TLS certifikát a dodat přesnou HTTPS URL;
- nastavit reverse proxy/NAT na interní REST službu `9759` a zpřístupnit `/Help` na stejném originu;
- povolit pouze odsouhlasené statické odchozí IP adresy backendu;
- vypnout veřejný directory listing;
- potvrdit redakci citlivých login parametrů ve vlastní proxy a webserverové vrstvě.

### Luxart

- přestat ukládat citlivé login parametry v aplikačních a souvisejících přístupových logách a písemně potvrdit redakci;
- po bezpečném zpřístupnění dodat dedikované Basic Auth údaje odděleným bezpečným kanálem;
- následně doplnit dosud otevřenou resource mapu a obchodní/storno pravidla.

### Booking tým

- nejprve provést pouze anonymní kontrolu HTTPS, `/Help` a shody kontraktu;
- teprve po potvrzení redakce spustit jediný řízený read-only D1 login test;
- rezervační a storno mutace provést až v samostatně schváleném UAT.

Toto potvrzení neautorizuje živý login, mutace, merge ani produkční cutover.
