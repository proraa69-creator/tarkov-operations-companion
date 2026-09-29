import { useEffect, useRef } from 'react'
import '../styles/particle-loader.css'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  opacity: number
}

const HUMAN_SILHOUETTE_POINTS = [
  // Голова (круг)
  [0.5, 0.1],
  [0.52, 0.12],
  [0.54, 0.15],
  [0.55, 0.18],
  [0.56, 0.22],
  [0.55, 0.26],
  [0.53, 0.28],
  [0.5, 0.3],
  [0.47, 0.28],
  [0.45, 0.26],
  [0.44, 0.22],
  [0.45, 0.18],
  [0.46, 0.15],
  [0.48, 0.12],
  // Туловище
  [0.48, 0.3],
  [0.52, 0.3],
  [0.52, 0.5],
  [0.48, 0.5],
  [0.46, 0.35],
  [0.54, 0.35],
  [0.46, 0.45],
  [0.54, 0.45],
  // Левая рука
  [0.48, 0.35],
  [0.42, 0.4],
  [0.38, 0.45],
  [0.36, 0.5],
  [0.38, 0.55],
  // Правая рука
  [0.52, 0.35],
  [0.58, 0.4],
  [0.62, 0.45],
  [0.64, 0.5],
  [0.62, 0.55],
  // Левая нога
  [0.46, 0.5],
  [0.45, 0.6],
  [0.44, 0.7],
  [0.44, 0.8],
  [0.45, 0.9],
  [0.47, 0.95],
  // Правая нога
  [0.54, 0.5],
  [0.55, 0.6],
  [0.56, 0.7],
  [0.56, 0.8],
  [0.55, 0.9],
  [0.53, 0.95],
]

export function ParticleLoaderScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Установить размер canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Инициализировать частицы
    const particles: Particle[] = []
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const scale = Math.min(canvas.width, canvas.height) / 2

    HUMAN_SILHOUETTE_POINTS.forEach(([x, y]) => {
      const posX = centerX + (x - 0.5) * scale
      const posY = centerY + (y - 0.5) * scale

      // Создать несколько частиц вокруг каждой точки силуэта
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: posX + (Math.random() - 0.5) * 20,
          y: posY + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          radius: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.6 + 0.4,
        })
      }
    })

    particlesRef.current = particles

    const animate = () => {
      // Очистить canvas
      ctx.fillStyle = 'rgba(15, 15, 15, 0.1)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Обновить и нарисовать частицы
      particles.forEach((particle, index) => {
        // Движение с притяжением к центру
        const dx = centerX - particle.x
        const dy = centerY - particle.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance > 300) {
          particle.vx += (dx / distance) * 0.1
          particle.vy += (dy / distance) * 0.1
        }

        // Небольшой случайный дрейф
        particle.vx += (Math.random() - 0.5) * 0.3
        particle.vy += (Math.random() - 0.5) * 0.3

        // Ограничить скорость
        const speed = Math.sqrt(particle.vx ** 2 + particle.vy ** 2)
        if (speed > 3) {
          particle.vx = (particle.vx / speed) * 3
          particle.vy = (particle.vy / speed) * 3
        }

        particle.x += particle.vx
        particle.y += particle.vy

        // Отскок от края
        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -0.8
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -0.8

        particle.x = Math.max(0, Math.min(canvas.width, particle.x))
        particle.y = Math.max(0, Math.min(canvas.height, particle.y))

        // Рисовать частицу
        ctx.fillStyle = `rgba(200, 150, 100, ${particle.opacity * 0.8})`
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  return (
    <div className="particle-loader-screen">
      <canvas ref={canvasRef} className="particle-canvas" />
      <div className="loader-content">
        <div className="loader-spinner" />
        <h2>Загружаем актуальную базу</h2>
        <p>Задания, предметы, карты и модули убежища…</p>
      </div>
    </div>
  )
}
