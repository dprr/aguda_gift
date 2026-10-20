/**
 * Request 34. Outgoing email, for staff alerts only. SMTP_URL in .env selects the mail
 * server, for example smtps://user:password@smtp.example.com:465. Without it, an alert is
 * written to the log instead, so nothing is lost and nothing fails.
 */
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = (mail: Mail) => Promise<void>;

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return async (mail) => {
    await transport.sendMail({ from, ...mail });
  };
}

/** No SMTP_URL: write the alert to the log. */
export const logMailer: Mailer = async (mail) => {
  console.log(JSON.stringify({ mail: { ...mail, sent: false, reason: "SMTP_URL is not set" } }));
};
