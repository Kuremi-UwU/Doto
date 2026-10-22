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

if not exist "node_modules\electron\package.json" (
  echo First run: installing dependencies...
  if exist "%ProgramFiles%\nodejs\npm.cmd" (
    call "%ProgramFiles%\nodejs\npm.cmd" install
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo.
    echo npm install failed. Try running install-deps.cmd first.
    pause
    exit /b 1
  )
  echo.
)

echo Starting Doto...
echo Close this window to quit the app.
echo.

if exist "%ProgramFiles%\nodejs\npm.cmd" (
  call "%ProgramFiles%\nodejs\npm.cmd" run dev
) else (
  call npm run dev
)

if errorlevel 1 (
  echo.
  echo npm run dev failed.
  pause
  exit /b 1
)
