@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was not found on PATH.
  echo Install it from https://nodejs.org/ then open a NEW Command Prompt.
  echo.
  pause
  exit /b 1
)

echo Installing Doto dependencies in:
echo   %CD%
echo.

if exist "%ProgramFiles%\nodejs\npm.cmd" (
  call "%ProgramFiles%\nodejs\npm.cmd" install
) else (
  call npm install
)

if errorlevel 1 (
  echo.
  echo npm install failed.
  pause
  exit /b 1
)

echo.
echo Done. You can run Doto with run-dev.cmd or: npm run dev
echo.
pause
