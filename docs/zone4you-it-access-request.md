# Požadavek na IT Zone4You a Luxart — určení autoritativního API kontraktu

Urgence: pro zachování sedmidenního integračního plánu potřebujeme odpověď do 24 hodin od odeslání.

Luxart dříve dodal REST dokumentaci a testovací API na portu `9295`; současný booking adapter je implementovaný podle endpointů `/api/Login`, `/api/User`, `/api/Lesson`, `/api/Reservations`, `/api/Watchdog` a `/api/Payment`. Zone4You IT 11. 9. 2026 potvrdilo zveřejnění portu `9191`. Živá kontrola ale na `9191` nalezla SOAP/WCF `Service1.svc`, nikoli uvedené REST API. Potřebujeme proto společné a jednoznačné rozhodnutí IT a Luxartu, který kontrakt je pro redesign autoritativní.

Potřebujeme:

1. potvrzení jedné varianty: **REST `memberzone_rest_v1`** s `/api/Lesson` a `/Help`, nebo **SOAP/WCF `Service1.svc`** na portu `9191`;
2. přesný veřejný hostname/IP a šifrovanou kořenovou URL vybraného Zone4You test API; u REST také přesnou URL `/Help`, u SOAP potvrzení, zda veřejný WSDL `Service1.svc` je autoritativní, a příklady požadavků/odpovědí pro výpis všech lekcí a rezervační operace;
3. informaci, zda přístup vede přes veřejnou IP, VPN, IP allowlist nebo jiný tunel, a co potřebujete od nás pro povolení vývojového prostředí a následně hostingu; plánovaný Vercel runtime poběží v regionu Frankfurt (`fra1`), ale standardní egress IP jsou dynamické, takže při požadavku na allowlist nejprve provisionujeme a následně předáme konkrétní statické IP;
4. HTTPS s platným certifikátem nebo návrh bezpečného reverse proxy/tunelu; testovací klientské přihlašovací údaje přes prosté HTTP neodešleme;
5. přesný gateway auth režim: omezení sítí bez další hlavičky, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička;
6. bezpečný způsob předání případných serverových credentials přímo do secret store; testovací klientské údaje se nesmějí znovu použít jako gateway credentials;
7. potvrzení, že jde o testovací databázi, a výslovné povolení nejprve read-only testu a následně jednoho řízeného vytvoření/storna rezervace;
8. vlastníka nebo úplnou tabulku mapování sálů a Reformeru na rezervační resource ID pro vybraný kontrakt;
9. technický kontakt a časové okno pro společný integrační test;
10. vlastníka DNS pro `booking.zone4you.cz` a možnost zřídit oddělený staging hostname. Aktuálně `booking.zone4you.cz` i `staging.booking.zone4you.cz` už přes A/AAAA míří na existující nginx, kde HTTP vrací 404 a HTTPS certifikát požadovaný hostname nepokrývá. Prosíme potvrdit, zda jde o záměrnou předpřípravu/wildcard a kdo provede pozdější řízenou změnu; zatím prosíme DNS neměnit.

Napojení je server-to-server, proto nepotřebujeme CORS pro browser. První ověření bude pouze read-only; mutace spustíme až po samostatném schválení testovacího scénáře.

## Co jsme bezpečně ověřili 11. 9. 2026

- `api.memberzone.online:9295/Help` je funkční referenční Luxart dokumentace, nikoli potvrzená Zone4You instance.
- `api.memberzone.online:9191/Service1.svc` odpovídá a veřejné WSDL obsahuje rezervační SOAP/WCF operace, ale `/Help` vrací 404 a HTTPS na tomto portu nefunguje. Do zveřejněných aplikačních ani konfiguračních souborů jsme nevstupovali. Potřebujeme potvrdit, zda je tato služba autoritativním Zone4You test API, nebo jde o jiný systém.
- Veřejné SOAP schéma obsahuje kandidátní operace `Login`, `GetResource`, `GetServices`, `GetReservation`, `SetReservation`, `UPD_Reservation` a `DEL_Reservation`. Nedokumentuje ale samostatný `Lesson`, jazyk, osobní rezervovatelnost ani watchdog. Pokud má být SOAP autoritativní, prosíme potvrdit, zda `GetReservation` vrací úplný rozvrh všech skupinových lekcí včetně Reformeru, jaká je hodnota Zone4You `ID_ACTIVITY_IN` a význam identifikátorů potřebných pro vytvoření a storno.
- Běžné veřejné názvy Zone4You na portech `9191` i `9759` při HTTP i HTTPS z našeho IPv4 připojení timeoutují. Může jít o jiný hostname, neaplikované pravidlo, VPN nebo allowlist; bez přesné adresy to nelze rozlišit.

Pokud je `api.memberzone.online:9191` ve správě Luxartu, prosíme zároveň o kontrolu a vypnutí veřejného výpisu adresáře. Pro Zone4You integraci tento obsah nebudeme dále procházet.

Prosíme neposílat hesla ani API tajemství emailem. Pokud jsou potřeba, vložte je přímo do dohodnutého secret store nebo je předejte odděleným bezpečným kanálem.

Pro konfiguraci potřebujeme pouze určit jeden režim: žádná gateway autentizace po IP/VPN omezení, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička. Přihlašovací údaje testovacího klienta nejsou gateway credentials a nesmí se pro tento účel znovu použít.
