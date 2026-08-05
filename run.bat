@echo off
REM ── Uruchamiacz agenta dla Harmonogramu zadań (Task Scheduler) ──
REM Wywoływany co noc. Loguje wynik do pliku z datą.

cd /d "%~dp0"

if not exist "logs" mkdir "logs"

REM %date% bywa różnie sformatowany zależnie od ustawień regionalnych —
REM jeśli w nazwie pliku pojawią się dziwne znaki, zamień na stałą nazwę run.log
set LOGFILE=logs\run-%date:/=-%.log

echo ================================================== >> "%LOGFILE%"
echo Start: %date% %time% >> "%LOGFILE%"

call npm start >> "%LOGFILE%" 2>&1

echo Koniec: %date% %time% >> "%LOGFILE%"
