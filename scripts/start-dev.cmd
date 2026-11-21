@echo off
setlocal
cd /d "%~dp0.." || exit /b 1

rem Use the matching local Electron copy on Windows when it is available.
if not defined ELECTRON_OVERRIDE_DIST_PATH (
  for /f "delims=" %%V in ('node -p "require('electron/package.json').version"') do (
    if exist "%LOCALAPPDATA%\FastLaTeXer\electron-%%V\electron.exe" (
      set "ELECTRON_OVERRIDE_DIST_PATH=%LOCALAPPDATA%\FastLaTeXer\electron-%%V"
    )
  )
)

call npm.cmd run dev
set "dev_exit=%errorlevel%"
if not "%dev_exit%"=="0" pause
exit /b %dev_exit%
