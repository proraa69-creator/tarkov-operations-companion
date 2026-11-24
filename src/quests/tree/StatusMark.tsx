import { Check, Circle, Clock, Lock, X } from 'lucide-react'

/** A quest's status as a sign, the same in the tree, on the phone and in the legend. */
export function StatusMark({ status }: { status: string }) {
  return <span className="quest-tree-mark" aria-hidden="true">
    {status === 'completed' || status === 'probable' ? <Check size={12} />
      : status === 'failed' ? <X size={12} />
        : status === 'locked' ? <Lock size={10} />
          : status === 'active' ? <Clock size={11} />
            : <Circle size={8} />}
  </span>
}
