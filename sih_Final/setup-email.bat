@echo off
echo Setting up Email Notifications for Health Surveillance System
echo.

cd backend

echo Installing nodemailer dependency...
npm install nodemailer
echo.

echo Creating .env file from template...
if not exist .env (
    copy .env.example .env
    echo .env file created. Please edit it with your email configuration.
) else (
    echo .env file already exists.
)
echo.

echo Email setup complete!
echo.
echo Next steps:
echo 1. Edit backend/.env file with your email credentials
echo 2. Set up Gmail App Password (see EMAIL_SETUP_GUIDE.md)
echo 3. Configure recipient email addresses
echo 4. Test the system by running: node server.js
echo.
echo For detailed instructions, see EMAIL_SETUP_GUIDE.md
pause