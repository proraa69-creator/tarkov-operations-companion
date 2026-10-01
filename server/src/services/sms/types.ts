/**
 * Pluggable SMS sending for one-time codes (services/phoneAuth.ts).
 *
 * A sender gets an E.164 number (`+79991234567`) and a short text. It must never log the number, the text (it holds
 * the code) or its API key; errors carry only the provider name and the provider's status code.
 */
export type SmsProviderId = 'smsru' | 'smsc' | 'smsaero'
export const SMS_PROVIDERS: readonly SmsProviderId[] = ['smsru', 'smsc', 'smsaero']

export interface SmsSender {
  readonly provider: SmsProviderId | 'fake'
  /** Resolves when the provider accepted the message; rejects with `SmsSendError` otherwise. */
  send(phone: string, text: string): Promise<{ id?: string }>
}

export class SmsSendError extends Error {
  readonly provider: string
  readonly code?: string
  constructor(provider: string, message: string, code?: string) {
    super(message)
    this.provider = provider
    this.code = code
  }
}

/** `fetch` is injectable so providers can be unit-tested without the network. */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const SMS_TIMEOUT_MS = 10_000

/** Digits only, without «+»: what all three providers expect. */
export const providerNumber = (phone: string) => phone.replace(/\D/g, '')

/** Wraps a network / parse failure; an `SmsSendError` passes through unchanged. Never includes the request. */
export function sendFailure(provider: string, error: unknown, unavailable: string) {
  return error instanceof SmsSendError ? error : new SmsSendError(provider, unavailable)
}
