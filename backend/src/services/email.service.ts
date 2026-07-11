import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type SendEmailResult = {
  sent: boolean;
  to: string;
  subject: string;
  messageId?: string;
  previewUrl?: string;
  /** Plain-text fallback body when send is skipped */
  preview?: string;
  mode?: 'smtp' | 'ethereal' | 'json' | 'disabled';
  reason?: string;
};

let transporter: Transporter | null = null;
let transportMode: 'smtp' | 'ethereal' | 'json' | null = null;
let etherealUser: string | null = null;
let initPromise: Promise<Transporter | null> | null = null;

const outboxDir = path.resolve(process.cwd(), 'uploads', 'email-outbox');

function ensureOutbox() {
  try {
    fs.mkdirSync(outboxDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

async function createEtherealTransport(): Promise<Transporter> {
  const testAccount = await nodemailer.createTestAccount();
  etherealUser = testAccount.user;
  logger.info('Email using Ethereal test SMTP (preview URLs logged)', {
    user: testAccount.user,
  });
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

function createSmtpTransport(): Transporter {
  const host = env.SMTP_HOST;
  const port = env.SMTP_PORT;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    tls: {
      // Allow self-signed in local/dev mail servers
      rejectUnauthorized: env.NODE_ENV === 'production',
    },
  });
}

function createJsonTransport(): Transporter {
  ensureOutbox();
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

/**
 * Resolve transporter:
 * - EMAIL_ENABLED=false → null
 * - SMTP_HOST set → real SMTP
 * - else → Ethereal (dev preview inbox) so "send" still works
 */
async function getTransporter(): Promise<Transporter | null> {
  if (!env.EMAIL_ENABLED) return null;
  if (transporter) return transporter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (env.SMTP_HOST) {
        transporter = createSmtpTransport();
        transportMode = 'smtp';
        try {
          await transporter.verify();
          logger.info('SMTP transport verified', { host: env.SMTP_HOST, port: env.SMTP_PORT });
        } catch (e) {
          logger.warn('SMTP verify failed — will still attempt send', { e });
        }
        return transporter;
      }

      // Prefer Ethereal so messages are inspectable online without real mailbox
      try {
        transporter = await createEtherealTransport();
        transportMode = 'ethereal';
        return transporter;
      } catch (e) {
        logger.warn('Ethereal unavailable — falling back to JSON outbox', { e });
        transporter = createJsonTransport();
        transportMode = 'json';
        return transporter;
      }
    } catch (e) {
      logger.error('Failed to init email transport', { e });
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

export function getEmailStatus() {
  return {
    enabled: env.EMAIL_ENABLED,
    mode: env.EMAIL_ENABLED ? transportMode || (env.SMTP_HOST ? 'smtp' : 'ethereal-pending') : 'disabled',
    smtpHost: env.SMTP_HOST || null,
    from: env.SMTP_FROM,
    etherealUser,
  };
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}): Promise<SendEmailResult> {
  const to = options.to?.trim();
  if (!to) {
    return { sent: false, to: '', subject: options.subject, mode: 'disabled', reason: 'No recipient' };
  }

  if (!env.EMAIL_ENABLED) {
    logger.info('Email skipped (EMAIL_ENABLED=false)', { to, subject: options.subject });
    return {
      sent: false,
      to,
      subject: options.subject,
      mode: 'disabled',
      reason: 'Email is disabled. Set EMAIL_ENABLED=true in .env',
      preview: options.text || options.html.replace(/<[^>]+>/g, ' ').slice(0, 500),
    };
  }

  const transport = await getTransporter();
  if (!transport) {
    return {
      sent: false,
      to,
      subject: options.subject,
      mode: 'disabled',
      reason: 'Email transport unavailable',
    };
  }

  const mail: SendMailOptions = {
    from: env.SMTP_FROM,
    to,
    subject: options.subject,
    html: options.html,
    text: options.text || options.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    replyTo: options.replyTo,
    cc: options.cc,
    bcc: options.bcc,
    attachments: options.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  };

  try {
    const info = await transport.sendMail(mail);
    const previewUrl =
      transportMode === 'ethereal' ? nodemailer.getTestMessageUrl(info) || undefined : undefined;

    // Always keep a local HTML copy for ops / debugging
    try {
      ensureOutbox();
      const stamp = Date.now();
      const safeTo = to.replace(/[^a-z0-9@._-]/gi, '_');
      if (transportMode === 'json') {
        const file = path.join(outboxDir, `${stamp}-${safeTo}.json`);
        fs.writeFileSync(
          file,
          typeof info.message === 'string' ? info.message : JSON.stringify(info, null, 2)
        );
        logger.info('Email written to outbox', { file, to, subject: options.subject });
      }
      const htmlFile = path.join(outboxDir, `${stamp}-${safeTo}.html`);
      fs.writeFileSync(
        htmlFile,
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${options.subject}</title></head><body>
          <p><strong>To:</strong> ${to}</p>
          <p><strong>Subject:</strong> ${options.subject}</p>
          <hr/>
          ${options.html}
        </body></html>`,
        'utf8'
      );
    } catch (e) {
      logger.warn('Could not write email outbox copy', { e });
    }

    logger.info('Email sent', {
      to,
      subject: options.subject,
      mode: transportMode,
      messageId: info.messageId,
      previewUrl,
    });

    return {
      sent: true,
      to,
      subject: options.subject,
      messageId: info.messageId,
      previewUrl: previewUrl || undefined,
      mode: transportMode || 'smtp',
    };
  } catch (error) {
    logger.error('Email failed', { error, to, subject: options.subject, mode: transportMode });
    // Persist failed attempt for debugging
    try {
      ensureOutbox();
      const stamp = Date.now();
      const safeTo = to.replace(/[^a-z0-9@._-]/gi, '_');
      fs.writeFileSync(
        path.join(outboxDir, `${stamp}-FAILED-${safeTo}.html`),
        `<!DOCTYPE html><html><body><h1>Send failed</h1><p>${
          error instanceof Error ? error.message : 'Send failed'
        }</p><hr/>${options.html}</body></html>`,
        'utf8'
      );
    } catch {
      /* ignore */
    }
    return {
      sent: false,
      to,
      subject: options.subject,
      mode: transportMode || 'smtp',
      reason: error instanceof Error ? error.message : 'Send failed',
    };
  }
}

export async function sendVerificationEmail(email: string, token: string, name: string): Promise<SendEmailResult> {
  const url = `${env.APP_URL}/verify-email?token=${token}`;
  return sendEmail({
    to: email,
    subject: `${env.APP_NAME} — Verify your email`,
    html: brandTemplate({
      title: `Welcome, ${name}!`,
      bodyHtml: `
        <p>Please verify your email address to activate your account.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Verify email
          </a>
        </p>
        <p style="color:#64748b;font-size:13px">Or open: ${url}</p>
        <p style="color:#64748b;font-size:13px">This link expires in 24 hours.</p>
      `,
    }),
    text: `Welcome ${name}! Verify your email: ${url}`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  name: string,
  otp?: string
): Promise<SendEmailResult> {
  const code = otp || token.split('.')[0] || token.slice(0, 6);
  const url = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: email,
    subject: `${env.APP_NAME} — Your password reset code is ${code}`,
    html: brandTemplate({
      title: `Hello, ${name || 'there'}`,
      bodyHtml: `
        <p>We received a request to reset your password for <strong>${email}</strong>.</p>
        <p style="margin:8px 0 4px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">
          Your reset code
        </p>
        <div style="margin:8px 0 20px;padding:16px 20px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center">
          <span style="font-size:32px;font-weight:800;letter-spacing:0.35em;color:#1d4ed8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
            ${code}
          </span>
        </div>
        <p style="margin:0 0 16px">Enter this code in the app on the <strong>Forgot password</strong> screen, then choose a new password.</p>
        <p style="margin:24px 0">
          <a href="${url}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
            Or open reset link
          </a>
        </p>
        <p style="color:#64748b;font-size:13px;margin:0">
          This code expires in <strong>1 hour</strong>. If you did not request a reset, you can ignore this email — your password will not change.
        </p>
      `,
    }),
    text: [
      `Hello ${name || ''},`,
      ``,
      `Your ${env.APP_NAME} password reset code is: ${code}`,
      ``,
      `Enter this code in the app (Forgot password → enter code), or open:`,
      url,
      ``,
      `This code expires in 1 hour. If you did not request this, ignore this email.`,
    ].join('\n'),
  });
}

export async function sendStaffCredentialsEmail(options: {
  to: string;
  name: string;
  email: string;
  temporaryPassword?: string;
  companyName?: string;
  approved?: boolean;
}): Promise<SendEmailResult> {
  const loginUrl = `${env.APP_URL}/login`;
  const title = options.approved
    ? 'Your staff account is active'
    : 'Your Enterprise IMS account';
  return sendEmail({
    to: options.to,
    subject: `${env.APP_NAME} — ${title}`,
    html: brandTemplate({
      title,
      bodyHtml: `
        <p>Hi ${options.name},</p>
        <p>${
          options.approved
            ? 'An administrator approved your account. You can sign in now.'
            : 'An administrator created a staff account for you.'
        }</p>
        <ul>
          <li><strong>Company:</strong> ${options.companyName || env.APP_NAME}</li>
          <li><strong>Email / username:</strong> ${options.email}</li>
          ${
            options.temporaryPassword
              ? `<li><strong>Temporary password:</strong> <code>${options.temporaryPassword}</code></li>`
              : ''
          }
        </ul>
        <p style="margin:24px 0">
          <a href="${loginUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
            Sign in
          </a>
        </p>
        ${
          options.temporaryPassword
            ? '<p style="color:#64748b;font-size:13px">Please change your password after first login.</p>'
            : ''
        }
      `,
    }),
    text: `Sign in at ${loginUrl} as ${options.email}${
      options.temporaryPassword ? ` with password ${options.temporaryPassword}` : ''
    }`,
  });
}

export async function sendDocumentEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  pdf: Buffer;
  filename: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: [
      {
        filename: options.filename,
        content: options.pdf,
        contentType: 'application/pdf',
      },
    ],
  });
}

function brandTemplate(opts: { title: string; bodyHtml: string }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.08)">
        <tr>
          <td style="background:linear-gradient(135deg,#1d4ed8,#0891b2);padding:20px 24px;color:#fff">
            <div style="font-weight:700;font-size:18px">${env.APP_NAME}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px">
            <h1 style="margin:0 0 12px;font-size:22px">${opts.title}</h1>
            ${opts.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">
            Sent by ${env.APP_NAME}. This is an automated message.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Warm up transporter at server boot (non-blocking). */
export function initEmailOnBoot() {
  if (!env.EMAIL_ENABLED) {
    logger.info('Email disabled (EMAIL_ENABLED=false)');
    return;
  }
  void getTransporter().then((t) => {
    if (t) logger.info('Email ready', getEmailStatus());
  });
}
