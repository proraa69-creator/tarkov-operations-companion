import { formatMoney } from '../plans'

/** Under the price of a longer plan (plans.ts planSaving): «вместо 3 600 ₽» and «экономия 1 200 ₽». */
export function PlanSaving({ full, saving, currency }: { full: number; saving: number; currency: string }) {
  return (
    <div className="plan-saving">
      <span>вместо <s>{formatMoney(full, currency)}</s></span>
      <strong>экономия {formatMoney(saving, currency)}</strong>
    </div>
  )
}
