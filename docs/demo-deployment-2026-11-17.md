# Nasazení auditovaných oprav: explicitní demo

## Rozhodnutí a rozsah

Uživatel 17. 11. výslovně požádal o nasazení. Cíl je existující `mbos-projects-220653ae/zone4youbooking`, Node 24, Frankfurt fra1, hlavní Vercel adresa `https://zone4youbooking.vercel.app`. Klubová doména, Member Pro, DNS, placené Static IPs ani živé mutace nejsou součástí této etapy.

Při nasazení původního auditovaného SHA cca183a se na dosud nepřepnutém produkčním buildu prokázal A13: readiness ready/mock, ale adapter mock v produkčním hostingu odmítal. Tato verze se nesmí propagovat. Opravený adapter a readiness sdílejí pravidlo: Vercel production vyžaduje obě výslovná nastavení `LUXART_MOCK=true` a `NEXT_PUBLIC_APP_ENV=demo`. Jinak se mock odmítá, readiness je 503. `NEXT_PUBLIC_APP_ENV=production` se stále nesmí spojit s mockem.

## Postup

1. Ověřit čistý HEAD, celý SHA, existující tým/projekt a GitHub quality joby. Použít přesný export `git archive HEAD`, nikoliv adresář s lokálními reporty a secrets.
2. Vytvořit produkční deployment bez domén pomocí `vercel deploy --prod --skip-domain --project <ověřené ID> --scope mbos-projects-220653ae`. Pro tento demo deployment předat `LUXART_MOCK=true` a `NEXT_PUBLIC_APP_ENV=demo` v runtime i buildu. Při CLI exportu nastavit `ZONE4YOU_DEPLOYMENT_COMMIT` na přesný SHA exportu; nevymýšlet systémové Vercel proměnné.
3. Ověřit na unikátní adrese readiness demo/mock, přesný SHA, skutečný region fra1, runtime probe a omezenou externí Playwright regresi. Pokud první hranice selže, zastavit následující testy, nic nepropagovat.
4. Po zeleném GitHub CI a testech produkčního buildu propagovat stejný deployment přes Vercel request_promote. Znovu ověřit hlavní adresu HTTP, API, SHA a režim.
5. Prohlédnout chybové runtime logy konkrétního deploymentu, uložit výsledky a aktualizovat předání.

## Návrat

Před změnou hlavní adresy je poslední produkční baseline `dpl_5MWc1AqsJc7Nyym7Mpg9w73zYpNP`, commit `8601facef79e54bb64576e76716672d92eecac52` (staré demo bez nových API health/readiness). Při závažném selhání po přepnutí vrátit tento deployment běžným Vercel rollback postupem a ověřit hlavní stránku. Nepoužívat nefunkční první staged A13 build jako baseline.

## Zbývající navazující práce

Po této etapě pokračovat podle E01–E06 v `next-development-handoff-2026-11-17.md` pouze se splněnými vstupy. Vytvoření demo deploymentu nenahrazuje klubové UAT, potvrzení pravidel, logovací redakci, síťovou cestu, skutečný monitoring ani schválení živého pilotu.
