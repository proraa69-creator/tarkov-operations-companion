import { useSyncExternalStore } from 'react'
import { handControl } from './handControlStore'

export function useHandControl() {
  return useSyncExternalStore(handControl.subscribe, handControl.getSnapshot)
}
