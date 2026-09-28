export type Theme = 'default' | 'tactical' | 'industrial'

export const themes = {
  default: {
    name: 'Default',
    colors: {
      bg: '#0a0f0c',
      bgElevated: '#101713',
      panel: '#141d18',
      panel2: '#19241e',
      panel3: '#202d25',
      line: '#2b3a30',
      lineStrong: '#3b4d40',
      text: '#edf2ed',
      textMuted: '#97a49a',
      textDim: '#69766d',
      brass: '#c4a665',
      brassStrong: '#dfbd70',
      green: '#7fa183',
      greenSoft: '#263c2c',
      blue: '#7899a5',
      amber: '#d29b58',
      danger: '#bd6d60',
      success: '#7fa983',
    },
  },
  tactical: {
    name: 'Tactical',
    colors: {
      bg: '#0d0d0d',
      bgElevated: '#1a1a1a',
      panel: '#1f1f1f',
      panel2: '#262626',
      panel3: '#2d2d2d',
      line: '#3d3d3d',
      lineStrong: '#4d4d4d',
      text: '#e8e8e8',
      textMuted: '#999999',
      textDim: '#666666',
      brass: '#b8860b',
      brassStrong: '#daa520',
      green: '#556b2f',
      greenSoft: '#2f3f2f',
      blue: '#4169e1',
      amber: '#cd853f',
      danger: '#dc143c',
      success: '#32cd32',
    },
  },
  industrial: {
    name: 'Industrial',
    colors: {
      bg: '#1a1a1a',
      bgElevated: '#242424',
      panel: '#2d2d2d',
      panel2: '#363636',
      panel3: '#404040',
      line: '#4d4d4d',
      lineStrong: '#5d5d5d',
      text: '#f0f0f0',
      textMuted: '#a0a0a0',
      textDim: '#707070',
      brass: '#ff8c00',
      brassStrong: '#ffa500',
      green: '#228b22',
      greenSoft: '#3a5a3a',
      blue: '#4682b4',
      amber: '#ff6347',
      danger: '#ff4500',
      success: '#00cc66',
    },
  },
}

export function applyTheme(theme: Theme) {
  const colors = themes[theme].colors
  const root = document.documentElement

  root.style.setProperty('--bg', colors.bg)
  root.style.setProperty('--bg-elevated', colors.bgElevated)
  root.style.setProperty('--panel', colors.panel)
  root.style.setProperty('--panel-2', colors.panel2)
  root.style.setProperty('--panel-3', colors.panel3)
  root.style.setProperty('--line', colors.line)
  root.style.setProperty('--line-strong', colors.lineStrong)
  root.style.setProperty('--text', colors.text)
  root.style.setProperty('--text-muted', colors.textMuted)
  root.style.setProperty('--text-dim', colors.textDim)
  root.style.setProperty('--brass', colors.brass)
  root.style.setProperty('--brass-strong', colors.brassStrong)
  root.style.setProperty('--green', colors.green)
  root.style.setProperty('--green-soft', colors.greenSoft)
  root.style.setProperty('--blue', colors.blue)
  root.style.setProperty('--amber', colors.amber)
  root.style.setProperty('--danger', colors.danger)
  root.style.setProperty('--success', colors.success)
}

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem('tarkov-theme')
  if (stored === 'default' || stored === 'tactical' || stored === 'industrial') {
    return stored
  }
  return 'default'
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem('tarkov-theme', theme)
  applyTheme(theme)
}
