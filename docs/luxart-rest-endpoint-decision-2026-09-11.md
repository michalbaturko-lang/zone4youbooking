# Rozhodnutí integračního směru Luxart — 11. 9. 2026

## Stav

**REST `memberzone_rest_v1` zůstává autoritativním kontraktem pro Zone4You booking.** Nejasnost po odpovědi IT se týká veřejné síťové adresy a přesměrování portu, nikoli volby mezi REST a SOAP.

## Důkazy

1. V komunikaci z 5.–6. 2. 2026 Zone4You výslovně objednává přípravu REST API. Luxart odpovídá REST endpointy `api/Login`, `api/User` a `api/Payment` a potvrzuje resort `1`.
2. Luxart 1. 4. 2026 potvrzuje, že API je na serveru Zone4You na interním portu `9759` a je připojené k testovací databázi. Veřejný přístup má zřídit IT Zone4You.
3. Luxart 25. 6. 2026 poskytuje `http://api.memberzone.online:9295/` jako testovací/referenční REST API se stejnou dokumentací a znovu uvádí, že klientská instance musí být zveřejněna přes IT Zone4You.
4. IT Zone4You 11. 9. 2026 sděluje, že je s Luxartem domluveno zveřejnění portu `9191` pro rezervace. Nesděluje však veřejný hostname/IP ani potvrzení překladu na interní `9759`.
5. `http://api.memberzone.online:9191/Service1.svc` veřejně vrací starší SOAP/WCF kontrakt. Ten se neshoduje s objednaným REST API ani s dokumentací na `9295`; samotná shoda čísla portu proto není důkazem, že jde o Zone4You instanci.
6. HTTPS na `api.memberzone.online` na portech `443`, `9191` ani `9295` nebylo 11. 9. 2026 použitelné. Testovací klientské údaje se proto na tyto adresy neposílaly.
7. Opakované anonymní ověření 13. 9. 2026 potvrzuje, že `api.memberzone.online:9295/Help` nadále obsahuje zdokumentované REST cesty `api/Lesson`, které bez autorizace odpovídají `401`. Na stejném hostiteli vrací port `9191` pro `/Help` i plně parametrizovaný `api/Lesson` stav `404`, zatímco `Service1.svc` odpovídá `200`. Port je tedy veřejně otevřený, ale je na něm publikovaná jiná IIS aplikace. Kořen navíc zobrazuje veřejný adresářový výpis, který musí IT vypnout.
8. Přímé srovnání 13. 9. 2026 v 21:23 CEST bez credentials znovu ověřilo `9295/Help` jako REST dokumentaci HTTP 200 bez directory listingu a všech 11/11 očekávaných dokumentačních částí se shodným sémantickým SHA-256. Ve stejném okamžiku `9191/Help` zůstalo na HTTP 404 s klasifikací SOAP/WCF a veřejným directory listingem. Nejde tedy pouze o změnu čísla portu stejné aplikace.
9. Luxart 14. 9. 2026 písemně potvrdil, že interní `9759` je stejné REST API připojené k testovací databázi, veřejný hostname a certifikát má dodat IT a přístup má používat HTTPS, IP allowlist a Basic Auth.
10. Luxart současně potvrdil pětidenní ukládání hashe klientského hesla z login požadavku. Protože tento hash API přijímá jako přihlašovací údaj, požadavek na redakci zatím splněný není a reálný login zůstává fail-closed. Rozhodnutí a rozdělení odpovědností je v `docs/luxart-access-confirmation-2026-09-14.md`.

## Očekávaná topologie k potvrzení IT

```text
booking backend
  -> https://<veřejný-host-Zone4You>:9191
  -> přesměrování/reverse proxy
  -> interní server Zone4You:9759
  -> REST memberzone_rest_v1
  -> testovací databáze Zone4You
```

Číslo veřejného portu může být jiné, pokud IT dodá bezpečný HTTPS origin. Rozhodující je přesný hostitel, REST `/Help`, testovací databáze a bezpečný transport.

## Co nyní musí dodat IT Zone4You

1. přesný veřejný hostname a celé HTTPS URL včetně případného portu;
2. platný TLS certifikát a reverse proxy/NAT na interní REST API `9759`;
3. dostupnost `/Help` a `api/Lesson` na stejném originu;
4. IP allowlist pro odsouhlasené statické odchozí adresy booking backendu;
5. vypnutí directory browsingu na veřejném IIS webu;
6. potvrzení, že proxy a webserver nelogují nebo redigují `login`, `password` a `member_card_number` z `/api/Login`;
7. povolení nejprve read-only testu a později samostatně schváleného rezervačního UAT.

REST kontrakt, testovací databáze a Basic Auth jsou potvrzené. Luxart musí samostatně odstranit stejné citlivé parametry ze svých aplikačních a navazujících logů. Nabídnuté sdílené testovací gateway údaje se neukládají ani nepoužijí před ověřením HTTPS a allowlistu.

SOAP audit zůstává pouze negativním srovnávacím důkazem. Nesmí otevřít D1, změnit `LUXART_API_CONTRACT` ani autorizovat release.
