import type { EmailMessage } from './mailer';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface LayoutOptions {
  to: string;
  subject: string;
  companyName: string;
  heading: string;
  paragraphs: string[];
  action: { label: string; url: string };
  footnote: string;
}

/** A single, inline-styled layout that renders consistently across email clients. */
function layout(options: LayoutOptions): EmailMessage {
  const { to, subject, companyName, heading, paragraphs, action, footnote } = options;
  const company = escapeHtml(companyName);

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
          <tr><td style="padding:28px 32px 8px;font-size:13px;font-weight:600;color:#4f46e5;">${company}</td></tr>
          <tr><td style="padding:0 32px;"><h1 style="margin:8px 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1></td></tr>
          ${paragraphs
            .map(
              (p) =>
                `<tr><td style="padding:0 32px 12px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(p)}</td></tr>`,
            )
            .join('')}
          <tr><td style="padding:12px 32px 24px;">
            <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${escapeHtml(action.label)}</a>
          </td></tr>
          <tr><td style="padding:0 32px 28px;font-size:12px;line-height:1.6;color:#64748b;">
            ${escapeHtml(footnote)}<br />
            If the button doesn't work, paste this link into your browser:<br />
            <span style="word-break:break-all;color:#4f46e5;">${escapeHtml(action.url)}</span>
          </td></tr>
        </table>
        <p style="font-size:12px;color:#94a3b8;margin-top:16px;">Sent by Support Desk on behalf of ${company}</p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    companyName,
    '',
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    `${action.label}: ${action.url}`,
    '',
    footnote,
  ].join('\n');

  return { to, subject, html, text };
}

export function verifyEmailMessage(input: {
  to: string;
  name: string;
  companyName: string;
  url: string;
  isNewCompany: boolean;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: input.isNewCompany
      ? `Confirm your email to activate ${input.companyName}`
      : `Confirm your email for ${input.companyName}`,
    companyName: input.companyName,
    heading: `Hi ${input.name}, please confirm your email`,
    paragraphs: [
      input.isNewCompany
        ? `You're one step away from setting up ${input.companyName} on Support Desk. Confirm that this address belongs to you to activate your account.`
        : `Confirm that this address belongs to you to finish creating your ${input.companyName} account.`,
    ],
    action: { label: 'Confirm email', url: input.url },
    footnote: "This link expires in 24 hours. If you didn't sign up, you can ignore this email.",
  });
}

export function resetPasswordMessage(input: {
  to: string;
  name: string;
  companyName: string;
  url: string;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `Reset your ${input.companyName} password`,
    companyName: input.companyName,
    heading: `Reset your password`,
    paragraphs: [
      `Hi ${input.name}, we received a request to reset the password of your ${input.companyName} account.`,
    ],
    action: { label: 'Choose a new password', url: input.url },
    footnote:
      "This link expires in 1 hour and can be used once. If you didn't ask for a reset, ignore this email — your password stays the same.",
  });
}

export function invitationMessage(input: {
  to: string;
  companyName: string;
  inviterName: string;
  groupName: string;
  url: string;
  hasAccount: boolean;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `${input.inviterName} invited you to the ${input.companyName} support team`,
    companyName: input.companyName,
    heading: `Join the ${input.companyName} support team`,
    paragraphs: [
      `${input.inviterName} invited you to help answer ${input.companyName}'s support tickets as a member of the "${input.groupName}" group.`,
      input.hasAccount
        ? 'Sign in to your account to accept or decline the invitation.'
        : `Create your ${input.companyName} account with this email address, confirm it, and the invitation will be waiting for you.`,
    ],
    action: {
      label: input.hasAccount ? 'View invitation' : 'Create your account',
      url: input.url,
    },
    footnote:
      'The invitation expires in 14 days. If you were not expecting it, you can ignore this email.',
  });
}

export function magicLinkMessage(input: {
  to: string;
  name: string;
  companyName: string;
  url: string;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `Your sign-in link for ${input.companyName}`,
    companyName: input.companyName,
    heading: 'Sign in to your support requests',
    paragraphs: [
      `Hi ${input.name}, use the button below to sign in to ${input.companyName} support and follow your requests.`,
    ],
    action: { label: 'Sign in', url: input.url },
    footnote:
      "This link expires in 30 minutes and can be used once. If you didn't ask for it, you can ignore this email.",
  });
}

export function confirmSubmissionMessage(input: {
  to: string;
  companyName: string;
  subject: string;
  url: string;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `Confirm your request to ${input.companyName}`,
    companyName: input.companyName,
    heading: 'Please confirm your support request',
    paragraphs: [
      `We received your request "${input.subject}". Confirm your email address so it can be sent to the ${input.companyName} support team.`,
      'After confirming you can follow the conversation and reply from your browser.',
    ],
    action: { label: 'Confirm and send my request', url: input.url },
    footnote:
      "The request is deleted if it isn't confirmed within 24 hours. If you didn't submit it, ignore this email.",
  });
}

export function accountClaimMessage(input: {
  to: string;
  name: string;
  companyName: string;
  url: string;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `Finish creating your ${input.companyName} account`,
    companyName: input.companyName,
    heading: 'Choose a password for your account',
    paragraphs: [
      `Hi ${input.name}, you have contacted ${input.companyName} support with this email before. Choose a password to turn it into a full account — your existing requests stay with it.`,
    ],
    action: { label: 'Choose a password', url: input.url },
    footnote:
      "This link expires in 1 hour. If you didn't try to create an account, you can ignore this email.",
  });
}

export function replyNotificationMessage(input: {
  to: string;
  companyName: string;
  ticketNumber: number;
  ticketSubject: string;
  authorName: string;
  preview: string;
  url: string;
}): EmailMessage {
  return layout({
    to: input.to,
    subject: `Re: [#${input.ticketNumber}] ${input.ticketSubject}`,
    companyName: input.companyName,
    heading: `${input.authorName} replied to your request`,
    paragraphs: [input.preview],
    action: { label: 'View and reply', url: input.url },
    footnote: 'The button signs you in automatically. The link works once and expires in 7 days.',
  });
}
