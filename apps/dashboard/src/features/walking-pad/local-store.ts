import { createLocalStore, field } from 'basalt-ui/state'
import { DEFAULT_WEEKLY_TARGET_KM } from './model'

export const WEEK_VIEWS = ['weeks', 'days', 'pace'] as const

/**
 * The page's device-local preferences: the weekly distance target the THIS WEEK meter and the weekly
 * chart's reference line read (a preference, so no API or DB field), the main chart's view, and
 * whether the achievements list shows every row.
 */
export const walkingLocal = createLocalStore({
  key: 'walking-pad',
  fields: {
    weeklyTargetKm: field.number({
      fallback: DEFAULT_WEEKLY_TARGET_KM,
      int: true,
      min: 1,
      max: 200,
    }),
    view: field.enum(WEEK_VIEWS, 'weeks'),
    showAllAchievements: field.boolean(false),
  },
}).labels({
  view: { weeks: 'Weeks', days: 'Days', pace: 'Pace' },
})
