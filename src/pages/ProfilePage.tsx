import { useRef, useState } from 'react'
import { Check, Plus, Save, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { migrateProfile } from '../domain/progress'
import { useAppState } from '../state/AppState'

export function ProfilePage() {
  const state = useAppState()
  const upload = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [notice, setNotice] = useState('')
  const progress = state.activeProfile.modes[state.raidMode]
  const completed = Object.values(progress.taskProgress).filter((record) => record.status === 'completed').length

  const saveBackup = async () => {
    const json = JSON.stringify(state.activeProfile, null, 2)
    if (window.tarkovDesktop) {
      if (await window.tarkovDesktop.saveProfileBackup(json)) setNotice('Резервная копия сохранена')
      return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    link.download = 'tarkov-operations-profile.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const restoreJson = (json: string) => {
    try {
      const profile = migrateProfile(JSON.parse(json))
      if (!profile) throw new Error('invalid')
      state.replaceActiveProfile({ ...profile, id: state.activeProfile.id, updatedAt: new Date().toISOString() })
      setNotice('Профиль восстановлен')
    } catch { setNotice('Файл не похож на резервную копию профиля') }
  }

  const openBackup = async () => {
    if (window.tarkovDesktop) {
      const json = await window.tarkovDesktop.openProfileBackup()
      if (json) restoreJson(json)
    } else upload.current?.click()
  }

  return <div className="page"><header className="page-header"><div><div className="eyebrow">Локальная учётная запись</div><h1 className="page-title">Профиль оператора</h1><p className="page-subtitle">Профили хранятся только на этом компьютере. PvP и PvE никогда не смешиваются.</p></div><span className="tag green"><ShieldCheck size={12} /> локальное хранение</span></header>
    {notice && <div className="panel profile-notice"><Check size={15} /> {notice}</div>}
    <div className="settings-grid">
      <section className="panel profile-hero"><div className="profile-avatar"><UserRound size={30} /></div><div><div className="eyebrow">Текущий профиль</div><h2>{state.activeProfile.displayName}</h2><p>{state.raidMode.toUpperCase()} · уровень {progress.playerLevel} · {completed} заданий выполнено</p></div></section>
      <section className="panel"><div className="panel-header"><div className="panel-title">Персонаж</div></div><div className="panel-body"><label className="field-label">Имя профиля<input className="input" value={state.activeProfile.displayName} onChange={(event) => state.renameProfile(event.target.value)} /></label><label className="field-label">Уровень игрока<input className="input" type="number" min="1" max="79" value={progress.playerLevel} onChange={(event) => state.setPlayerLevel(Number(event.target.value))} /></label><div className="field-label">Режим<div className="mode-switch wide"><button className={state.raidMode === 'pvp' ? 'active' : ''} onClick={() => state.setRaidMode('pvp')}>PvP</button><button className={state.raidMode === 'pve' ? 'active' : ''} onClick={() => state.setRaidMode('pve')}>PvE</button></div></div></div></section>
      <section className="panel"><div className="panel-header"><div className="panel-title">Другие профили</div></div><div className="panel-body stack">{state.profiles.map((profile) => <button key={profile.id} className={`profile-choice ${profile.id === state.activeProfile.id ? 'active' : ''}`} onClick={() => state.selectProfile(profile.id)}><UserRound size={16} /><span><strong>{profile.displayName}</strong><small>изменён {new Date(profile.updatedAt).toLocaleDateString('ru-RU')}</small></span>{profile.id === state.activeProfile.id && <Check size={15} />}</button>)}<div className="profile-create"><input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Новый оператор" /><button className="button" onClick={() => { if (newName.trim()) { state.createProfile(newName); setNewName('') } }}><Plus size={15} /> Создать</button></div></div></section>
      <section className="panel"><div className="panel-header"><div className="panel-title">Перенос и восстановление</div></div><div className="panel-body stack"><button className="button" onClick={() => void saveBackup()}><Save size={15} /> Создать резервную копию</button><button className="button ghost" onClick={() => void openBackup()}><Upload size={15} /> Восстановить из файла</button><p className="muted">В копию входят оба режима, задания, уровень, избранное и настройки профиля. Журналы игры не включаются.</p><input ref={upload} hidden type="file" accept=".json" onChange={async (event) => { const file = event.target.files?.[0]; if (file) restoreJson(await file.text()) }} /></div></section>
    </div>
  </div>
}
