/**
 * Raid OS e-mails: one-time codes, the «someone tried to register with your address» notice and the owner's test
 * e-mail. Russian first, one English line. Plain inline-styled HTML plus a text part: no images, no remote resources,
 * no tracking pixels, no tracked links.
 */
import type { EmailMessage } from './types.js'

export type EmailTemplate = 'register' | 'verify' | 'login' | 'reset' | 'notice' | 'test'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const CODE_TEMPLATES: ReadonlySet<EmailTemplate> = new Set(['register', 'verify', 'login', 'reset'])

interface Copy { subject: string; title: string; lead: string; english: string; footer: string }

const KEEP_SECRET = 'Никому не сообщайте код — даже «поддержке». Если вы ничего не запрашивали, просто удалите это письмо.'

const COPY: Record<EmailTemplate, (minutes: number) => Copy> = {
  register: (minutes) => ({
    subject: 'Raid OS: код подтверждения регистрации',
    title: 'Подтвердите e-mail',
    lead: `Введите этот код на сайте или в приложении Raid OS, чтобы завершить регистрацию. Код действует ${minutes} минут.`,
    english: `Your Raid OS sign-up code. It expires in ${minutes} minutes.`,
    footer: KEEP_SECRET,
  }),
  verify: (minutes) => ({
    subject: 'Raid OS: код подтверждения e-mail',
    title: 'Подтвердите e-mail',
    lead: `Введите этот код в личном кабинете Raid OS, чтобы подтвердить адрес. Код действует ${minutes} минут.`,
    english: `Your Raid OS e-mail confirmation code. It expires in ${minutes} minutes.`,
    footer: KEEP_SECRET,
  }),
  login: (minutes) => ({
    subject: 'Raid OS: код для входа',
    title: 'Вход в Raid OS',
    lead: `Код для входа в аккаунт. Действует ${minutes} минут.`,
    english: `Your Raid OS sign-in code. It expires in ${minutes} minutes.`,
    footer: KEEP_SECRET,
  }),
  reset: (minutes) => ({
    subject: 'Raid OS: код для сброса пароля',
    title: 'Сброс пароля',
    lead: `Код для смены пароля. Действует ${minutes} минут. После смены пароля все входы на других устройствах завершатся.`,
    english: `Your Raid OS password reset code. It expires in ${minutes} minutes.`,
    footer: 'Никому не сообщайте код. Если вы не просили сбросить пароль, удалите это письмо: без кода пароль не изменится.',
  }),
  notice: () => ({
    subject: 'Raid OS: попытка регистрации с вашим адресом',
    title: 'Кто-то пытался зарегистрироваться с вашим адресом',
    lead: 'Только что кто-то попробовал создать аккаунт Raid OS с этим e-mail. Аккаунт на этот адрес у вас уже есть, поэтому новый не создан и ничего не изменилось.',
    english: 'Someone tried to sign up for Raid OS with this address. You already have an account, so nothing was changed.',
    footer: 'Если это были вы — просто войдите со своим паролем или воспользуйтесь «Забыли пароль?». Если нет — ничего делать не нужно.',
  }),
  test: () => ({
    subject: 'Raid OS: тестовое письмо',
    title: 'Отправка писем работает',
    lead: 'Это тестовое письмо из приложения владельца Raid OS: сервер может отправлять коды подтверждения.',
    english: 'This is a test e-mail from the Raid OS owner app: one-time codes can be sent.',
    footer: 'Отвечать на это письмо не нужно.',
  }),
}

/** The finished message for `to`. `code` is required for the code templates and ignored by the others. */
export function renderEmail(template: EmailTemplate, to: string, options: { code?: string; ttlMinutes?: number } = {}): EmailMessage {
  const copy = COPY[template](options.ttlMinutes ?? 10)
  // Only the code templates ever show a code.
  const code = CODE_TEMPLATES.has(template) && options.code && /^\d{4,8}$/.test(options.code) ? options.code : ''
  const codeHtml = code
    ? `<div style="margin:24px 0;padding:18px 0;text-align:center;background:#11151a;border:1px solid #2a323b;border-radius:10px;font:700 34px/1 'SFMono-Regular',Consolas,'Liberation Mono',monospace;letter-spacing:10px;color:#e7c46a">${code}</div>`
    : ''
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHtml(copy.subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0e12">
<div style="max-width:520px;margin:0 auto;padding:28px 18px;font:15px/1.55 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#d7dde4">
<div style="font:800 13px/1 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:4px;color:#e7c46a;text-transform:uppercase">Raid OS</div>
<div style="margin-top:18px;padding:24px;background:#151a20;border:1px solid #232b34;border-radius:14px">
<h1 style="margin:0 0 10px;font-size:21px;line-height:1.3;color:#ffffff">${escapeHtml(copy.title)}</h1>
<p style="margin:0">${escapeHtml(copy.lead)}</p>
${codeHtml}
<p style="margin:0;color:#9aa6b2;font-size:13px">${escapeHtml(copy.footer)}</p>
<p style="margin:16px 0 0;color:#7d8894;font-size:13px" lang="en">${escapeHtml(copy.english)}</p>
</div>
<p style="margin:18px 0 0;color:#5f6a75;font-size:12px">Письмо отправлено автоматически, отвечать на него не нужно. Raid OS — помощник для Escape from Tarkov.</p>
</div>
</body></html>`
  const text = [
    'RAID OS', '', copy.title, '', copy.lead, ...(code ? ['', `Код: ${code}`] : []), '', copy.footer, '', copy.english, '',
    'Письмо отправлено автоматически, отвечать на него не нужно.',
  ].join('\n')
  return { to, subject: copy.subject, html, text }
}
