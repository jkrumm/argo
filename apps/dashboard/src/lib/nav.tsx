/**
 * nav.tsx — Argo's single navigation definition. Every surface that needs to reach a page reads
 * THIS: the sidebar and the mobile bar (`useNav(NAV)` in `routes/__root.tsx`), the Spotlight
 * "Go to …" commands (`flattenNav(NAV)` in `lib/commands.tsx`), and the `/` redirect
 * (`navTarget(NAV, 'garmin')` in `routes/index.tsx`). A destination and its default search params
 * are stated once, here, and nowhere else.
 *
 * LEAF MODULE BY CONTRACT: it imports `@tanstack/react-router`, `basalt-ui/router-tanstack`,
 * icons and `date-fns` — and NOTHING from this app. In particular never `routeTree.gen` or
 * `routes/__root.tsx`, because `lib/commands.tsx` imports this file and also imports
 * `lib/router.ts` → the generated route tree → `__root.tsx`; an edge back from here would close
 * exactly the cycle `commands.tsx`'s own header documents.
 *
 * `linkOptions` gives each `link` TanStack's full checking of `to` / `search` / `params`, and the
 * nav metadata (id, label, short, icon, mobile placement) rides OUTSIDE it in sibling keys — so a
 * typo in either half is a compile error and `navTarget(NAV, id)` returns the precise, spreadable
 * link options for that one id.
 *
 * ONE THING TYPESCRIPT DOES NOT CATCH (read before editing a `search`): argo's routes declare
 * `validateSearch: (raw: Record<string, unknown>) => T`, which makes every search key optional on
 * the INPUT side. Dropping a default search key here compiles clean and silently changes what the
 * page opens with — so for a HAND-WRITTEN key, diff against the route's own zod half by hand.
 *
 * Store-backed keys are the exception, and since basalt-ui 1.26.0 that is nearly all of them:
 * `lib/window-stores.ts` owns one `createSearchStore` per page, the links here pass its
 * `linkSearch` thunk BY REFERENCE, and the route hands the SAME store its `validateSearch` — so
 * the nav link and the route cannot disagree, and no fallback literal appears twice. Only a key the
 * store does not model (calendar's `date`, astro's three map params) is still written out here.
 */
import { linkOptions } from '@tanstack/react-router'
import { defineNav, navGroup } from 'basalt-ui/router-tanstack'
import {
  astroStore,
  bodyCompStore,
  calendarStore,
  garminStore,
  strengthStore,
  usageStore,
  walkingStore,
} from './window-stores'
import { format } from 'date-fns'
import {
  IconActivity,
  IconArchive,
  IconBarbell,
  IconBook,
  IconBox,
  IconBrandTeams,
  IconCalendar,
  IconChartHistogram,
  IconChecklist,
  IconCompass,
  IconHeartbeat,
  IconMessageChatbot,
  IconMoonStars,
  IconRulerMeasure,
  IconServer,
  IconShoe,
} from '@tabler/icons-react'

const ICON = 18

/**
 * The four `mobile: 'tab'` destinations are the phone-first ones: Hermes Chat (the assistant, used
 * from the phone by voice), Calendar (a daily glance, and one of the two badge-carrying rows),
 * Garmin Health (the app's landing route — `/` redirects here) and Strength Tracker (logged at the
 * gym, on the phone). Everything else is either episodic (Astro Window, Reading) or a
 * desk-and-a-big-screen surface (Usage Tracking, M365 Explorer, Body Composition, WalkingPad) and
 * lives one tap deeper under More — the same two taps they cost before this migration.
 */
export const NAV = defineNav({
  groups: [
    navGroup({ id: 'assistant', label: 'Assistant', icon: <IconMessageChatbot size={ICON} /> }, [
      {
        id: 'hermes-chat',
        label: 'Hermes Chat',
        short: 'Hermes',
        mobile: 'tab',
        icon: <IconMessageChatbot size={ICON} />,
        link: linkOptions({ to: '/hermes-chat' }),
      },
      {
        id: 'calendar',
        label: 'Calendar',
        short: 'Calendar',
        mobile: 'tab',
        icon: <IconCalendar size={ICON} />,
        // Thunk, not a literal: the Link re-evaluates it at click time, so "today" never goes
        // stale in a long-lived tab. `view` rides the store; `date` is this route's own key and
        // stays a literal, mirroring `routes/calendar.tsx`'s composed `validateSearch`.
        link: linkOptions({
          to: '/calendar',
          search: () => ({ ...calendarStore.linkSearch(), date: format(new Date(), 'yyyy-MM-dd') }),
        }),
      },
    ]),
    navGroup({ id: 'health', label: 'Health', icon: <IconHeartbeat size={ICON} /> }, [
      {
        id: 'garmin',
        label: 'Garmin Health',
        short: 'Garmin',
        mobile: 'tab',
        icon: <IconHeartbeat size={ICON} />,
        // `linkSearch`, BY REFERENCE — the store's own click-time thunk (basalt-ui 1.21.0), so
        // arriving from outside the page restores the last window instead of forcing the factory
        // default back on. A module-scope literal here would pin the fallback on every click, and
        // the fallback itself now lives only in `window-stores.ts`.
        link: linkOptions({ to: '/garmin-health', search: garminStore.linkSearch }),
      },
      {
        id: 'strength',
        label: 'Strength Tracker',
        short: 'Strength',
        mobile: 'tab',
        icon: <IconBarbell size={ICON} />,
        // `linkSearch` by reference now covers all five params: `window`/`from`/`to`, `tab` and
        // `exercises` are all fields on one store since basalt-ui 1.26.0.
        link: linkOptions({ to: '/strength-tracker', search: strengthStore.linkSearch }),
      },
      {
        id: 'body-composition',
        label: 'Body Composition',
        short: 'Body',
        icon: <IconRulerMeasure size={ICON} />,
        link: linkOptions({ to: '/body-composition', search: bodyCompStore.linkSearch }),
      },
      {
        id: 'walkingpad',
        label: 'WalkingPad',
        short: 'Walk',
        icon: <IconShoe size={ICON} />,
        link: linkOptions({ to: '/walking-pad', search: walkingStore.linkSearch }),
      },
      {
        id: 'reading',
        label: 'Reading',
        short: 'Reading',
        icon: <IconBook size={ICON} />,
        link: linkOptions({ to: '/reading' }),
      },
    ]),
    navGroup({ id: 'outdoors', label: 'Outdoors', icon: <IconCompass size={ICON} /> }, [
      {
        id: 'astro-window',
        label: 'Astro Window',
        short: 'Astro',
        icon: <IconMoonStars size={ICON} />,
        // Astro Window is the one route whose composed zod half `.transform()`s three params,
        // which makes `lp`/`wx`/`terrain` REQUIRED on the link even though `site`/`nights`/`tab`
        // now come from the store. The values below hand the route the same absent/empty input it
        // used to receive, so its own
        // normalise-don't-reject codecs resolve the LIVE defaults — `parseLpParam('')` yields
        // `DEFAULT_LP_YEAR`, `parseWeatherParam(undefined)` no layers, `parseTerrainParam(undefined)`
        // `TERRAIN_DEFAULT` (all three pinned by `features/astro-window/map-layers.test.ts`).
        // Hardcoding `lp: '2025'` here would instead pin the vintage and silently drift.
        link: linkOptions({
          to: '/astro-window',
          search: () => ({
            ...astroStore.linkSearch(),
            lp: '',
            wx: undefined,
            terrain: undefined,
          }),
        }),
      },
    ]),
    navGroup({ id: 'system', label: 'System', icon: <IconServer size={ICON} /> }, [
      {
        id: 'usage',
        label: 'Usage Tracking',
        short: 'Usage',
        icon: <IconChartHistogram size={ICON} />,
        link: linkOptions({ to: '/usage-tracking', search: usageStore.linkSearch }),
      },
      // Placeholders for pages that do not exist yet. `link` is required by the type but never
      // read: every surface short-circuits on `disabled` before it reaches the anchor, and
      // `commands.tsx` filters them out of Spotlight. They point at Usage Tracking purely so the
      // field carries a real, type-checked route rather than a fiction.
      {
        id: 'docker',
        label: 'Docker',
        icon: <IconBox size={ICON} />,
        disabled: true,
        link: linkOptions({ to: '/usage-tracking', search: usageStore.linkSearch }),
      },
      {
        id: 'monitoring',
        label: 'Monitoring',
        icon: <IconActivity size={ICON} />,
        disabled: true,
        link: linkOptions({ to: '/usage-tracking', search: usageStore.linkSearch }),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: <IconChecklist size={ICON} />,
        disabled: true,
        link: linkOptions({ to: '/usage-tracking', search: usageStore.linkSearch }),
      },
    ]),
    // No `mobile` key: the old `mobileTab: false` only suppressed a SECTION tab, which is already
    // the default now (sections opt IN via `mobile: { tab: true }`). Setting `mobile: false` here
    // would hide M365 Explorer from the phone entirely — a reachability regression.
    navGroup(
      {
        id: 'other',
        label: 'Other',
        icon: <IconArchive size={ICON} />,
        collapsible: true,
        defaultCollapsed: true,
      },
      [
        {
          id: 'm365',
          label: 'M365 Explorer',
          icon: <IconBrandTeams size={ICON} />,
          link: linkOptions({ to: '/m365-explorer' }),
        },
      ],
    ),
  ],
})
