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

echo [1/3] Staging files...
git add .
echo.

echo [2/3] Committing changes...
git commit -m "Deploy update"
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