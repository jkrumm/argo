/** The page's fixed copy: what is measured, what is estimated, and how far to trust it. */
import type { Axis } from './model'

export const ESTIMATE_NOTE =
  '≈ estimate from cost per task: good for ranking, reads 2–4× high for most models and up to 20× for input-heavy ones'

const READING =
  'The dotted line is the frontier of what is drawn: the best intelligence for that value or less. The shaded corner is leaner than the median and smarter than the median. Rings are the variants your agw routes use.'

const INDEX_INFO =
  'One number for how lean a variant is: cost per task (weight 0.6), time (0.3) and tokens (0.1), each against the median variant, combined as a geometric mean. 1× is the median variant, lower is leaner, and the medians come from every variant with all three measures, so a filter never moves a model. Time and tokens are estimates derived from cost, so this is not three independent measurements: it works out to token use ×1, price ×0.6 and speed ×−0.3. A variant missing any of the three has no index.'

const COST_INFO =
  'Dollars Artificial Analysis spent to run its Intelligence Index suite once at the model’s list prices, so a model that thinks long costs more than its token price suggests.'

const TOKENS_INFO =
  'Output tokens per task, estimated as cost per task divided by the output price. Input-heavy models read high, because their input cost is counted as output. Good for ranking models against each other, not for budgeting.'

const TIME_INFO =
  'Seconds per task, estimated as the tokens above divided by the model’s median output speed, shown in minutes. It inherits the token estimate’s error.'

export interface MetricCopy {
  title: string
  subtitle: string
  info: string
  /** What a variant without a value is called in the footnote: "1 variant has no speed measure". */
  lacks: string
}

export const METRIC_COPY: Record<Axis, MetricCopy> = {
  index: {
    title: 'Intelligence vs efficiency index',
    subtitle:
      '60% cost, 30% time, 10% tokens · relative to the median variant · lower is leaner · log scale',
    info: `${INDEX_INFO} ${READING}`,
    lacks: 'efficiency index (a measure is missing)',
  },
  cost: {
    title: 'Intelligence vs cost per task',
    subtitle: 'Cost per task is measured by Artificial Analysis · log scale',
    info: `${COST_INFO} ${READING}`,
    lacks: 'cost measure',
  },
  time: {
    title: 'Intelligence vs time per task',
    subtitle: ESTIMATE_NOTE,
    info: `${TIME_INFO} ${READING}`,
    lacks: 'speed measure',
  },
  tokens: {
    title: 'Intelligence vs tokens per task',
    subtitle: ESTIMATE_NOTE,
    info: `${TOKENS_INFO} ${READING}`,
    lacks: 'token estimate',
  },
}

export const SLOTS_INFO =
  'Cells on Max are moves that stay on the free Claude quota. Cells anywhere on a quota slot are a hint: they would start billing. A billed slot is a deliberate cross-lab seat, so its alternatives exclude Claude and it has no Max cell. An alternative has to be at least as intelligent and at most 90% of the slot’s index; the pools are every variant, so filters never change a recommendation.'
