import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="container page page-in">
      <div className="panel center-state">
        <Compass aria-hidden="true" />
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 26 }}>Страница не найдена</h1>
          <p style={{ margin: 0 }}>Похоже, эта точка не отмечена на карте.</p>
        </div>
        <Link to="/" className="button primary">На главную</Link>
      </div>
    </div>
  )
}
