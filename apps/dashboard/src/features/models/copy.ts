/** The page's fixed copy: what is measured, what is estimated, and how far to trust it. */
import type { Axis, YMetric } from './model'

export const ESTIMATE_NOTE =
  '≈ estimate from cost per task: good for ranking, reads 2–4× high for most models and up to 20× for input-heavy ones'

const READING =
  'The dotted line is the frontier of what is drawn: the best score for that value or less. The shaded corner is leaner than the median and scores above the median. Rings are the variants your agw routes use.'

export const PRICE_NOTE =
  'Cost is the API list price. Claude models on a Max subscription run on a quota, and no per-model quota weights are published, so the chart does not price a quota slot differently: read the cost axis as what the same work would cost on the API.'

const INDEX_INFO = `One number for how lean a variant is: cost per task (weight 0.6), time (0.3) and tokens (0.1), each against the median variant, combined as a geometric mean. 1× is the median variant, lower is leaner, and the medians come from every variant with all three measures, so a filter never moves a model. Time and tokens are estimates derived from cost, so this is not three independent measurements: it works out to token use ×1, price ×0.6 and speed ×−0.3. A variant missing any of the three has no index. ${PRICE_NOTE}`

const COST_INFO = `Dollars Artificial Analysis spent to run its Intelligence Index suite once at the model’s list prices, so a model that thinks long costs more than its token price suggests. ${PRICE_NOTE}`

const TOKENS_INFO =
  'Output tokens per task, estimated as cost per task divided by the output price. Input-heavy models read high, because their input cost is counted as output. Good for ranking models against each other, not for budgeting.'

const TIME_INFO =
  'Seconds per task, estimated as the tokens above divided by the model’s median output speed, shown in minutes. It inherits the token estimate’s error.'

export interface MetricCopy {
  /** What the y is plotted against: "Intelligence vs <against>". */
  against: string
  subtitle: string
  info: string
  /** What a variant without a value is called in the footnote: "1 variant has no speed measure". */
  lacks: string
}

export const METRIC_COPY: Record<Axis, MetricCopy> = {
  index: {
    against: 'efficiency index',
    subtitle:
      '60% cost, 30% time, 10% tokens · relative to the median variant · lower is leaner · log scale',
    info: `${INDEX_INFO} ${READING}`,
    lacks: 'efficiency index (a measure is missing)',
  },
  cost: {
    against: 'cost per task',
    subtitle: 'Cost per task is measured by Artificial Analysis · log scale',
    info: `${COST_INFO} ${READING}`,
    lacks: 'cost measure',
  },
  time: {
    against: 'time per task',
    subtitle: ESTIMATE_NOTE,
    info: `${TIME_INFO} ${READING}`,
    lacks: 'speed measure',
  },
  tokens: {
    against: 'tokens per task',
    subtitle: ESTIMATE_NOTE,
    info: `${TOKENS_INFO} ${READING}`,
    lacks: 'token estimate',
  },
}

export const SLOTS_INFO =
  'Cells on Max are moves that stay on the free Claude quota. Cells anywhere on a quota slot are a hint: they would start billing. A billed slot is a deliberate cross-lab seat, so its alternatives exclude Claude and it has no Max cell. An alternative has to score at least as high on the chart’s active score (intelligence, coding or combined) and be at most 90% of the slot’s index; the pools are every variant, so filters never change a recommendation.'

/** The y metric's name in a chart title, a tooltip and an aria label. */
export const Y_NAME: Record<YMetric, string> = {
  general: 'Intelligence',
  coding: 'Coding score',
  combined: 'Combined score',
}

/** The slots list's score column header. */
export const Y_COLUMN: Record<YMetric, string> = {
  general: 'Intel.',
  coding: 'Coding',
  combined: 'Combined',
}

export const EPOCH_ATTRIBUTION = 'Coding benchmarks: Epoch AI (epoch.ai), CC-BY 4.0'
export const EPOCH_URL = 'https://epoch.ai/data/ai-benchmarking-dashboard'

const Y_INFO: Record<YMetric, string> = {
  general:
    'Intelligence is the Artificial Analysis Intelligence Index: one general-purpose score across reasoning, knowledge and tool-use evaluations.',
  coding: `The coding score (0–100) is the mean percentile rank of a variant over the coding benchmarks Epoch AI measured for that exact model and effort (CursorBench, SWE-bench Verified, Terminal-Bench, SciCode, WebDev Arena and others). A benchmark only one variant has counts for nothing, and a variant with fewer than two benchmarks has no score and is not drawn. Ranks are among the variants of this response: compare within the page, never across days. ${EPOCH_ATTRIBUTION}.`,
  combined: `The average of two percentile ranks, intelligence and coding score, weighted 50/50. A variant with no coding score is placed by its intelligence rank alone and drawn hollow: it is never dropped and never scored as zero. ${EPOCH_ATTRIBUTION}.`,
}

const Y_SUBTITLE: Record<YMetric, string> = {
  general: '',
  coding: 'coding score from Epoch AI benchmarks',
  combined: '50% intelligence rank, 50% coding rank',
}

/** The chart's copy for an x metric and a y metric: General keeps today's wording but the title. */
export function chartCopy(axis: Axis, y: YMetric): MetricCopy & { title: string } {
  const copy = METRIC_COPY[axis]
  const subtitle = Y_SUBTITLE[y]
  return {
    ...copy,
    title: `${Y_NAME[y]} vs ${copy.against}`,
    subtitle: subtitle === '' ? copy.subtitle : `${subtitle} · ${copy.subtitle}`,
    info: `${Y_INFO[y]} ${copy.info}`,
  }
}
