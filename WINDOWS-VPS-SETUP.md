# Postawienie agenta na VPS z Windows Server

Cel: agent chodzi na serwerze sam, co noc, bez Twojej obecności.
Ścieżka: kod w repo Git → serwer instaluje narzędzia → klonuje repo →
konfiguruje sekrety → test ręczny → harmonogram co noc.

> Uwaga: na Windows nie ma „crona”. Odpowiednik to **Harmonogram zadań** (Task Scheduler).
> Robi dokładnie to samo — odpala agenta o wyznaczonej godzinie.

---

## Krok 0 — czego potrzebujesz pod ręką
- Dostęp do VPS przez **Pulpit zdalny (RDP)** (adres IP, login, hasło).
- **Klucz API Claude** — https://console.anthropic.com → API Keys (to płatne kredyty API, osobne od aplikacji).
- Login i hasło do panelu Shoper.
- Konto na **GitHub** lub **GitLab** (repozytorium może być prywatne).

---

## Krok 1 — wrzuć kod do repozytorium Git (na swoim komputerze)
Masz paczkę `bady-agent.zip`. Rozpakuj ją u siebie, potem:

```powershell
cd bady-agent
git init
git add .
git commit -m "Agent bady.pl -> Shoper"
# utwórz PRYWATNE repo na GitHub (np. bady-agent) i podłącz je:
git remote add origin https://github.com/TWOJ_LOGIN/bady-agent.git
git branch -M main
git push -u origin main
```

Plik `.env` NIE trafi do repo (jest w `.gitignore`) — i dobrze, tam są hasła.

---

## Krok 2 — połącz się z VPS i zainstaluj narzędzia
Zaloguj się przez **Podłączanie pulpitu zdalnego** (mstsc) na IP serwera.
Otwórz **PowerShell jako administrator** i zainstaluj Node.js i Git.

Jeśli serwer ma `winget` (Windows Server 2022/2025):
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Jeśli nie ma `winget` — pobierz i zainstaluj ręcznie (kliknij „Dalej”):
- Node.js LTS: https://nodejs.org (wersja LTS, instalator .msi)
- Git: https://git-scm.com/download/win

Zamknij i otwórz PowerShell ponownie, sprawdź:
```powershell
node -v
npm -v
git --version
```

---

## Krok 3 — sklonuj repo na serwer
```powershell
cd C:\
git clone https://github.com/TWOJ_LOGIN/bady-agent.git
cd C:\bady-agent
```
Przy prywatnym repo Git poprosi o login — użyj **Personal Access Token** zamiast hasła
(GitHub → Settings → Developer settings → Personal access tokens → uprawnienie „repo”).

---

## Krok 4 — instalacja zależności i przeglądarki
```powershell
npm install
npx playwright install chromium
```
(Na Windows nie dajesz `--with-deps` — sterowniki są w paczce Playwrighta.)

---

## Krok 5 — konfiguracja sekretów (.env)
Skopiuj wzór i uzupełnij:
```powershell
copy .env.example .env
notepad .env
```
W `.env` wpisz: `ANTHROPIC_API_KEY`, `SHOPER_ADMIN_URL`, `SHOPER_LOGIN`,
`SHOPER_PASSWORD`, `ANTHROPIC_MODEL`. Zostaw `MAX_PRODUCTS` na start małe (np. 3).

> Uwaga: `HEADFUL` z wcześniejszej wersji **nie ma już znaczenia** — agent nie startuje
> własnej przeglądarki, tylko podłącza się do trwałego okna (patrz następny krok, CDP).

---

## Krok 5.5 — logowanie: TRWAŁE OKNO PRZEGLĄDARKI (CDP) — WYMAGANE przez 2FA
Shoper wymusza **dwuetapową weryfikację (2FA)**, a sesji **nie da się** zapisać do pliku
(`storageState`/cookies) — sesja to cookie sesyjne, które ginie przy restarcie procesu.
Rozwiązanie: **jedno okno przeglądarki działa na stałe**, a agent tylko się do niego podłącza.

1. W sesji RDP (musisz widzieć pulpit) uruchom **trwałe okno**:
   ```powershell
   cd C:\APP-JD\bady-agent
   npm run browser
   ```
   Otworzy się okno Chromium (profil `.auth-profile`, port debug **9222**).
2. **Zaloguj się w nim do końca: login + hasło + kod 2FA z maila/SMS.** ZOSTAW okno otwarte.
3. Od tej chwili każdy `npm start` / `npm run once` podłącza się do tego okna przez CDP
   (`connectOverCDP` na `http://127.0.0.1:9222`) i **NIE** pyta ponownie o 2FA.

> Kiedy trzeba powtórzyć logowanie? Po **restarcie VPSa** albo zamknięciu okna. Rozłączenie
> RDP (bez wylogowania) jest OK — okno i sesja żyją dalej. Wylogowanie użytkownika zabija okno.

---

## Krok 6 — test ręczny (zanim włączysz harmonogram)
Najpierw upewnij się, że okno z Kroku 5.5 jest otwarte i zalogowane. Potem:
```powershell
npm run once
```
To przetworzy **jeden** produkt (podłączając się do okna CDP). Obserwuj logi.
Jeśli zobaczysz `✗ Nie mogę podłączyć się do przeglądarki (...9222)` — uruchom `npm run browser`
i zaloguj się (Krok 5.5). Jak produkt pojawi się w panelu jako nieaktywny — gotowe do harmonogramu.

---

## Krok 7 — harmonogram co noc (Task Scheduler)
W repo jest `run.bat` — odpala agenta (`npm start`) i zapisuje logi do `logs\`.

> WAŻNE (model CDP): zadanie **musi** działać w **sesji interaktywnej** tego samego
> użytkownika, w której otwarte jest okno `npm run browser` (Krok 5.5). Dlatego NIE używamy
> „uruchom niezależnie od zalogowania” — przeciwnie, zadanie ma iść w interaktywnej sesji
> (`LogonType Interactive`), żeby miało dostęp do żywego okna na `127.0.0.1:9222`.

Utworzenie zadania (PowerShell jako administrator), codziennie o **3:00**:
```powershell
$action = New-ScheduledTaskAction -Execute "C:\APP-JD\bady-agent\run.bat"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$principal = New-ScheduledTaskPrincipal -UserId "Administrator" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "BadyAgent-Nightly" -Action $action -Trigger $trigger `
  -Principal $principal -Description "Agent BADY->Shoper (laczy sie z oknem CDP)" -Force
```

Test zadania od razu (bez czekania do nocy) — okno CDP musi być otwarte i zalogowane:
```powershell
Start-ScheduledTask -TaskName "BadyAgent-Nightly"
```
Potem zajrzyj do `C:\APP-JD\bady-agent\logs\` — powinien być świeży log z dodanymi produktami.

> Przypomnienie: przed nocnym runem (i po każdym restarcie VPSa) upewnij się, że okno
> `npm run browser` jest uruchomione i zalogowane — inaczej `npm start` zgłosi brak połączenia CDP.

---

## Krok 8 — aktualizacje kodu w przyszłości
Gdy poprawimy agenta:
```powershell
cd C:\bady-agent
git pull
npm install
```

---

## Bezpieczeństwo (krótko)
- `.env` z hasłami zostaje TYLKO na serwerze, nigdy w repo.
- Klucz API i hasła traktuj jak hasła do banku — nie wklejaj ich w czat, maile, zrzuty.
- Trzymaj Windows i Node zaktualizowane; ogranicz dostęp RDP (firewall na zaufane IP).

---

## Od czego zacząć — skrót
1. Załóż prywatne repo i wypchnij kod (Krok 1).
2. Zdobądź klucz API Claude (Krok 0).
3. RDP na serwer → zainstaluj Node + Git (Krok 2).
4. `git clone` → `npm install` → `npx playwright install chromium` (Kroki 3–4).
5. `.env` z sekretami (Krok 5).
6. `npm run browser` → zaloguj się raz z 2FA, zostaw okno otwarte (Krok 5.5 — WYMAGANE).
7. `npm run once` — test (Krok 6).
8. Task Scheduler na 3:00, sesja interaktywna (Krok 7).
