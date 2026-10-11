/**
 * Every bug report to the owner's mailbox as a PDF (owner, 11.10.2026: «в случае отчёта об ошибке от пользователей будешь
 * пересылать мне данную заявку в пдф файле на почту raidosapp@gmail.com»). The PDF is services/bugReportPdf.ts; it goes
 * out through the same provider as the e-mail codes (TARKOV_EMAIL_PROVIDER / TARKOV_EMAIL_API_KEY, Resend), to
 * TARKOV_BUG_REPORT_EMAIL (default raidosapp@gmail.com; «off» turns it off).
 *
 * New reports are sent in the background one after another (a PDF with screenshots is built in memory), so the player's
 * answer never waits for the mail. The outcome is kept on the report (mailed_at / mail_error) and shown in the admin
 * panel, where the owner can send it again.
 */
import { EmailSendError, type EmailAttachment, type EmailSender } from './email/types.js'
import { bugReportPdf } from './bugReportPdf.js'
import type { BugReportStore, BugReportView } from './bugReportStore.js'

export const DEFAULT_BUG_REPORT_EMAIL = 'raidosapp@gmail.com'
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/

/** Where the PDFs go: TARKOV_BUG_REPORT_EMAIL, else raidosapp@gmail.com; undefined when it is «off». */
export function bugReportEmailFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = (env.TARKOV_BUG_REPORT_EMAIL ?? '').trim()
  if (raw.toLowerCase() === 'off') return undefined
  return ADDRESS.test(raw) ? raw : DEFAULT_BUG_REPORT_EMAIL
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
/** One line, no header tricks. */
const oneLine = (value: string, max: number) => value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)

function message(report: BugReportView) {
  const from = report.email ?? 'аккаунт удалён'
  const lines = [
    `Новый отчёт об ошибке №${report.id}`,
    `От: ${from}`,
    `Тема: ${oneLine(report.topic, 200)}`,
    `Версия: ${report.appVersion || '—'} · ${report.platform || '—'}`,
    '',
    report.description,
    '',
    'PDF с отчётом и скриншотами — во вложении. Выдать дни за отчёт: raidos.app → Админ-панель → «Отчёты».',
  ]
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1c211f">
<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#9a7a2c">RAID OS</p>
<h2 style="margin:0 0 12px;font-size:20px">Отчёт об ошибке №${report.id}</h2>
<p style="margin:0">От: <b>${escapeHtml(from)}</b></p>
<p style="margin:0">Тема: <b>${escapeHtml(oneLine(report.topic, 200))}</b></p>
<p style="margin:0 0 12px;color:#69706c">Версия: ${escapeHtml(report.appVersion || '—')} · ${escapeHtml(report.platform || '—')}</p>
<div style="white-space:pre-wrap;padding:12px;border:1px solid #d6d8d2;border-radius:8px">${escapeHtml(report.description)}</div>
<p style="margin:12px 0 0;color:#69706c">PDF с отчётом и скриншотами — во вложении. Выдать дни за отчёт: raidos.app → Админ-панель → «Отчёты».</p>
</div>`
  return { subject: `Raid OS · отчёт об ошибке №${report.id}: ${oneLine(report.topic, 100)}`, text: lines.join('\n'), html }
}

export class BugReportMailer {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: BugReportStore,
    private readonly sender: EmailSender | undefined,
    private readonly to: string | undefined,
    private readonly log: (message: string) => void = () => {},
  ) {}

  /** A provider and a mailbox are set. */
  get enabled() {
    return Boolean(this.sender && this.to)
  }

  /** Sends in the background, after the ones queued before (one PDF in memory at a time). */
  queue(id: number) {
    if (!this.enabled) return
    this.chain = this.chain.then(() => this.send(id)).catch(() => undefined)
  }

  /** Builds the PDF and sends it now; the result (or the error) is saved on the report, which is returned. */
  async send(id: number): Promise<BugReportView | undefined> {
    const report = this.store.get(id)
    if (!report) return undefined
    if (!this.sender || !this.to) {
      this.store.markMailFailed(id, 'Отправка писем на сервере не настроена')
      return this.store.get(id)
    }
    try {
      const files = this.store.files(id)
      const { pdf, skipped } = await bugReportPdf({ ...report, files })
      const attachments: EmailAttachment[] = [
        { filename: `raidos-bug-report-${id}.pdf`, content: Buffer.from(pdf).toString('base64'), contentType: 'application/pdf' },
        ...files.filter((file) => skipped.includes(file.idx)).map((file) => ({
          filename: `raidos-bug-report-${id}-${file.idx + 1}.${file.mime.slice('image/'.length).replace('jpeg', 'jpg')}`,
          content: file.data.toString('base64'),
          contentType: file.mime,
        })),
      ]
      await this.sender.send({ to: this.to, ...message(report), attachments })
      this.store.markMailed(id)
    } catch (error) {
      const reason = error instanceof EmailSendError ? error.message : 'Не удалось собрать PDF или отправить письмо'
      this.store.markMailFailed(id, reason)
      this.log(`Bug report ${id}: the PDF was not mailed (${reason})`)
    }
    return this.store.get(id)
  }
}
