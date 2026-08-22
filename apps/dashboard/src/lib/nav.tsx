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
 * page opens with. Diff against the route's own zod `SearchSchema` defaults by hand.
 *
 * The `window` key is the exception: it is no longer stated twice. `lib/window-stores.ts` owns it,
 * and both this file's click-time thunk and the route's `validateSearch` read the SAME
 * `readStored()`, so the nav link and the route cannot disagree about what the page opens with.
 */
import { linkOptions } from '@tanstack/react-router'
import { defineNav, navGroup } from 'basalt-ui/router-tanstack'
import { bodyCompWindowStore, garminWindowStore, strengthWindowStore } from './window-stores'
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
        // stale in a long-lived tab. Mirrors `routes/calendar.tsx`'s `date` default.
        link: linkOptions({
          to: '/calendar',
          search: () => ({ view: 'week', date: format(new Date(), 'yyyy-MM-dd') }),
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
        // Thunk, not a literal: re-evaluated at click time so arriving from outside the page
        // restores the last window rather than forcing the factory default back on. The store
        // IS the default — `readStored()` here and in the route's `validateSearch` are one source.
        link: linkOptions({
          to: '/garmin-health',
          search: () => ({ window: garminWindowStore.readStored() ?? '30d' }),
        }),
      },
      {
        id: 'strength',
        label: 'Strength Tracker',
        short: 'Strength',
        mobile: 'tab',
        icon: <IconBarbell size={ICON} />,
        link: linkOptions({
          to: '/strength-tracker',
          search: () => ({
            window: strengthWindowStore.readStored() ?? 'all',
            tab: 'charts',
            exercises: 'bench_press,deadlift,squat,pull_ups',
          }),
        }),
      },
      {
        id: 'body-composition',
        label: 'Body Composition',
        short: 'Body',
        icon: <IconRulerMeasure size={ICON} />,
        link: linkOptions({
          to: '/body-composition',
          search: () => ({ window: bodyCompWindowStore.readStored() ?? '90d' }),
        }),
      },
      {
        id: 'walkingpad',
        label: 'WalkingPad',
        short: 'Walk',
        icon: <IconShoe size={ICON} />,
        link: linkOptions({ to: '/walking-pad', search: { window: '30d' } }),
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
        // Astro Window is the one route whose zod schema `.transform()`s three params, which makes
        // `tab`/`lp`/`wx`/`terrain` REQUIRED on the link (the old untyped `NAV_TARGETS` table
        // passed only `site` + `nights` and let the schema fill the rest). The values below hand
        // the route the same absent/empty input it used to receive, so its own
        // normalise-don't-reject codecs resolve the LIVE defaults — `parseLpParam('')` yields
        // `DEFAULT_LP_YEAR`, `parseWeatherParam(undefined)` no layers, `parseTerrainParam(undefined)`
        // `TERRAIN_DEFAULT` (all three pinned by `features/astro-window/map-layers.test.ts`).
        // Hardcoding `lp: '2025'` here would instead pin the vintage and silently drift.
        link: linkOptions({
          to: '/astro-window',
          search: {
            site: 'alpenvorland',
            nights: 10,
            tab: 'tonight',
            lp: '',
            wx: undefined,
            terrain: undefined,
          },
        }),
      },
    ]),
    navGroup({ id: 'system', label: 'System', icon: <IconServer size={ICON} /> }, [
      {
        id: 'usage',
        label: 'Usage Tracking',
        short: 'Usage',
        icon: <IconChartHistogram size={ICON} />,
        link: linkOptions({
          to: '/usage-tracking',
          search: {
            range: '30d',
            grain: 'day',
            costGroupBy: 'source',
            tokensGroupBy: 'sub_tool',
          },
        }),
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
        link: linkOptions({
          to: '/usage-tracking',
          search: {
            range: '30d',
            grain: 'day',
            costGroupBy: 'source',
            tokensGroupBy: 'sub_tool',
          },
        }),
      },
      {
        id: 'monitoring',
        label: 'Monitoring',
        icon: <IconActivity size={ICON} />,
        disabled: true,
        link: linkOptions({
          to: '/usage-tracking',
          search: {
            range: '30d',
            grain: 'day',
            costGroupBy: 'source',
            tokensGroupBy: 'sub_tool',
          },
        }),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: <IconChecklist size={ICON} />,
        disabled: true,
        link: linkOptions({
          to: '/usage-tracking',
          search: {
            range: '30d',
            grain: 'day',
            costGroupBy: 'source',
            tokensGroupBy: 'sub_tool',
          },
        }),
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
