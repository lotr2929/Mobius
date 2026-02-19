@echo off
echo ========================================
echo  Mobius Web Deployment to GitHub/Render
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "index.html" (
    echo ERROR: index.html not found!
    echo Please run this from the Mobius_Web folder.
    pause
    exit /b 1
)

REM Prevent secrets folder from being committed
git update-index --assume-unchanged secrets/* 2>nul

REM Check if there are any real changes (excluding service-worker.js)
git diff --name-only > %TEMP%\changed_files.txt
git diff --cached --name-only >> %TEMP%\changed_files.txt
git ls-files --others --exclude-standard >> %TEMP%\changed_files.txt

REM Remove service-worker.js from the list to see if anything else changed
findstr /v "service-worker.js" %TEMP%\changed_files.txt > %TEMP%\real_changes.txt

for %%A in (%TEMP%\real_changes.txt) do set FILESIZE=%%~zA
if %FILESIZE%==0 (
    echo No real changes detected. Skipping deployment.
    pause
    exit /b 0
)

REM Generate timestamp e.g. 20260218-1430
set TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%-%TIME:~0,2%%TIME:~3,2%
set TIMESTAMP=%TIMESTAMP: =0%
set CACHE_NAME=mobius-%TIMESTAMP%

echo [0/3] Updating cache version to: %CACHE_NAME%
powershell -Command "(Get-Content service-worker.js) -replace \"const CACHE_NAME = '.*';\", \"const CACHE_NAME = '%CACHE_NAME%';\" | Set-Content service-worker.js"
echo.

echo [1/3] Staging files...
git add .
REM Unstage secrets folder just in case
git reset HEAD secrets/ 2>nul
echo.

echo [2/3] Committing changes...
git commit -m "Deploy update %CACHE_NAME%"
if %errorlevel% neq 0 (
    echo No changes to commit.
    echo.
)

echo [3/3] Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: Push failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Deployment Complete!
echo  Render will auto-deploy in 2-3 minutes
echo  URL: https://mobius-8e5m.onrender.com
echo ========================================
pause