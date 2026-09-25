import { describe, expect, it } from 'vitest'
import { createModeProgress } from '../domain/progress'
import type { Quest } from '../domain/types'
import { withInferredPrerequisites } from './progressInference'

const quest = (id: string, requirement?: string): Quest => ({
  id, name: id, trader: 'Prapor', level: 1, kappa: true, description: '', objectives: [], rewards: [],
  requirements: requirement ? [{ taskId: requirement, allowedStatuses: ['complete'] }] : [],
})

describe('quest prerequisite inference', () => {
  it('infers only the required predecessor chain', () => {
    const progress = createModeProgress()
    progress.taskProgress.third = { taskId: 'third', status: 'completed', source: 'eft-log', updatedAt: '2026-09-26T00:00:00.000Z' }
    const inferred = withInferredPrerequisites([quest('first'), quest('second', 'first'), quest('third', 'second'), quest('other')], progress)
    expect(inferred.taskProgress.first).toMatchObject({ status: 'completed', source: 'inferred', inferredFromTaskId: 'third' })
    expect(inferred.taskProgress.second).toMatchObject({ status: 'completed', source: 'inferred' })
    expect(inferred.taskProgress.other).toBeUndefined()
  })
})
