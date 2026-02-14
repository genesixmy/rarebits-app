@echo off
:: Ubah ke folder projek
cd /d C:\Users\Koca\Desktop\Rarebits\rarebits-app\rarebit

:: Check if port 3000 already in use
netstat -ano | findstr :3000
if %errorlevel%==0 (
    echo Vite server already running on port 3000.
    exit /b
)

:: Start Vite preview server minimized
start "" /min cmd /c "npm run start"
