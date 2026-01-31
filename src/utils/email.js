const nodemailer = require('nodemailer');

/**
 * Configure and create a nodemailer transporter for sending emails
 * Supports SMTP configuration via environment variables
 */
function createTransporter() {
  // Check if email is configured
  const emailHost = process.env.EMAIL_HOST;
  const emailPort = process.env.EMAIL_PORT;
  const emailUser = process.env.EMAIL_USER;
  const emailPassword = process.env.EMAIL_PASSWORD;

  if (!emailHost || !emailUser || !emailPassword) {
    console.warn('⚠️  Email configuration missing. Email verification will not work.');
    console.warn('   Set EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD in .env');
    return null;
  }

  // Create transporter with SMTP configuration
  const transporter = nodemailer.createTransport({
    host: emailHost,
    port: parseInt(emailPort || '587', 10),
    secure: emailPort === '465', // true for 465, false for other ports
    auth: {
      user: emailUser,
      pass: emailPassword
    },
    // For development/testing with services like Gmail
    // You may need to enable "Less secure app access" or use App Passwords
    tls: {
      rejectUnauthorized: false // Set to true in production with valid certificates
    }
  });

  return transporter;
}

/**
 * Send email verification email to user
 * @param {Object} options - Email options
 * @param {String} options.email - Recipient email address
 * @param {String} options.name - Recipient name
 * @param {String} options.verificationToken - Email verification token
 * @param {String} options.verificationUrl - Full URL to verification endpoint
 * @param {String} options.verificationCode - Email verification code (6-digit)
 * @returns {Promise<Object>} - Result from nodemailer
 */
async function sendVerificationEmail({ email, name, verificationToken, verificationUrl, verificationCode }) {
  const transporter = createTransporter();
  if (!transporter) {
    throw new Error('Email service not configured. Please set EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD in .env');
  }

  const appName = process.env.APP_NAME || 'WMS';
  const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
  
  // Format expiry time for display (show minutes if less than 1 hour)
  const expiryMinutes = Math.round(expiryHours * 60);
  const expiryText = expiryHours < 1 
    ? `${expiryMinutes} ${expiryMinutes === 1 ? 'minute' : 'minutes'}`
    : `${expiryHours} ${expiryHours === 1 ? 'hour' : 'hours'}`;

  // Email subject
  const subject = `Verify your ${appName} account`;

  // Email HTML content
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin: 20px 0;">
        <h1 style="color: #007bff; margin-top: 0;">Welcome to ${appName}!</h1>
        
        <p>Hi ${name || 'there'},</p>
        
        <p>Thank you for signing up! Please verify your email address using one of the methods below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; margin-bottom: 20px;">
            Verify Email Address (Link)
          </a>
        </div>
        
        ${verificationCode ? `
        <div style="background-color: #fff; border: 2px solid #007bff; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #666; font-weight: 600;">Or use this verification code:</p>
          <p style="margin: 0; font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 8px; font-family: monospace;">
            ${verificationCode}
          </p>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #999;">Enter this code in the app to verify your email</p>
        </div>
        ` : ''}
        
        <p style="font-size: 14px; color: #666;">
          Or copy and paste this link into your browser:<br>
          <a href="${verificationUrl}" style="color: #007bff; word-break: break-all;">${verificationUrl}</a>
        </p>
        
        <p style="font-size: 14px; color: #666; margin-top: 30px;">
          This verification link and code will expire in ${expiryText}. If you didn't create an account, you can safely ignore this email.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="font-size: 12px; color: #999; margin: 0;">
          If you're having trouble clicking the button, copy and paste the URL above into your web browser.
        </p>
      </div>
    </body>
    </html>
  `;

  // Plain text version (for email clients that don't support HTML)
  const textContent = `
Welcome to ${appName}!

Hi ${name || 'there'},

Thank you for signing up! Please verify your email address using one of these methods:

1. Click this link: ${verificationUrl}
${verificationCode ? `\n2. Or enter this verification code in the app: ${verificationCode}` : ''}

This verification link and code will expire in ${expiryText}. If you didn't create an account, you can safely ignore this email.
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    });

    console.log('✅ Verification email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error sending verification email:', error);
    throw error;
  }
}

/**
 * Send resend verification email (same as verification email but with different message)
 * @param {Object} options - Email options
 * @param {String} options.email - Recipient email address
 * @param {String} options.name - Recipient name
 * @param {String} options.verificationToken - Email verification token
 * @param {String} options.verificationUrl - Full URL to verification endpoint
 * @param {String} options.verificationCode - Email verification code (6-digit)
 * @returns {Promise<Object>} - Result from nodemailer
 */
async function sendResendVerificationEmail({ email, name, verificationToken, verificationUrl, verificationCode }) {
  const transporter = createTransporter();
  if (!transporter) {
    throw new Error('Email service not configured. Please set EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD in .env');
  }

  const appName = process.env.APP_NAME || 'WMS';
  const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const expiryHours = parseFloat(process.env.VERIFICATION_EXPIRY_HOURS || '0.25');
  
  // Format expiry time for display (show minutes if less than 1 hour)
  const expiryMinutes = Math.round(expiryHours * 60);
  const expiryText = expiryHours < 1 
    ? `${expiryMinutes} ${expiryMinutes === 1 ? 'minute' : 'minutes'}`
    : `${expiryHours} ${expiryHours === 1 ? 'hour' : 'hours'}`;

  const subject = `Verify your ${appName} account`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin: 20px 0;">
        <h1 style="color: #007bff; margin-top: 0;">Verify Your Email</h1>
        
        <p>Hi ${name || 'there'},</p>
        
        <p>You requested a new verification email. Please verify your email address using one of the methods below:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; margin-bottom: 20px;">
            Verify Email Address (Link)
          </a>
        </div>
        
        ${verificationCode ? `
        <div style="background-color: #fff; border: 2px solid #007bff; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #666; font-weight: 600;">Or use this verification code:</p>
          <p style="margin: 0; font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 8px; font-family: monospace;">
            ${verificationCode}
          </p>
          <p style="margin: 10px 0 0 0; font-size: 12px; color: #999;">Enter this code in the app to verify your email</p>
        </div>
        ` : ''}
        
        <p style="font-size: 14px; color: #666;">
          Or copy and paste this link into your browser:<br>
          <a href="${verificationUrl}" style="color: #007bff; word-break: break-all;">${verificationUrl}</a>
        </p>
        
        <p style="font-size: 14px; color: #666; margin-top: 30px;">
          This verification link and code will expire in ${expiryText}.
        </p>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Hi ${name || 'there'},

You requested a new verification email. Please verify your email address using one of these methods:

1. Click this link: ${verificationUrl}
${verificationCode ? `\n2. Or enter this verification code in the app: ${verificationCode}` : ''}

This verification link and code will expire in ${expiryText}.
  `;

  try {
    const info = await transporter.sendMail({
      from: `"${appName}" <${fromEmail}>`,
      to: email,
      subject: subject,
      text: textContent,
      html: htmlContent
    });

    console.log('✅ Resend verification email sent:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error sending resend verification email:', error);
    throw error;
  }
}

module.exports = {
  sendVerificationEmail,
  sendResendVerificationEmail,
  createTransporter
};
