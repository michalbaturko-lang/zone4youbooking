# Scope of Work — Zone4You Online Booking System

**Projekt:** Nový rezervační systém pro Zone4You
**Klient:** Zone4You s.r.o.
**Dodavatel:** Michal Baturko
**Verze:** 1.0
**Datum:** 27. 2. 2026

---

## 1. Úvod a cíl projektu

Cílem projektu je vytvoření moderního online rezervačního systému pro fitness centrum Zone4You, který nahradí stávající řešení memberzone.cz. Nový systém bude napojen na stávající software Luxart a umožní klientům centra pohodlně si prohlížet rozvrh, rezervovat lekce, spravovat kredit a sledovat svou historii — vše v přehledném responsivním webovém rozhraní dostupném z počítače i mobilního telefonu.

Systém bude dostupný v češtině a angličtině.

---

## 2. Fáze projektu

Projekt je rozdělen do dvou fází. **Fáze 1** pokrývá kompletní funkční rezervační systém. **Fáze 2** obsahuje rozšíření a doplňkové funkce.

---

## FÁZE 1 — Rezervační systém (MVP)

### Modul 1: Přihlášení a autentizace

**Co je možné vytvořit:**
- Přihlašovací stránku s loginem (email) a heslem (číslo karty) napojenou na Luxart API
- Funkci "Zapomenuté heslo" — odeslání stávajícího hesla na registrovaný email
- Nápovědu na přihlašovací stránce ("Vaše heslo je číslo vaší členské karty")
- Zabezpečenou session s automatickým odhlášením po nečinnosti
- Přepínání jazyka (CZ / EN)

**Termín:** Týden 1–2

---

### Modul 2: Rozvrh a zobrazení lekcí

**Co je možné vytvořit:**
- Denní pohled na rozvrh (výchozí zobrazení)
- Týdenní pohled na rozvrh
- Zobrazení detailu lekce: název, instruktor, čas, sál, cena, obsazenost
- Zobrazení náhradního instruktora / zástupu
- Indikátor obsazenosti — barevný (zelená/oranžová/červená) + přesný počet míst
- Filtrování podle sálu, typu lekce a instruktora
- Funkci "Oblíbené lekce" — klient si označí lekce a má k nim rychlý přístup

**Termín:** Týden 2–4

---

### Modul 3: Rezervace lekcí

**Co je možné vytvořit:**
- Rezervaci lekce jedním klikem z rozvrhu
- Stržení kreditu v momentě rezervace
- Zrušení rezervace klientem s automatickým vrácením kreditu (při včasném zrušení)
- Storno logiku — po uplynutí lhůty kredit propadá (100 % storno poplatek)
- Penalizaci za no-show (nedostavení se) — 100 % stržení
- Omezení rezervací na 48 hodin dopředu
- Zobrazení seznamu aktivních rezervací klienta ("Moje rezervace")

**Termín:** Týden 3–5

---

### Modul 4: Čekací listina (Waiting List)

**Co je možné vytvořit:**
- Zápis na čekací listinu, když je lekce plně obsazena
- Automatické zařazení prvního čekajícího při uvolnění místa
- Automatické stržení kreditu při zařazení z čekací listiny
- Emailovou notifikaci o zařazení na lekci
- Maximální kapacitu čekací listiny (10 osob)
- Zobrazení pozice klienta na čekací listině

**Termín:** Týden 5–6

---

### Modul 5: Kredit a platby (Stripe)

**Co je možné vytvořit:**
- Zobrazení aktuálního zůstatku kreditu v hlavičce stránky
- Předdefinované částky pro dobití (1 h / 5 h / 10 h — dle hodinové sazby)
- Platební bránu Stripe s podporou platebních karet
- Platbu přes Apple Pay a Google Pay (součást Stripe)
- Historii transakcí a plateb (dobití, stržení za lekce, vrácení)
- Zabezpečené platební flow (Stripe Checkout / Payment Intents)

**Termín:** Týden 5–7

---

### Modul 6: Profil klienta

**Co je možné vytvořit:**
- Zobrazení osobních údajů klienta (jméno, email, telefon, členství)
- Možnost doplnit chybějící údaje
- Historii navštívených lekcí (archiv)
- Přehled aktivního členství a jeho parametrů

**Termín:** Týden 6–7

---

### Modul 7: Emailové notifikace

**Co je možné vytvořit:**
- Email při úspěšné rezervaci lekce
- Email při zrušení rezervace
- Email při zařazení z čekací listiny na lekci
- Email při úspěšném dobití kreditu
- Profesionální emailové šablony v designu Zone4You (CZ + EN)

**Termín:** Týden 7–8

---

### Modul 8: Lokalizace (CZ + EN)

**Co je možné vytvořit:**
- Kompletní rozhraní v češtině (výchozí jazyk)
- Kompletní rozhraní v angličtině
- Přepínání jazyka v hlavičce stránky
- Lokalizované emaily v obou jazycích

**Termín:** Průběžně (paralelně s ostatními moduly)

---

### Shrnutí Fáze 1

| Modul | Obsah | Termín |
|-------|-------|--------|
| Modul 1 | Přihlášení a autentizace | Týden 1–2 |
| Modul 2 | Rozvrh a zobrazení lekcí | Týden 2–4 |
| Modul 3 | Rezervace lekcí | Týden 3–5 |
| Modul 4 | Čekací listina | Týden 5–6 |
| Modul 5 | Kredit a platby (Stripe) | Týden 5–7 |
| Modul 6 | Profil klienta | Týden 6–7 |
| Modul 7 | Emailové notifikace | Týden 7–8 |
| Modul 8 | Lokalizace (CZ + EN) | Průběžně |

**Odhadovaná délka Fáze 1: 8 týdnů**

---

## FÁZE 2 — Rozšíření a doplňkové funkce

### Modul 9: Kryptoplatby

**Co je možné vytvořit:**
- Integraci platební brány pro kryptoměny (Bitcoin, Ethereum a další)
- Napojení na službu typu Coinbase Commerce nebo BTCPay Server
- Automatické přepočítání na Kč a připsání kreditu

**Termín:** Týden 9–10

---

### Modul 10: Připomenutí lekcí

**Co je možné vytvořit:**
- Automatické připomenutí lekce emailem (např. 2 h nebo 24 h předem)
- SMS připomenutí (volitelně, s napojením na SMS bránu)
- Push notifikace v prohlížeči (volitelně)
- Nastavení preferencí připomenutí v profilu klienta

**Termín:** Týden 10–11

---

### Modul 11: Rozšířené funkce a optimalizace

**Co je možné vytvořit:**
- PWA (Progressive Web App) — možnost "nainstalovat" web na telefon jako aplikaci
- Offline zobrazení rozvrhu (cache)
- Pokročilé statistiky pro klienta (počet návštěv za měsíc, oblíbené lekce, nejčastější instruktor)
- Optimalizace výkonu na základě reálného provozu

**Termín:** Týden 11–12

---

### Shrnutí Fáze 2

| Modul | Obsah | Termín |
|-------|-------|--------|
| Modul 9 | Kryptoplatby | Týden 9–10 |
| Modul 10 | Připomenutí lekcí | Týden 10–11 |
| Modul 11 | Rozšířené funkce a PWA | Týden 11–12 |

**Odhadovaná délka Fáze 2: 4 týdny**

---

## 3. Co NENÍ součástí projektu

- Administrační panel — veškerá správa (rozvrh, lekce, instruktoři, klienti) probíhá v softwaru Luxart
- Registrace nových klientů — probíhá na recepci centra
- Nativní mobilní aplikace (iOS / Android) — web je responsivní a funguje na mobilech
- Soukromé lekce / Personal Training — případně v budoucí fázi
- Jednorázové vstupy bez členství

---

## 4. Předpoklady a součinnost klienta

Pro úspěšnou realizaci projektu je potřeba součinnost klienta v těchto oblastech:

1. **Luxart API** — přístupové údaje a dokumentace (zajištěno)
2. **Stripe účet** — API klíče (testovací i produkční)
3. **Doména** — potvrzení a nastavení DNS pro booking.zone4you.cz
4. **HTTPS certifikát** — na serveru, kde poběží aplikace
5. **Grafické podklady** — logo, barvy, fonty (zajištěno z designu)
6. **Testování** — klient provede akceptační testování před spuštěním každé fáze
7. **Odpovědi na doplňující dotazy** — viz dokument s otevřenými body

---

## 5. Způsob dodání

- Zdrojový kód v Git repozitáři
- Nasazení na dohodnutý server / hosting
- Předání dokumentace k nasazení a provozu
- Zaškolení obsluhy (pokud bude potřeba)

---

## 6. Stávající systém (memberzone.cz)

Stávající systém memberzone.cz bude po dobu vývoje a přechodného období fungovat paralelně s novým systémem. Po úspěšném otestování a stabilizaci nového systému je možné starý systém odstavit — po dohodě s klientem.

---

*Tento dokument definuje rozsah prací na projektu Zone4You Online Booking System. Případné změny nebo rozšíření budou řešeny dodatkem k tomuto dokumentu.*
