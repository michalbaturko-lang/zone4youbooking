# Luxart API — read-only kontrola kontraktu 11. 9. 2026

Tento záznam je pouze neosobní read-only evidence veřejné referenční dokumentace. Není důkazem dostupnosti Zone4You instance na portu `9191`, souhlasem s mutací ani autoritou k deployi.

## Zjištění

- Referenční `http://api.memberzone.online:9295/Help` odpovědělo HTTP 200.
- Neautentizovaný `GET /api/Lesson` odpověděl 401; žádné přihlašovací údaje ani osobní data nebyly odeslány.
- Dokumentace uvádí potřebné kontrakty pro login, všechny `Lesson` položky, seznam/vytvoření/storno rezervace a watchdog.
- Storno odpověď obsahuje `storno_poplatek`; UI proto nesmí částku domýšlet a ukazuje hodnotu vrácenou Luxartem.
- `Lesson_data` obsahuje mimo jiné datum a čas, službu, cenu, název, popis, kapacity/obsazenost, `cislo_salu`, instruktora a příznak rezervovatelnosti. To odpovídá pilotnímu rozsahu všech lekcí, všech sálů a Reformeru.
- Nový automatický `probe:luxart-help` na referenčním portu `9295` v 12:43 CEST prošel s HTTP 200 a klasifikací `ready`; bezpečný výstup neobsahuje hostname ani credentials.
- Stejný probe na zjevné veřejné Zone4You variantě s portem `9191` skončil connect timeoutem. Host ale nebyl IT potvrzen, proto jde pouze o negativní kandidátní pozorování, nikoli o definitivní stav portu.

## SHA-256 uložené odpovědi

| Help stránka | SHA-256 |
|---|---|
| Login | `3a206e99a7366e0b5fad39014d90b216f696a50a490c5ace09dbb0d96c633ca0` |
| Lesson | `9bd77da566b9bef0c80981b01df8a8e960f708f64268fca49de8031d0a6fa52b` |
| Reservations GET | `be858e8f9696475fc39b9ea3bdcbc07b7f816413fd517f3dcb744d73e5ae38c1` |
| Reservations POST | `33f9e782a2204ff56fdb6223a33e60272dab3d0ddf1129ea51e526732aa50b16` |
| Reservations DELETE | `350d423bbd354a6845a5fd492c262f69667bfd0431d0e03b3e65b4cf2fe1e28e` |
| watchdog_III POST | `b893e636d421b3ee04767b2cc2219c677dde0826f9f993f3147f0520f435858d` |
| watchdog_II/user GET | `3de87e3ac7fb87266c2eab0fe7f6e0218c841500ef4aa2991476bdbfa3af4d99` |
| Watchdog DELETE | `4bdf30073b5f39e0da1b928322eb3f765a80e0c8faef18f5a3066a308a6e9b88` |

## Release dopad

Adaptér lze dál vyvíjet a lokálně testovat proti tomuto kontraktu. Živý read-only gate se otevře až po získání přesné Zone4You URL na portu `9191`, potvrzení testovací databáze a gateway režimu. Rezervační zápisy zůstanou vypnuté až do samostatně povoleného UAT, mapování všech pozorovaných sálů, PostgreSQL ledgeru, úplných business pravidel, rollbacku a výslovného cutover schválení.
