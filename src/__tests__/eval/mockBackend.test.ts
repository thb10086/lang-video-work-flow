import { describe, it, expect, afterEach } from 'vitest'
import { backendApi } from '@/api/backend'
import { MockBackendController } from './mockBackend'

describe('MockBackendController', () => {
  let dispose: (() => void) | null = null

  afterEach(() => {
    if (dispose) {
      dispose()
      dispose = null
    }
  })

  it('restores original methods after dispose', async () => {
    const originalGenerate = backendApi.generateImage
    const ctrl = new MockBackendController()
    dispose = ctrl.install()
    expect(backendApi.generateImage).not.toBe(originalGenerate)
    dispose()
    dispose = null
    expect(backendApi.generateImage).toBe(originalGenerate)
  })

  it('returns default image response when no config provided', async () => {
    const ctrl = new MockBackendController()
    dispose = ctrl.install()
    const res = await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    expect(res.images).toHaveLength(1)
    expect(res.images[0].url).toMatch(/^mock:/)
  })

  it('applies failFirstNCalls then succeeds', async () => {
    const ctrl = new MockBackendController({
      image: { failFirstNCalls: 2, response: { images: [{ url: 'mock://ok.png' }] } },
    })
    dispose = ctrl.install()
    await expect(backendApi.generateImage({ model_id: 'x', prompt: 'y' })).rejects.toThrow(/simulated failure/)
    await expect(backendApi.generateImage({ model_id: 'x', prompt: 'y' })).rejects.toThrow(/simulated failure/)
    const res = await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    expect(res.images[0].url).toBe('mock://ok.png')
  })

  it('honours latencyMs', async () => {
    const ctrl = new MockBackendController({
      image: { latencyMs: 50 },
    })
    dispose = ctrl.install()
    const t0 = Date.now()
    await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow some jitter
  })

  it('customResponse overrides static response', async () => {
    const ctrl = new MockBackendController({
      image: {
        response: { images: [{ url: 'mock://static.png' }] },
        customResponse: async (i) => ({ images: [{ url: `mock://custom-${i}.png` }] }),
      },
    })
    dispose = ctrl.install()
    const a = await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    const b = await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    expect(a.images[0].url).toBe('mock://custom-0.png')
    expect(b.images[0].url).toBe('mock://custom-1.png')
  })

  it('video submission returns task_id + status', async () => {
    const ctrl = new MockBackendController({
      video: { response: { task_id: 't_99', status: 'succeeded', output_url: 'mock://v.mp4' } },
    })
    dispose = ctrl.install()
    const res = await backendApi.submitVideo({ model_id: 'm', prompt: 'p' })
    expect(res.task_id).toBe('t_99')
    expect(res.status).toBe('succeeded')
  })

  it('queryTask mirrors video response', async () => {
    const ctrl = new MockBackendController({
      video: { response: { task_id: 't_x', status: 'running' } },
    })
    dispose = ctrl.install()
    const res = await backendApi.queryTask('t_x')
    expect(res.task_id).toBe('t_x')
    expect(res.status).toBe('running')
  })

  it('tracks call counts per service', async () => {
    const ctrl = new MockBackendController()
    dispose = ctrl.install()
    await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    await backendApi.generateImage({ model_id: 'x', prompt: 'y' })
    await backendApi.submitVideo({ model_id: 'm', prompt: 'p' })
    expect(ctrl.getCallCount('image')).toBe(2)
    expect(ctrl.getCallCount('video')).toBe(1)
  })

  it('throws if installed twice without disposing', () => {
    const ctrl = new MockBackendController()
    dispose = ctrl.install()
    expect(() => ctrl.install()).toThrow(/already installed/)
  })
})
