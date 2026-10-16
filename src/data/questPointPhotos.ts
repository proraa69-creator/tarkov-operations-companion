import { useEffect, useState } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { prepareNoticeImage } from '../notices/imageResize'
import { QUEST_POINT_PHOTO_ID } from '../shared/questPointConstructor'
import { cleanIpcError } from '../sync/serverSync'

/**
 * Photos of the quest constructor's points (server/src/routes/questPoints.ts; owner, 16.10.2026: «возможность добавить …
 * фотографию для понимания где искать»). The owner app uploads one (scaled down like an announcement's photo,
 * src/notices/imageResize.ts); every signed-in app reads the ones the points show as base64 JSON — the gateways forward
 * JSON only — and shows them as data: URLs, read once while the app runs.
 */
const PHOTOS_KEPT = 60
const photos = new Map<string, Promise<string>>()

/** A photo as a data: URL; rejects without a session, for an unknown id, or when the server is unreachable. */
export function questPointPhotoUrl(id: string): Promise<string> {
  if (!QUEST_POINT_PHOTO_ID.test(id)) return Promise.reject(new Error('Фото не найдено'))
  const known = photos.get(id)
  if (known) return known
  const loading = (async () => {
    const request = serviceClient()
    if (!request) throw new Error('Нет связи с сервером')
    const answer = await request('GET', `/v1/me/quest-point-photos/${id}`) as { mime?: unknown; data?: unknown } | null
    if (!answer || typeof answer.data !== 'string' || typeof answer.mime !== 'string' || !/^image\/(?:png|jpeg|webp)$/.test(answer.mime)) throw new Error('Фото не найдено')
    return `data:${answer.mime};base64,${answer.data}`
  })()
  photos.set(id, loading)
  loading.catch(() => { if (photos.get(id) === loading) photos.delete(id) })
  while (photos.size > PHOTOS_KEPT) photos.delete(photos.keys().next().value!)
  return loading
}

/** The photo's data URL once loaded ('' while loading, `failed` when it could not be read). */
export function useQuestPointPhoto(id: string) {
  const [state, setState] = useState<{ id: string; url: string; failed: boolean }>({ id, url: '', failed: false })
  useEffect(() => {
    let live = true
    questPointPhotoUrl(id).then(
      (url) => { if (live) setState({ id, url, failed: false }) },
      () => { if (live) setState({ id, url: '', failed: true }) },
    )
    return () => { live = false }
  }, [id])
  return state.id === id ? state : { id, url: '', failed: false }
}

/**
 * Owner app: uploads one picked file and returns the new photo's id; the photo is shown at once from what was sent. Throws
 * with the reason (another type, over 5 MB, no server, the storage is full…).
 */
export async function uploadQuestPointPhoto(file: File): Promise<string> {
  const prepared = await prepareNoticeImage(file)
  const request = serviceClient()
  if (!request) throw new Error('Нет связи с сервером')
  let answer: { photo?: { id?: unknown } } | null
  try {
    answer = await request('POST', '/v1/accounts/me/admin/quest-point-photos', { data: prepared.data }) as { photo?: { id?: unknown } } | null
  } catch (reason) {
    throw new Error(cleanIpcError(reason) || 'Сервер недоступен', { cause: reason })
  }
  const id = answer?.photo?.id
  if (typeof id !== 'string' || !QUEST_POINT_PHOTO_ID.test(id)) throw new Error('Сервер не принял фото')
  photos.set(id, Promise.resolve(prepared.preview))
  return id
}
