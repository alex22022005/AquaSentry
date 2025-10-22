@echo off
echo Installing dependencies for Health Surveillance System...
echo.

cd backend

echo Checking if package.json exists...
if not exist package.json (
    echo Creating package.json...
    echo {> package.json
    echo   "name": "health-surveillance-backend",>> package.json
    echo   "version": "1.0.0",>> package.json
    echo   "description": "Backend server for Health Surveillance System",>> package.json
    echo   "main": "server.js",>> package.json
    echo   "dependencies": {}>> package.json
    echo }>> package.json
)

echo.
echo Installing nodemailer for email functionality...
npm install nodemailer

echo.
echo Installing other dependencies if needed...
npm install express ws csv-writer csv-parser

echo.
echo Dependencies installed successfully!
echo.
echo You can now run the server with: node server.js
echo For email configuration, see EMAIL_SETUP_GUIDE.md
pause