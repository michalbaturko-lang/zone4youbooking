# Požadavek na IT Zone4You — veřejná adresa REST API

Urgence: pro zachování sedmidenního integračního plánu potřebujeme odpověď do 24 hodin od odeslání.

Luxart potvrdil, že objednané Zone4You REST API běží na serveru Zone4You na interním portu `9759` a je připojené k testovací databázi. Referenční REST dokumentace je na portu `9295`; současný booking adapter je implementovaný podle endpointů `/api/Login`, `/api/User`, `/api/Lesson`, `/api/Reservations`, `/api/Watchdog` a `/api/Payment`. Zone4You IT 11. 9. 2026 potvrdilo dohodu o zveřejnění portu `9191`, ale neposkytlo veřejný hostname/IP ani celé URL.

Potřebujeme:

1. přesný veřejný hostname/IP a celé URL včetně schématu a portu, například `https://<veřejný-host-Zone4You>:9191/`;
2. potvrzení, že veřejný port `9191` směruje na interní Zone4You REST API na portu `9759`, nikoli na jinou službu;
3. přesnou URL `/Help` na stejném originu a potvrzení dostupnosti endpointu `/api/Lesson`;
4. informaci, zda přístup vede přes veřejnou IP, VPN, IP allowlist nebo jiný tunel, a co potřebujete od nás pro povolení vývojového prostředí a následně hostingu; plánovaný Vercel runtime poběží v regionu Frankfurt (`fra1`), ale standardní egress IP jsou dynamické, takže při požadavku na allowlist nejprve provisionujeme a následně předáme konkrétní statické IP;
5. HTTPS s platným certifikátem nebo návrh bezpečného reverse proxy/tunelu; testovací klientské přihlašovací údaje přes prosté HTTP neodešleme;
6. přesný gateway auth režim: omezení sítí bez další hlavičky, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička;
7. bezpečný způsob předání případných serverových credentials přímo do secret store; testovací klientské údaje se nesmějí znovu použít jako gateway credentials;
8. potvrzení, že reverzní proxy, webserver i aplikační monitoring pro `/api/Login` neukládají celý query string, případně bezpečně redigují parametry `login`, `password` a `member_card_number`; Luxart REST kontrakt je posílá v URL a bez této ochrany by je zachytil přístupový log;
9. potvrzení, že cílem je testovací databáze Zone4You, a výslovné povolení nejprve read-only testu a následně jednoho řízeného vytvoření/storna rezervace;
10. vlastníka nebo úplnou tabulku mapování `cislo_salu` na rezervační `id_resource` pro všechny sály a Reformer;
11. technický kontakt a časové okno pro společný integrační test;
12. vlastníka DNS pro `booking.zone4you.cz` a možnost zřídit oddělený staging hostname. Aktuálně `booking.zone4you.cz` i `staging.booking.zone4you.cz` už přes A/AAAA míří na existující nginx, kde HTTP vrací 404 a HTTPS certifikát požadovaný hostname nepokrývá. Prosíme potvrdit, zda jde o záměrnou předpřípravu/wildcard a kdo provede pozdější řízenou změnu; zatím prosíme DNS neměnit.

Napojení je server-to-server, proto nepotřebujeme CORS pro browser. První ověření bude pouze read-only; mutace spustíme až po samostatném schválení testovacího scénáře.

## Co jsme bezpečně ověřili 11.–13. 9. 2026

- `api.memberzone.online:9295/Help` je funkční referenční Luxart dokumentace, nikoli potvrzená Zone4You instance. Anonymní kontrola 13. 9. ve 21:23 CEST potvrdila HTTP 200, vypnutý directory listing a přesnou shodu všech 11/11 očekávaných částí REST kontraktu.
- `api.memberzone.online:9191/Service1.svc` odpovídá, ale jde o SOAP/WCF kontrakt odlišný od objednaného Zone4You REST API; `/Help` vrací 404 a HTTPS na tomto portu nefunguje. Tento host proto nepovažujeme za veřejnou Zone4You cestu bez výslovného potvrzení IT.
- HTTPS na `api.memberzone.online` nebylo dostupné ani na standardním portu 443, ani na 9191/9295. Žádné klientské přihlašovací údaje jsme na tyto adresy neposlali.
- Běžné veřejné názvy Zone4You na portech `9191` i `9759` při HTTP i HTTPS z našeho IPv4 připojení timeoutují. Může jít o jiný hostname, neaplikované pravidlo, VPN nebo allowlist; bez přesné adresy to nelze rozlišit.

Pokud je `api.memberzone.online:9191` ve správě Luxartu, prosíme zároveň o kontrolu a vypnutí veřejného výpisu adresáře. Pro Zone4You integraci tento obsah nebudeme dále procházet.

Prosíme neposílat hesla ani API tajemství emailem. Pokud jsou potřeba, vložte je přímo do dohodnutého secret store nebo je předejte odděleným bezpečným kanálem.

Pro konfiguraci potřebujeme pouze určit jeden režim: žádná gateway autentizace po IP/VPN omezení, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička. Přihlašovací údaje testovacího klienta nejsou gateway credentials a nesmí se pro tento účel znovu použít.
