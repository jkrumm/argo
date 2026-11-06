/** The page's fixed copy: what is measured, what is estimated, and how far to trust it. */

export const ESTIMATE_NOTE =
  '≈ estimate from cost per task: good for ranking, reads 2–4× high for most models and up to 20× for input-heavy ones'

export const COST_NOTE = 'Cost per task is measured by Artificial Analysis · log scale'

export const COST_INFO =
  'Dollars Artificial Analysis spent to run its Intelligence Index suite once at the model’s list prices, so a model that thinks long costs more than its token price suggests. The dotted line is the frontier of what is drawn: the best intelligence for that money or less. The shaded corner is cheaper than the median and smarter than the median. Rings are the variants your agw routes use.'

export const TOKENS_INFO =
  'Output tokens per task, estimated as cost per task divided by the output price. Input-heavy models read high, because their input cost is counted as output. Good for ranking models against each other, not for budgeting.'

export const TIME_INFO =
  'Seconds per task, estimated as the tokens above divided by the model’s median output speed, shown in minutes. It inherits the token estimate’s error.'

export const SLOTS_INFO =
  'Your agent-workflows routes, grouped by model and effort. The verdict compares the slot with the other callable variants you can see: beaten means one has clearly more intelligence for about the same money, or somewhat more for half of it. A route on a Claude quota does not bill the listed dollars, so there the verdict is a hint about quality per list dollar, not a bill.'

export const QUOTA_NOTE = 'On a quota: the listed dollars are not billed, so read this as a hint.'

export const CATALOG_NOTE =
  'One row per model, current ones. Cost, tokens and time are those of its top effort; open a row for the whole ladder.'
