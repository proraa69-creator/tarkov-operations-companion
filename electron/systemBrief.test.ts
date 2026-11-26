import { describe, expect, it } from 'vitest'
import { describeSystemBrief, SYSTEM_BRIEF_MAX } from './systemBrief'

const GB = 1024 ** 3

describe('a few words about the computer for a performance report (report 227)', () => {
  it('a laptop with two cards: both, the one the app draws with marked, the memory and the battery', () => {
    const gpuInfo = { gpuDevice: [{ vendorId: 0x8086, deviceId: 0xa7a0, active: true, driverVersion: '31.0.101.5186' }, { vendorId: 0x10de, deviceId: 0x28e0, active: false }] }
    expect(describeSystemBrief({ gpuInfo, totalMemBytes: 15.8 * GB, onBattery: true })).toBe('GPU *Intel a7a0, NVIDIA 28e0; RAM 16 GB; battery')
  })

  it('nothing known about the cards: the memory and the power alone; never longer than the field allows', () => {
    expect(describeSystemBrief({ gpuInfo: null, totalMemBytes: 8 * GB, onBattery: false })).toBe('RAM 8 GB; AC')
    const many = { gpuDevice: Array.from({ length: 9 }, () => ({ vendorId: 0xabcd, deviceId: 0x1234, active: true })) }
    expect(describeSystemBrief({ gpuInfo: many, totalMemBytes: 64 * GB, onBattery: false }).length).toBeLessThanOrEqual(SYSTEM_BRIEF_MAX)
  })

  it('carries no driver versions, names or other details of the computer', () => {
    const gpuInfo = { gpuDevice: [{ vendorId: 0x10de, deviceId: 0x2684, active: true, driverVersion: '32.0.15.6094', deviceString: 'NVIDIA GeForce RTX 4090' }], machineModelName: 'LAPTOP-SECRET' }
    const text = describeSystemBrief({ gpuInfo, totalMemBytes: 32 * GB, onBattery: false })
    expect(text).toBe('GPU *NVIDIA 2684; RAM 32 GB; AC')
    expect(text).not.toMatch(/32\.0|RTX|LAPTOP/)
  })
})
