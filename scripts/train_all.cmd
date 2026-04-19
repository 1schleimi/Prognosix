@echo off
setlocal enabledelayedexpansion

rem Train the full 6-model ensemble: 2 architectures × 3 seeds.
rem Run from the project root: scripts\train_all.cmd
rem Pass --skip-fetch as first argument after first run

set "PROJECT_ROOT=%~dp0.."
pushd "%PROJECT_ROOT%"

:: Use GPU venv if available, otherwise fall back to system python
if exist "%PROJECT_ROOT%\.venv312\Scripts\python.exe" (
    set "PYTHON=%PROJECT_ROOT%\.venv312\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

set "SKIP_FETCH=%~1"

echo === Stock-Predictor Ensemble Training ===
echo   Project root: %CD%
echo   Started: %DATE% %TIME%
echo.

set "TOTAL_START=%TIME%"

for %%M in (lstm_v2 patchtst) do (
    for %%S in (1 2 3) do (
        echo ──────────────────────────────────────────
        echo   [START] %%M  seed=%%S
        echo ──────────────────────────────────────────

        call :GetSeconds START_SEC
        "!PYTHON!" -m src.train --model %%M --seed %%S !SKIP_FETCH!
        if errorlevel 1 (
            echo.
            echo Fehler beim Training von %%M mit seed %%S
            popd
            exit /b 1
        )
        call :GetSeconds END_SEC

        set /a ELAPSED=END_SEC-START_SEC
        if !ELAPSED! lss 0 set /a ELAPSED+=86400

        set /a MINS=ELAPSED/60
        set /a SECS=ELAPSED%%60

        echo   [OK] Done in !MINS!m !SECS!s
        echo.

        set "SKIP_FETCH=--skip-fetch"
    )
)

call :GetSeconds TOTAL_END_SEC
call :ParseTimeToSeconds "%TOTAL_START%" TOTAL_START_SEC

set /a TOTAL=TOTAL_END_SEC-TOTAL_START_SEC
if !TOTAL! lss 0 set /a TOTAL+=86400

echo === All 6 models trained in !TOTAL!s (!TOTAL!/60!m) ===
echo   Checkpoints: %CD%\models\ensemble\
echo   Next: python -m src.evaluate

popd
exit /b 0

:GetSeconds
setlocal
set "t=%TIME%"
for /f "tokens=1-4 delims=:., " %%a in ("%t%") do (
    set /a hh=1%%a-100
    set /a mm=1%%b-100
    set /a ss=1%%c-100
)
set /a total=hh*3600+mm*60+ss
endlocal & set "%~1=%total%"
exit /b

:ParseTimeToSeconds
setlocal
set "t=%~1"
for /f "tokens=1-4 delims=:., " %%a in ("%t%") do (
    set /a hh=1%%a-100
    set /a mm=1%%b-100
    set /a ss=1%%c-100
)
set /a total=hh*3600+mm*60+ss
endlocal & set "%~2=%total%"
exit /b