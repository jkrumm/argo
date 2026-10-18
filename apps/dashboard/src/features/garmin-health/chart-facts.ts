import type { ChartFact } from 'basalt-ui/charts'
import type { Fact } from './model'

/**
 * A `Fact` as the `ChartCard` `facts` shape: the context folds into the period line. `ChartFact`
 * renders `unit` and `period` run together, so the period leads with its own `· ` (the astro
 * headline's workaround; UPSTREAM: a separator between `unit` and `period`).
 */
export const toChartFact = (fact: Fact): ChartFact => ({
  value: fact.value,
  unit: fact.unit,
  period: fact.context.length === 0 ? '' : `· ${fact.context.join(' · ')}`,
})
