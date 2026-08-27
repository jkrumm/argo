import { useSuspenseQuery } from '@tanstack/react-query'
import { Card, SimpleGrid, Skeleton } from '@mantine/core'
import { IconFlame, IconRoute, IconWalk } from '@tabler/icons-react'
import { StatCard, type StatCardTone } from 'basalt-ui'
import { walkingPadQueries, type WalkingPadWindowParams } from '../../lib/queries/walking-pad'
import { HERO_TOOLTIPS } from './constants'
import { formatDeltaKmh, formatKm, formatPace } from './formatters'

/**
 * The three hero cards are `StatCard`s (basalt-ui 1.27.0), not a local `HeroCard`. Three of the
 * props that landed in that minor are what made this expressible: `unit` splits the numeral from its
 * `km` / `km/h`, and `deltaFormat` + `deltaGlyph` let the PACE card print an absolute `+0.3 km/h`
 * where the card's default would have claimed `▲0.3%` — a wrong unit on a KPI, and the reason this
 * one stayed hand-rolled through 1.26.0. The arrow + figure that used to sit beside the value is
 * now the framework's own delta chip.
 */

type Direction = 'up' | 'flat' | 'down' | 'na'

function toneFor(d: Direction): StatCardTone | undefined {
  switch (d) {
    case 'up':
      return 'good'
    case 'down':
      return 'warn'
    default:
      return undefined
  }
}

export function HeroStats({ params }: { params: WalkingPadWindowParams }) {
  const { data } = useSuspenseQuery(walkingPadQueries.heroes(params))

  // ── Volume ─────────────────────────────────────────────────────────────
  const vol = data.volume
  const volDir: Direction =
    vol.direction === 'increasing'
      ? 'up'
      : vol.direction === 'decreasing'
        ? 'down'
        : vol.direction === 'stable'
          ? 'flat'
          : 'na'
  const volSubtitle =
    vol.direction === 'insufficient'
      ? 'Not enough prior data to compare yet.'
      : vol.deltaPct === null
        ? 'First window with data — no prior to compare.'
        : `vs prior ${formatKm(vol.priorDistanceM)}`

  // ── Pace ───────────────────────────────────────────────────────────────
  const pace = data.pace
  const paceDir: Direction =
    pace.direction === 'faster'
      ? 'up'
      : pace.direction === 'slower'
        ? 'down'
        : pace.direction === 'stable'
          ? 'flat'
          : 'na'
  const paceSubtitle =
    pace.currentAvgKmh === null
      ? 'No walks in this window.'
      : pace.deltaKmh === null
        ? 'First window — no prior pace to compare.'
        : `vs prior ${pace.priorAvgKmh !== null ? formatPace(pace.priorAvgKmh, 1) : '—'}`

  // ── Streak ─────────────────────────────────────────────────────────────
  const s = data.streak
  const momentum =
    s.momentum === 'accelerating' ? 'Accelerating' : s.momentum === 'cooling' ? 'Cooling' : 'Steady'

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      <StatCard
        title="Volume"
        info={HERO_TOOLTIPS.volume}
        icon={<IconRoute size={14} />}
        value={(vol.currentDistanceM / 1000).toFixed(2)}
        unit="km"
        subtitle={volSubtitle}
        // A percentage, so the card's own default format is the right one — `deltaPct` is a
        // FRACTION on the wire, hence the ×100.
        {...(vol.deltaPct !== null && { delta: vol.deltaPct * 100 })}
        tone={toneFor(volDir)}
      />
      <StatCard
        title="Pace"
        info={HERO_TOOLTIPS.pace}
        icon={<IconWalk size={14} />}
        value={pace.currentAvgKmh !== null ? pace.currentAvgKmh.toFixed(1) : '—'}
        {...(pace.currentAvgKmh !== null && { unit: 'km/h' })}
        subtitle={paceSubtitle}
        // An ABSOLUTE delta: `formatDeltaKmh` prints its own sign, so the ▲/▼ would say it twice.
        {...(pace.deltaKmh !== null && {
          delta: pace.deltaKmh,
          deltaFormat: (d: number) => formatDeltaKmh(d, 1),
          deltaGlyph: false,
        })}
        tone={toneFor(paceDir)}
      />
      <StatCard
        title="Streak"
        info={HERO_TOOLTIPS.streak}
        icon={<IconFlame size={14} />}
        value={String(s.currentDays)}
        unit={s.currentDays === 1 ? 'day' : 'days'}
        subtitle={s.walkedToday ? '✓ walked today' : 'walk to extend'}
        breakdown={[
          { label: 'Best', value: `${s.bestDays}d` },
          { label: 'Momentum', value: momentum },
        ]}
        {...(s.currentDays >= 7 && { tone: 'good' as const })}
      />
    </SimpleGrid>
  )
}

export function HeroStatsSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} py="xs" px="sm" h="100%">
          <Skeleton height={12} width={100} mb={8} />
          <Skeleton height={32} width={140} mb={8} />
          <Skeleton height={10} width={180} />
        </Card>
      ))}
    </SimpleGrid>
  )
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <Card py="xs" px="sm">
      <Skeleton height={14} width={140} radius="sm" mb="sm" />
      <Skeleton height={height - 40} radius="sm" />
    </Card>
  )
}
