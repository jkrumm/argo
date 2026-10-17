import type { ChartFact } from 'basalt-ui/charts'
import type { Fact } from './model'

/** A `Fact` as the `ChartCard` `facts` shape: the context folds into the period line. */
export const toChartFact = (fact: Fact): ChartFact => ({
  value: fact.value,
  unit: fact.unit,
  period: fact.context.join(' · '),
})
