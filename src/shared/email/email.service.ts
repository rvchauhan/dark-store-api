import { Resend } from "resend";
import { env } from "../../config/env.js";

/**
 * Thin Resend wrapper. Without RESEND_API_KEY configured, sends are skipped
 * and callers fall back to showing the link on-screen for manual sharing.
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export const emailConfigured = resend !== null;

/** Returns true if the email was actually sent (false if email isn't configured or the send failed). */
export async function sendManagerInviteEmail(input: {
  to: string;
  name: string;
  inviteLink: string;
}): Promise<boolean> {
  if (!resend) return false;

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: "You've been added as a store manager on Q-Commerce",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #0f6636;">Welcome to Q-Commerce</h2>
          <p>Hi ${input.name},</p>
          <p>An admin has added you as a store manager. Set your password to finish setting up your account:</p>
          <p style="margin: 32px 0;">
            <a href="${input.inviteLink}"
               style="background: #0f6636; color: #fff; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600;">
              Set Your Password
            </a>
          </p>
          <p style="color: #667; font-size: 13px;">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error("Resend failed to send invite email:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send invite email:", err);
    return false;
  }
}
