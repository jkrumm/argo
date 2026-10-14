# Evidence — baseline-1.41

## bundle

| Metric                                | Value   | Unit   |
| ------------------------------------- | ------- | ------ |
| app total js                          | 2329235 | B gzip |
| app total css                         | 76013   | B gzip |
| app initial load                      | 720248  | B gzip |
| route agents chunk                    | 3431    | B gzip |
| route agents beyond initial           | 8957    | B gzip |
| route astro-window chunk              | 2820    | B gzip |
| route astro-window beyond initial     | 6849    | B gzip |
| route body-composition chunk          | 5683    | B gzip |
| route body-composition beyond initial | 21554   | B gzip |
| route calendar chunk                  | 39651   | B gzip |
| route calendar beyond initial         | 41191   | B gzip |
| route charts-smoke chunk              | 167     | B gzip |
| route charts-smoke beyond initial     | 167     | B gzip |
| route garmin-health chunk             | 10733   | B gzip |
| route garmin-health beyond initial    | 33426   | B gzip |
| route hermes-chat chunk               | 296644  | B gzip |
| route hermes-chat beyond initial      | 298971  | B gzip |
| route m365-explorer chunk             | 6445    | B gzip |
| route m365-explorer beyond initial    | 6732    | B gzip |
| route reading chunk                   | 5379    | B gzip |
| route reading beyond initial          | 8343    | B gzip |
| route strength-tracker chunk          | 10446   | B gzip |
| route strength-tracker beyond initial | 33811   | B gzip |
| route usage-tracking chunk            | 7792    | B gzip |
| route usage-tracking beyond initial   | 16012   | B gzip |
| route walking-pad chunk               | 11145   | B gzip |
| route walking-pad beyond initial      | 21604   | B gzip |
| route warden chunk                    | 8303    | B gzip |
| route warden beyond initial           | 13232   | B gzip |

## screens

| Metric      | Value                            | Unit |
| ----------- | -------------------------------- | ---- |
| routes      | 13                               |      |
| screenshots | 52                               |      |
| failed      | 0                                |      |
| viewports   | desktop 1280x800, mobile 390x844 |      |

## lighthouse

| Metric                          | Value | Unit |
| ------------------------------- | ----- | ---- |
| / mobile score                  | 52    |      |
| / mobile LCP                    | 9203  | ms   |
| / mobile TBT                    | 319   | ms   |
| / mobile CLS                    | 0     |      |
| / desktop score                 | 88    |      |
| / desktop LCP                   | 1846  | ms   |
| / desktop TBT                   | 11    | ms   |
| / desktop CLS                   | 0.023 |      |
| /garmin-health mobile score     | 54    |      |
| /garmin-health mobile LCP       | 9112  | ms   |
| /garmin-health mobile TBT       | 275   | ms   |
| /garmin-health mobile CLS       | 0     |      |
| /garmin-health desktop score    | 88    |      |
| /garmin-health desktop LCP      | 1846  | ms   |
| /garmin-health desktop TBT      | 13    | ms   |
| /garmin-health desktop CLS      | 0.023 |      |
| /strength-tracker mobile score  | 54    |      |
| /strength-tracker mobile LCP    | 7404  | ms   |
| /strength-tracker mobile TBT    | 294   | ms   |
| /strength-tracker mobile CLS    | 0.003 |      |
| /strength-tracker desktop score | 91    |      |
| /strength-tracker desktop LCP   | 1516  | ms   |
| /strength-tracker desktop TBT   | 15    | ms   |
| /strength-tracker desktop CLS   | 0.006 |      |
| runs per cell (median of)       | 3     |      |

## blocked writes

Non-GET requests the app attempted, answered 405:

- `POST /api/daily-metrics/refresh`
