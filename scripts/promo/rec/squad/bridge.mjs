// A signed-in desktop shell for the «Отряд» scene: the account, two friends and a squad answered by a stand-in for the
// server (names and ids are made up; the quests are real tarkov.dev ids from the seeded profile). Everything not listed
// answers null / no-op, like an offline service.
const H = (n) => n.toString(16).padStart(24, '0')
const MINE = ['597a160786f77477531d39d2', '597a171586f77405ba6887d3', '5b4795fb86f7745876267770', '675c085d59b0575973005f52', '5979eee086f774311955e614', '59c124d686f774189b3c843f', '665eec4a4dfc83b0ed0a9dca', '666314c3acf8442f8b0531a3', '5a27b75b86f7742e97191958', '5ac346cf86f7741d63233a02', '639136fa9444fb141f4e6eee', '65734c186dc1e402c80dc19e', '671a49f77d49aea42c029b5f', '6179ac7511973d018217d0b9', '5ac2426c86f774138762edfe']
export const SQUAD = {
  id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  me: { memberId: H(1), nickname: 'Operator', activeQuestIds: MINE, completedCount: 86 },
  friends: [
    { memberId: H(2), nickname: 'Wolfhound', activeQuestIds: ['597a171586f77405ba6887d3', '5b4795fb86f7745876267770', '59c124d686f774189b3c843f', '665eec4a4dfc83b0ed0a9dca', '66ab970848ddbe9d4a0c49a8', '5ac346cf86f7741d63233a02'], completedCount: 74 },
    { memberId: H(3), nickname: 'Nightowl_7', activeQuestIds: ['597a171586f77405ba6887d3', '675c085d59b0575973005f52', '59c124d686f774189b3c843f', '666314c3acf8442f8b0531a3', '5a27b75b86f7742e97191958'], completedCount: 61 },
  ],
}

export function squadBridge({ squadName }) {
  return `(() => {
  const S = ${JSON.stringify(SQUAD)}
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
  const member = (m, i, you) => ({ ...m, isYou: you, isOwner: you, joinedAt: ago(4000 - i * 300), lastSyncAt: ago(2 + i * 3) })
  const info = () => ({ id: S.id, name: ${JSON.stringify(squadName)}, maxMembers: 5, isOwner: true, createdAt: ago(5000), members: [member(S.me, 0, true), ...S.friends.map((f, i) => member(f, i + 1, false))] })
  const friends = S.friends.map((f, i) => ({ friendId: f.memberId, nicknames: { pvp: f.nickname, pve: f.nickname, seasonal: f.nickname }, since: ago(20000 + i * 9000), hideMyProgress: false, sharesProgress: true }))
  const outgoing = []
  const account = { signedIn: true, email: 'operator@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true,
    nicknames: { pvp: 'Operator', pve: 'Operator', seasonal: 'Operator' }, subscription: { status: 'active', plan: 'month', expiresAt: ago(-60 * 24 * 23) },
    entitlement: { valid: true, plan: 'paid', expiresAt: ago(-60 * 24 * 23) }, createdAt: '2026-03-02T10:00:00.000Z', emailVerified: true }
  const serviceRequest = async (method, path, body) => {
    if (/^\\/v1\\/squads\\/mine\\//.test(path)) return { squad: info(), access: true, invitations: [] }
    if (/^\\/v1\\/squads\\/[a-f0-9]{32}\\/overview\\//.test(path)) {
      const members = info().members
      const count = new Map()
      for (const m of members) for (const q of m.activeQuestIds) count.set(q, [...(count.get(q) ?? []), m.memberId])
      const sharedQuests = [...count].filter(([, ids]) => ids.length > 1).map(([questId, memberIds]) => ({ questId, memberIds }))
      return { squad: info(), mode: 'pvp', generatedAt: new Date().toISOString(), sharedQuests }
    }
    if (path === '/v1/friends' && method === 'GET') return { code: 'K7QM-2XWD', access: true, friends, incoming: [], outgoing, blocked: [] }
    if (path === '/v1/friends/requests' && method === 'POST') {
      outgoing.push({ requestId: 'b'.repeat(23) + String(outgoing.length + 1), label: body?.nickname ?? body?.code ?? '', createdAt: new Date().toISOString() })
      return { status: 'sent' }
    }
    if (/^\\/v1\\/friends\\/progress\\//.test(path)) {
      return { people: [{ id: 'me', nickname: S.me.nickname, hidden: false, isYou: true, activeQuestIds: S.me.activeQuestIds, objectives: {}, completedCount: S.me.completedCount, lastSyncAt: ago(1) },
        ...S.friends.map((f, i) => ({ id: f.memberId, nickname: f.nickname, hidden: false, activeQuestIds: f.activeQuestIds, objectives: {}, completedCount: f.completedCount, lastSyncAt: ago(3 + i * 4) }))] }
    }
    if (/^\\/v1\\/friends\\/needs\\//.test(path)) return { itemIds: [], questIds: [], byItem: {}, byQuest: {} }
    if (/^\\/v1\\/friends\\/[a-f0-9]{24}\\/info$/.test(path)) return { nickname: 'Wolfhound', hidden: false, modes: { pvp: { level: 34, prestige: 1, updatedAt: ago(5) }, pve: { level: 18, prestige: 0, updatedAt: ago(900) }, seasonal: null } }
    if (path === '/v1/bug-reports' && method === 'POST') return { id: 'c'.repeat(24), status: 'received' }
    if (/^\\/v1\\/accounts\\/me/.test(path)) return { email: account.email, kind: 'user', nicknames: account.nicknames, subscription: account.subscription, createdAt: account.createdAt }
    return null
  }
  let updateState = { state: 'idle' }
  const updateListeners = []
  window.__update = (next) => { updateState = next; for (const cb of updateListeners) cb(next) }
  const deep = () => new Proxy(function () {}, {
    get: (_t, prop) => prop === 'then' ? undefined : (typeof prop === 'string' && prop.startsWith('on') ? () => () => {} : deep()),
    apply: () => Promise.resolve(null),
  })
  const target = {
    account: { status: async () => account, websiteUrl: async () => 'https://raidos.app', onStatus: () => () => {} },
    update: { status: async () => updateState, onStatus: (cb) => { updateListeners.push(cb); return () => {} }, install: async () => updateState },
    getVersion: async () => '0.6.0.26',
    getRaidState: async () => ({ inRaid: false }),
    serviceRequest,
  }
  window.tarkovDesktop = new Proxy(target, { get: (t, p) => (p in t ? t[p] : (p === 'then' ? undefined : typeof p === 'string' && p.startsWith('on') ? () => () => {} : deep())) })
})()`
}
