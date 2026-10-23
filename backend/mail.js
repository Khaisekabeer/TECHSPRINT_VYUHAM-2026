// Email sending service for TechSprint using Resend API.
// Uses native fetch (supported out-of-the-box in Node 18+ and Vercel serverless).

async function sendPasswordResetOtp(email, otp, displayName = 'Staff Member') {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`\n[mail] RESEND_API_KEY is not configured in environment.`);
    console.warn(`[mail] Password reset code for ${email} (${displayName}): >>> ${otp} <<< (valid for 15 mins)\n`);
    return { success: true, simulated: true };
  }

  const from = process.env.RESEND_FROM || 'TechSprint <onboarding@resend.dev>';
  const safeName = displayName || 'Staff Member';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0f17; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f17; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #111827; border: 1px solid #1f2937; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; border-bottom: 1px solid #1f2937;">
              <div style="font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #06b6d4;">TECHSPRINT · VYUHAM '26</div>
              <h1 style="margin: 8px 0 0; font-size: 24px; font-weight: 700; color: #ffffff;">Reset Your Password</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 28px 32px;">
              <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #94a3b8;">
                Hello <strong style="color: #f1f5f9;">${safeName}</strong>,
              </p>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #94a3b8;">
                We received a request to reset the password for your TechSprint staff account (<strong style="color: #38bdf8;">${email}</strong>). Use the one-time code below to proceed:
              </p>

              <!-- OTP Box -->
              <div style="background-color: #030712; border: 1px solid #374151; border-radius: 12px; padding: 22px; text-align: center; margin: 0 0 24px;">
                <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin-bottom: 8px;">Verification Code</div>
                <div style="font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #38bdf8;">
                  ${otp}
                </div>
              </div>

              <p style="margin: 0 0 12px; font-size: 13px; color: #e2e8f0; line-height: 1.5;">
                ⏱ This code will expire in <strong>15 minutes</strong>.
              </p>
              <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                If you did not request a password reset, please ignore this email or notify your system administrator immediately.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #0b0f17; border-top: 1px solid #1f2937; text-align: center; font-size: 12px; color: #475569;">
              TechSprint · Digital University Kerala
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
TECHSPRINT · VYUHAM '26
Password Reset Code

Hello ${safeName},

We received a request to reset the password for your TechSprint staff account (${email}).

Your verification code is: ${otp}

This code will expire in 15 minutes.
If you did not request this, you can safely ignore this email.
  `.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `TechSprint · ${otp} is your password reset code`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error('[mail] Resend API error:', errData);
      throw new Error(errData.message || `Email service error (${res.status})`);
    }

    const data = await res.json().catch(() => ({}));
    return { success: true, id: data.id };
  } catch (err) {
    console.error('[mail] Failed to send email:', err.message);
    throw err;
  }
}

module.exports = {
  sendPasswordResetOtp,
};
