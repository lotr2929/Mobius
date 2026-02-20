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

echo Staging all new files...
git add .

echo Creating %ZIPNAME%...
echo (Using git ls-files to respect .gitignore)
echo.

REM Delete old zip first
if exist "%ZIPNAME%" del "%ZIPNAME%"

REM Use git ls-files to get tracked files and zip them
git ls-files | powershell -Command "$files = $input | ForEach-Object { $_.Trim() } | Where-Object { $_ }; Compress-Archive -Path $files -DestinationPath '%ZIPNAME%' -Force"

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