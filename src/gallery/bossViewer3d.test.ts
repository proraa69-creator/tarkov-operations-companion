import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// three.js and the physics stand in with just enough to mount the viewer: what is tested is when it draws.
const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock('three', () => {
  class Vec { x = 0; y = 0; z = 0; set() { return this } copy() { return this } applyQuaternion() { return this } applyMatrix4() { return this } fromBufferAttribute() { return this } }
  class Node {
    children: Node[] = []; position = new Vec(); quaternion = { copy() {} }; scale = { setScalar() {}, copy() {} }; rotation = { y: 0, z: 0 }
    add(child: Node) { this.children.push(child) }
    remove() {}
    updateMatrixWorld() {}
    traverse() {}
    lookAt() {}
  }
  return {
    WebGLRenderer: class { setPixelRatio() {} setClearColor() {} setSize() {} render() { renders.count += 1 } dispose() {} forceContextLoss() {} },
    Scene: Node, Group: Node,
    PerspectiveCamera: class extends Node { aspect = 1; updateProjectionMatrix() {} },
    Vector3: Vec,
    Quaternion: class { invert() { return this } },
    Box3: class { min = new Vec(); setFromObject() { return this } getSize(v: Vec) { return v } getCenter(v: Vec) { return v } },
  }
})
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { load() {} } }))
vi.mock('./bossLook', () => ({ applyBossLighting: () => () => {}, gradeBossMaterial: () => {} }))
vi.mock('./physics/rig', () => ({ rigFromMesh: () => null }))
vi.mock('./physics/rig.worker?worker&inline', () => ({ default: class { onmessage = null; onerror = null; postMessage() {} terminate() {} } }))
vi.mock('./physics/sim', () => ({ BossPhysics: class {} }))
vi.mock('./physics/skin', () => ({ PhysicsMesh: class {} }))

describe('3D boss viewer: «Автоповорот» only while the window is in use', () => {
  let focus: ReturnType<typeof vi.spyOn>
  let showCanvas: ((visible: boolean) => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] })
    focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    renders.count = 0
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { showCanvas = (visible) => callback([{ isIntersecting: visible }]) }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const framesIn = (ms: number) => { const before = renders.count; vi.advanceTimersByTime(ms); return renders.count - before }
  const toGame = () => { focus.mockReturnValue(false); window.dispatchEvent(new Event('blur')); vi.advanceTimersByTime(1) }
  const backToApp = () => { focus.mockReturnValue(true); window.dispatchEvent(new Event('focus')) }

  async function spinningViewer(followActivity: boolean) {
    const { mountBossViewer } = await import('./bossViewer3d')
    const viewer = mountBossViewer(document.createElement('canvas'), { reduced: false, followActivity })
    showCanvas?.(true)
    viewer.setSpin(true)
    vi.advanceTimersByTime(500)
    return viewer
  }

  it('spins at about 30 frames a second, waking about as often, and stops while the game is in front', async () => {
    const viewer = await spinningViewer(true)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const frames = framesIn(1000)
    expect(frames).toBeGreaterThanOrEqual(27)
    expect(frames).toBeLessThanOrEqual(33)
    // Not woken on every display frame only to skip half of them.
    expect(raf.mock.calls.length).toBeLessThanOrEqual(frames + 2)

    toGame()
    expect(framesIn(60_000)).toBe(0)

    backToApp()
    expect(framesIn(1000)).toBeGreaterThanOrEqual(27)
    viewer.dispose()
    expect(framesIn(1000)).toBe(0)
  })

  it('a minimized window stops it too; the phone and the browser follow visibility only', async () => {
    const viewer = await spinningViewer(false)
    toGame()
    expect(framesIn(1000)).toBeGreaterThanOrEqual(27)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(framesIn(5000)).toBe(0)
    hidden.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(framesIn(1000)).toBeGreaterThanOrEqual(27)
    viewer.dispose()
  })
})
