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

1. přesný veřejný hostname nebo IP a celé URL včetně schématu a portu;
2. potvrzení, že tato veřejná cesta vede na interní REST API na portu `9759`;
3. potvrzení dostupnosti `/Help` a `api/Lesson` na stejném originu;
4. platné HTTPS nebo bezpečný tunel/reverse proxy;
5. síťová omezení a gateway autentizaci;
6. potvrzení, že cílem je testovací databáze Zone4You;
7. povolení nejprve read-only testu a později samostatně schváleného rezervačního UAT.

SOAP audit zůstává pouze negativním srovnávacím důkazem. Nesmí otevřít D1, změnit `LUXART_API_CONTRACT` ani autorizovat release.
