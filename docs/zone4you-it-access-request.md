# Požadavek na IT Zone4You — Luxart API port 9759

Termín: nejpozději do 24 hodin kvůli plánovanému spuštění do 2026-09-05.

Prosíme o zpřístupnění Luxart/Member Pro API, které je podle Luxartu instalované na serveru Zone4You na portu `9759` a připojené k testovací databázi.

Potřebujeme:

1. přesný hostname/IP, kořenovou API URL a URL `/Help` pro Zone4You instanci;
2. informaci, zda přístup vede přes veřejnou IP, VPN, IP allowlist nebo jiný tunel, a co potřebujete od nás pro povolení vývojového prostředí a následně hostingu; plánovaný Vercel runtime poběží v regionu Frankfurt (`fra1`), ale standardní egress IP jsou dynamické, takže při požadavku na allowlist nejprve provisionujeme a následně předáme konkrétní statické IP;
3. HTTPS s platným certifikátem nebo návrh bezpečného reverse proxy/tunelu; samotný testovací HTTP port můžeme výslovně povolit jen na stagingu, nikdy v produkci;
4. příčinu současné odpovědi 401 a přesný gateway auth režim: omezení sítí bez další hlavičky, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička;
5. bezpečný způsob předání případných serverových credentials přímo do secret store; testovací klientské údaje se nesmějí znovu použít jako gateway credentials;
6. potvrzení, že jde o testovací databázi, a výslovné povolení nejprve read-only testu a následně jednoho řízeného vytvoření/storna rezervace;
7. vlastníka nebo tabulku mapování `cislo_salu` → `id_resource` pro všechny sály a Reformer;
8. technický kontakt a časové okno pro společný integrační test;
9. vlastníka DNS pro `booking.zone4you.cz` a možnost zřídit oddělený staging hostname. Aktuálně `booking.zone4you.cz` i `staging.booking.zone4you.cz` už přes A/AAAA míří na existující nginx, kde HTTP vrací 404 a HTTPS certifikát požadovaný hostname nepokrývá. Prosíme potvrdit, zda jde o záměrnou předpřípravu/wildcard a kdo provede pozdější řízenou změnu; zatím prosíme DNS neměnit.

Napojení je server-to-server, proto nepotřebujeme CORS pro browser. První ověření bude pouze read-only; mutace spustíme až po samostatném schválení testovacího scénáře.

Prosíme neposílat hesla ani API tajemství emailem. Pokud jsou potřeba, vložte je přímo do dohodnutého secret store nebo je předejte odděleným bezpečným kanálem.

Pro konfiguraci potřebujeme pouze určit jeden režim: žádná gateway autentizace po IP/VPN omezení, HTTP Basic, Bearer token nebo vlastní `X-*` hlavička. Přihlašovací údaje testovacího klienta nejsou gateway credentials a nesmí se pro tento účel znovu použít.
