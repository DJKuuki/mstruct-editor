@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "EDITOR_DIR=%SCRIPT_DIR%"
set "PACKAGE_FILE=%EDITOR_DIR%\package.json"
set "BUILDER_CMD=%EDITOR_DIR%\node_modules\.bin\electron-builder.cmd"
set "ELECTRON_EXE=%EDITOR_DIR%\node_modules\electron\dist\electron.exe"
set "MSTRUCT_SMOKE_LOG=%EDITOR_DIR%\release\smoke-test.log"
set "MSTRUCT_SMOKE_USER_DATA=%EDITOR_DIR%\release\smoke-user-data"

if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
if not defined ELECTRON_BUILDER_BINARIES_MIRROR set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"

if not exist "%PACKAGE_FILE%" (
  echo [ERROR] Cannot find "%PACKAGE_FILE%".
  set "EXIT_CODE=1"
  goto :finish
)

pushd "%EDITOR_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot enter "%EDITOR_DIR%".
  set "EXIT_CODE=1"
  goto :finish
)

if not exist "%BUILDER_CMD%" (
  echo Desktop dependencies are missing. Running npm ci...
  call npm.cmd ci
  if errorlevel 1 (
    set "EXIT_CODE=%ERRORLEVEL%"
    popd
    goto :finish
  )
)

if not exist "%ELECTRON_EXE%" (
  echo Electron runtime is missing. Downloading the locked version...
  call node node_modules\electron\install.js
  if errorlevel 1 (
    set "EXIT_CODE=%ERRORLEVEL%"
    popd
    goto :finish
  )
)

if defined MSTRUCT_BUILD_KEEP_VERSION (
  echo Keeping the current desktop version for automated verification...
) else (
  echo Preparing the desktop version...
  call npm.cmd run desktop:version -- --prepare-build
  if errorlevel 1 (
    set "EXIT_CODE=1"
    popd
    goto :finish
  )
)
for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%V"
set "BUILD_OUTPUT_REL=release\.mstruct-build-%APP_VERSION%-%RANDOM%-%RANDOM%"
set "BUILD_OUTPUT_DIR=%EDITOR_DIR%\%BUILD_OUTPUT_REL%"
set "BUILDER_UNPACKED_DIR=%BUILD_OUTPUT_DIR%\win-unpacked"
set "BUILDER_UNPACKED_EXE=%BUILDER_UNPACKED_DIR%\mstruct editor.exe"
set "UNPACKED_DIR=%EDITOR_DIR%\release\MStruct-Analysis-Editor-%APP_VERSION%-win-x64"
set "UNPACKED_EXE=%UNPACKED_DIR%\mstruct editor.exe"
set "ZIP_FILE=%EDITOR_DIR%\release\MStruct-Analysis-Editor-%APP_VERSION%-win-x64.zip"

if exist "%UNPACKED_DIR%" (
  echo [ERROR] The unpacked %APP_VERSION% folder already exists:
  echo         "%UNPACKED_DIR%"
  echo Delete it manually or build a new version, then try again.
  set "EXIT_CODE=1"
  popd
  goto :finish
)
if exist "%ZIP_FILE%" (
  echo [ERROR] The %APP_VERSION% ZIP already exists:
  echo         "%ZIP_FILE%"
  echo Delete it manually or build a new version, then try again.
  set "EXIT_CODE=1"
  popd
  goto :finish
)

echo Building MStruct Analysis Editor %APP_VERSION%...
call npm.cmd run desktop:dist -- --config.directories.output="%BUILD_OUTPUT_REL%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  popd
  goto :finish
)

if not exist "%BUILDER_UNPACKED_EXE%" (
  echo [ERROR] Packaged application was not created at "%BUILDER_UNPACKED_EXE%".
  set "EXIT_CODE=1"
  popd
  goto :finish
)

echo Finalizing the versioned unpacked folder...
move "%BUILDER_UNPACKED_DIR%" "%UNPACKED_DIR%" >nul
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Could not create the versioned unpacked folder.
  echo The completed build remains at "%BUILDER_UNPACKED_DIR%".
  popd
  goto :finish
)
rmdir /s /q "%BUILD_OUTPUT_DIR%"

echo Creating the distributable ZIP before launching the packaged application...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $source = '%UNPACKED_DIR%'; $destination = '%ZIP_FILE%'; $maxAttempts = 5; for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) { try { if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }; Compress-Archive -LiteralPath $source -DestinationPath $destination -CompressionLevel Optimal; exit 0 } catch { if ($attempt -ge $maxAttempts) { Write-Error ('ZIP creation failed after {0} attempts: {1}' -f $maxAttempts, $_.Exception.Message); exit 1 }; Write-Host ('ZIP attempt {0} failed; retrying in 2 seconds...' -f $attempt); Start-Sleep -Seconds 2 } }; exit 1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  popd
  goto :finish
)

echo Running the packaged application smoke test...
if exist "%MSTRUCT_SMOKE_LOG%" del /f /q "%MSTRUCT_SMOKE_LOG%"
if exist "%MSTRUCT_SMOKE_USER_DATA%" rmdir /s /q "%MSTRUCT_SMOKE_USER_DATA%"
start "" /wait "%UNPACKED_EXE%" --smoke-test
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  if exist "%MSTRUCT_SMOKE_LOG%" type "%MSTRUCT_SMOKE_LOG%"
  if exist "%MSTRUCT_SMOKE_USER_DATA%" rmdir /s /q "%MSTRUCT_SMOKE_USER_DATA%"
  if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"
  echo [ERROR] Packaged application smoke test failed with exit code %EXIT_CODE%.
  if exist "%ZIP_FILE%" (
    echo [WARNING] The unverified ZIP could not be removed: "%ZIP_FILE%".
  ) else (
    echo The unverified ZIP was removed. The unpacked folder was kept for diagnosis.
  )
  popd
  goto :finish
)
if exist "%MSTRUCT_SMOKE_LOG%" del /f /q "%MSTRUCT_SMOKE_LOG%"
if exist "%MSTRUCT_SMOKE_USER_DATA%" rmdir /s /q "%MSTRUCT_SMOKE_USER_DATA%"
popd

if "%EXIT_CODE%"=="0" (
  echo.
  echo Build complete.
  echo Folder: "%UNPACKED_DIR%"
  echo ZIP:    "%ZIP_FILE%"
) else (
  echo.
  echo [ERROR] Desktop build failed with exit code %EXIT_CODE%.
)

:finish
if not defined EXIT_CODE set "EXIT_CODE=1"
if not defined MSTRUCT_BATCH_NO_PAUSE pause
exit /b %EXIT_CODE%
