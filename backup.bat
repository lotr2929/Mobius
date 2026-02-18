@echo off
echo ========================================
echo  Mobius Backup - Creating zip for Claude
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "index.html" (
    echo ERROR: index.html not found!
    echo Please run this from the Mobius_Web folder.
    pause
    exit /b 1
)

REM Generate timestamp
set TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%-%TIME:~0,2%%TIME:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%
set ZIPNAME=Mobius-backup.zip
echo Backup created: %TIMESTAMP% > backup-timestamp.txt

echo Creating %ZIPNAME%...
echo (Skipping node_modules, .git, and .gif files)
echo.

powershell -Command "Compress-Archive -Path (Get-ChildItem -Path '.' -Recurse | Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\.git\\' -and $_.Extension -ne '.gif' -and -not $_.PSIsContainer } | Select-Object -ExpandProperty FullName) -DestinationPath '%ZIPNAME%'"

if %errorlevel% neq 0 (
    echo ERROR: Zip creation failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Backup Complete: %ZIPNAME%
echo  Upload this file to Claude to continue.
echo ========================================
pause