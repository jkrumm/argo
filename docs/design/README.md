# argo page concepts — the redesign loop

One concept per page, written in Wave 18 (2026-10-17) against live-data baseline shots and the Keel
reference (`docs/waves/PLAN.md` Part 2). Each concept states the user's question, the decision the page
supports, each dataset's shape and its chosen encoding, the copy, and checkable pass criteria. The rounds'
verdicts are appended to the page's doc by the wave that builds it. Shared patterns: `UPSTREAM.md`.

Shots live only in the gitignored `.design-shots/` (`make design-shot`); the baseline is
`.design-shots/baseline/`. Never commit an image.

## Ranking — distance from the bar

The score is 1–5, where 5 is furthest from Keel. Rows are sorted by score. Within a score the order is
editorial: the owner's named examples (Garmin Health, Agents, Warden, Calendar) and the pages they
feed (Home) first.

| Rank | Page                                    | Distance | Why                                                                                                                                                 | Wave |
| ---- | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1    | [Warden](warden.md)                     | 5        | Rows of four or five stacked buttons, tile footers that dump raw keys (`numerator: {n} …`), and every item listed twice across seven stacked tables | 20   |
| 2    | [Home `/`](home.md)                     | 5        | It does not exist: `/` redirects to Garmin Health                                                                                                   | 21   |
| 3    | [Calendar](calendar.md)                 | 5        | A 1,500 px week grid that is almost all empty hours. No summary, and attendees and video links are dropped                                          | 21   |
| 4    | [WalkingPad](walking-pad.md)            | 5        | The default 30-day window is empty (the last walk is more than 30 days old): nine zero or dash tiles and five empty chart cards                     | 22   |
| 5    | [M365 Explorer](m365-explorer.md)       | 5        | An intro paragraph that narrates the page, an empty right half at 1440, and {n_chats} rows in one 3,000 px column                                   | 23   |
| 6    | [Garmin Health](garmin-health.md)       | 4        | KPI boxes with a coloured left edge and bare numbers ("HRV {hrv_ms}" with no scale), eight filler-question subtitles, and no page summary           | 19   |
| 7    | [Agents](agents.md)                     | 4        | A {n_agents}-row table that repeats projects, a human queue of raw paragraphs, and no encoding fitted to the data                                   | 20   |
| 8    | [Body Composition](body-composition.md) | 4        | Two rows of six tiles and tall entry forms around one good weight line; empty skinfold blocks fill about 45 % of the page                           | 22   |
| 9    | [Usage Tracking](usage-tracking.md)     | 4        | Bare-number hero cards, and a token-chart legend of {n_series} entries that fills roughly 2,000 px                                                  | 22   |
| 10   | [Reading](reading.md)                   | 4        | Five tiles of bare counts, then {n_books} identical cover cards, {n_backlog} of them the backlog                                                    | 22   |
| 11   | [Strength Tracker](strength-tracker.md) | 3        | The analytics are well shaped. Filler subtitles, four per-lift cards of bare numbers, and no verdict at the top                                     | 22   |
| 12   | [Astro Window](astro-window.md)         | 3        | The Forecast tab and the engine are good. The Tonight tab is a 20-row facts table with ten identical OUT cells                                      | 23   |

The wave order in `PLAN.md` stays as planned and overrides rank: it groups pages by shared patterns. Wave 19's Garmin
Health is where `Meter`, the strip and the chart facts header are first proven, and Wave 20 proves the
decision card and `Board`. That order outweighs strict rank.

## One form for a repeated gap (settled Wave 35)

When one gap shows on several surfaces of one screen, its **full sentence** (what is missing, why, the next step) appears
**once**, on the screen's leading surface: the page alert or headline if there is one, else the first card in reading order.
Every other surface carries the **short form**, which is the full sentence's leading clause, verbatim and with no cause or step
(`No usage ingested`, `No chats came back`). A short form names the same gap in the same words, so a reader matches it to the
sentence without reading it twice. This is Calendar's rule: the headline carries the step, and each card carries the sentence
without it. A surface never shows both forms. A cell too small for the short form takes the short form anyway, never a bare `—`.
A surface whose gap differs (a filter that matched nothing, one failed source) is a different gap, and it gets its own sentence.
