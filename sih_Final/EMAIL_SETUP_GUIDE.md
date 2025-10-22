# Email Alert Setup Guide

This guide will help you configure email notifications for the Health Surveillance System.

## Prerequisites

1. Install nodemailer dependency:

```bash
cd backend
npm install nodemailer
```

## Email Configuration

### Option 1: Gmail (Recommended)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:

   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
   - Copy the 16-character password

3. **Set Environment Variables**:

```bash
# Windows
set EMAIL_USER=your-email@gmail.com
set EMAIL_PASS=your-16-character-app-password

# Linux/Mac
export EMAIL_USER=your-email@gmail.com
export EMAIL_PASS=your-16-character-app-password
```

### Option 2: Custom SMTP Server

Update the `emailTransporter` configuration in `backend/server.js`:

```javascript
const emailTransporter = nodemailer.createTransporter({
  host: "smtp.your-provider.com",
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
```

## Email Recipients Configuration

### Maintenance Alert Recipients

These emails receive alerts when water quality parameters are in WARNING or DANGER states:

```bash
# Set environment variables
set MAINTENANCE_EMAIL_1=maintenance-team@company.com
set MAINTENANCE_EMAIL_2=facility-manager@company.com
set MAINTENANCE_EMAIL_3=water-technician@company.com
```

### Health Alert Recipients

These emails receive CRITICAL alerts when disease risk exceeds 70%:

```bash
# Set environment variables
set HEALTH_EMAIL_1=health-officer@company.com
set HEALTH_EMAIL_2=emergency-response@company.com
set HEALTH_EMAIL_3=public-health@company.com
```

## Alert Triggers

### Maintenance Alerts

- **Trigger**: When TDS, pH, or Turbidity readings are in WARNING or DANGER levels
- **Frequency**: Maximum once every 30 minutes per parameter
- **Recipients**: Maintenance team emails
- **Content**: Parameter values, severity level, recommended actions

### Health Alerts

- **Trigger**: When any disease risk probability exceeds 70%
- **Frequency**: Maximum once every 30 minutes per disease
- **Recipients**: Health authority emails
- **Content**: Disease name, risk percentage, emergency response actions
- **Priority**: HIGH (marked as urgent email)

## Testing Email Configuration

1. **Start the server**:

```bash
cd backend
node server.js
```

2. **Trigger a test alert**:
   - Manually adjust sensor readings to trigger warnings
   - Or use the browser console to test:

```javascript
// Test maintenance alert
fetch("/api/maintenance-alert", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    suggestions: [
      {
        parameter: "Test",
        severity: "warning",
        text: "Test alert",
        solution: "This is a test",
      },
    ],
  }),
});

// Test health alert
fetch("/api/health-alert", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    diseaseData: {
      "Test Disease": { probability: 0.75 },
    },
  }),
});
```

## Troubleshooting

### Common Issues

1. **"Invalid login" error**:

   - Ensure 2FA is enabled on Gmail
   - Use App Password, not regular password
   - Check EMAIL_USER and EMAIL_PASS environment variables

2. **"Connection timeout" error**:

   - Check internet connection
   - Verify SMTP server settings
   - Try different port (587, 465, 25)

3. **Emails not received**:

   - Check spam/junk folders
   - Verify recipient email addresses
   - Check server logs for error messages

4. **Too many emails**:
   - System has 30-minute cooldown per alert type
   - Check if multiple instances are running

### Logs

Monitor the server console for email-related messages:

- `Maintenance alert email sent for: [parameters]`
- `CRITICAL health alert email sent for: [diseases]`
- `Failed to send [type] alert email: [error]`

## Security Notes

- Never commit email credentials to version control
- Use environment variables for all sensitive data
- Consider using dedicated service accounts for system emails
- Regularly rotate email passwords
- Monitor email usage for suspicious activity

## Production Deployment

For production environments:

1. Use a dedicated SMTP service (SendGrid, AWS SES, etc.)
2. Set up proper DNS records (SPF, DKIM, DMARC)
3. Use secure environment variable management
4. Implement email rate limiting
5. Set up monitoring for email delivery failures
