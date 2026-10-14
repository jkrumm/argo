/** A `YYYY-MM-DD` key as local midnight. Garmin syncs in local time and the API stores the local
 * date string, so a day bucket is a LOCAL calendar day — `new Date('YYYY-MM-DD')` would parse UTC
 * and shift the bar a day west of UTC. */
export function localDay(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}
