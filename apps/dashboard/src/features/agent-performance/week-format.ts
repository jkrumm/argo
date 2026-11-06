/** `3 Nov`: a week's Monday on a chart axis (UTC, like the week keys). */
export const WEEK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
