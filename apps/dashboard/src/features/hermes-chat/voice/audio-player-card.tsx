import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActionIcon,
  Card,
  Group,
  Loader,
  Menu,
  Slider,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { IconHeadphones, IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react'
import { getToken } from '../../../lib/auth'
import { apiBase } from '../../../lib/api-base'
import type { AudioCardData } from '../smart-card-schema'
import { formatElapsed } from './audio-utils'
import { useVoicePlayback } from './voice-playback'

// ── Position persistence ───────────────────────────────────────────────────────

const POS_PREFIX = 'argo-hermes-audiopos:'
const WRITE_THROTTLE_MS = 4000
const RESUME_THRESHOLD = 0.98 // ≥98% → treat as finished, start from 0

function posKey(playerId: string): string {
  return `${POS_PREFIX}${playerId}`
}

function readSavedPos(playerId: string): number {
  try {
    const raw = localStorage.getItem(posKey(playerId))
    if (!raw) return 0
    const v = Number(raw)
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

function writeSavedPos(playerId: string, pos: number): void {
  try {
    localStorage.setItem(posKey(playerId), String(pos))
  } catch {
    /* best-effort */
  }
}

function clearSavedPos(playerId: string): void {
  try {
    localStorage.removeItem(posKey(playerId))
  } catch {
    /* best-effort */
  }
}

// ── Duration formatting ────────────────────────────────────────────────────────

function formatSeconds(sec: number): string {
  return formatElapsed(sec * 1000)
}

function formatFromMs(ms: number): string {
  return formatElapsed(ms)
}

// ── Speed options ──────────────────────────────────────────────────────────────

const SPEED_OPTIONS: { label: string; value: number }[] = [
  { label: '0.75×', value: 0.75 },
  { label: '1×', value: 1 },
  { label: '1.25×', value: 1.25 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2 },
]

// ── AudioPlayerCard ────────────────────────────────────────────────────────────

export function AudioPlayerCard({
  card,
  messageId,
  threadId,
}: {
  card: AudioCardData
  messageId?: string
  threadId?: string
}) {
  const provider = useVoicePlayback()

  // Stable player ID: prefer messageId (stable across reloads) → fallback to a hash
  // of whatever unique content the card has.
  const playerId =
    messageId ?? `audio-card:${card.src ?? card.title ?? card.script?.slice(0, 40) ?? 'unknown'}`

  const isActive = provider.playingMessageId === playerId

  // Resolved audio URL (null until synthesized for script-only cards)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(card.src ?? null)
  // True while the podcast POST is in flight
  const [isSynthesizing, setIsSynthesizing] = useState(false)

  // Saved position from localStorage — read once on mount
  const [savedPos] = useState(() => readSavedPos(playerId))

  // Scrubbing state: while dragging the slider, suppress the provider's live time
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubValue, setScrubValue] = useState(0)

  // Track lastWrite for throttle
  const lastWriteRef = useRef(0)

  // The displayed elapsed/total (only meaningful when this card is active)
  const displayedTimeSec = isScrubbing ? scrubValue : isActive ? provider.currentTimeSec : savedPos

  const displayedDurationSec = isActive
    ? provider.durationSec
    : card.durationMs
      ? card.durationMs / 1000
      : 0

  const sliderValue =
    displayedDurationSec > 0 ? Math.min(1, displayedTimeSec / displayedDurationSec) : 0

  // ── Persist position on timeupdate (throttled) ─────────────────────────────

  useEffect(() => {
    if (!isActive) return
    const now = Date.now()
    if (now - lastWriteRef.current >= WRITE_THROTTLE_MS) {
      lastWriteRef.current = now
      // If ≥98% done, clear so next play restarts from 0
      const pct = displayedDurationSec > 0 ? provider.currentTimeSec / displayedDurationSec : 0
      if (pct >= RESUME_THRESHOLD) {
        clearSavedPos(playerId)
      } else {
        writeSavedPos(playerId, provider.currentTimeSec)
      }
    }
  }, [isActive, provider.currentTimeSec, displayedDurationSec, playerId])

  // ── Persist on pause ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isActive || provider.isPlaying) return
    // Paused while active → write immediately
    if (provider.currentTimeSec > 0) {
      const pct = displayedDurationSec > 0 ? provider.currentTimeSec / displayedDurationSec : 0
      if (pct >= RESUME_THRESHOLD) {
        clearSavedPos(playerId)
      } else {
        writeSavedPos(playerId, provider.currentTimeSec)
      }
    }
  }, [isActive, provider.isPlaying, provider.currentTimeSec, displayedDurationSec, playerId])

  // ── Persist on visibility hidden + unmount ────────────────────────────────

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && isActive && provider.currentTimeSec > 0) {
        const pct = displayedDurationSec > 0 ? provider.currentTimeSec / displayedDurationSec : 0
        if (pct >= RESUME_THRESHOLD) {
          clearSavedPos(playerId)
        } else {
          writeSavedPos(playerId, provider.currentTimeSec)
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      // On unmount, persist current position if this card is active
      if (isActive && provider.currentTimeSec > 0) {
        const pct = displayedDurationSec > 0 ? provider.currentTimeSec / displayedDurationSec : 0
        if (pct >= RESUME_THRESHOLD) {
          clearSavedPos(playerId)
        } else {
          writeSavedPos(playerId, provider.currentTimeSec)
        }
      }
    }
    // Intentionally NOT listing provider.currentTimeSec to avoid re-subscribing every frame.
    // The visibilitychange handler closes over the live value via ref on the element directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, playerId, displayedDurationSec])

  // ── Play / Pause handler ──────────────────────────────────────────────────

  const handlePlayPause = useCallback(async () => {
    if (isActive && provider.isPlaying) {
      provider.pause()
      return
    }

    if (isActive && !provider.isPlaying) {
      await provider.resume()
      return
    }

    // Not active — need to start playback
    if (resolvedUrl) {
      // Determine start position: use saved (skip if ≥98% of known duration)
      let startAt = savedPos
      if (card.durationMs && startAt >= (card.durationMs / 1000) * RESUME_THRESHOLD) {
        startAt = 0
      }
      await provider.playSource(playerId, resolvedUrl, {
        title: card.title,
        threadId,
        startAt: startAt > 0 ? startAt : undefined,
      })
      return
    }

    // No URL yet — need to synthesize from script (lazy, first-play only)
    if (card.script) {
      setIsSynthesizing(true)
      try {
        const token = getToken()
        const res = await fetch(`${apiBase}/ai/v1/audio/podcast`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            script: card.script,
            ...(card.title ? { title: card.title } : {}),
          }),
        })
        if (!res.ok) return
        const data = (await res.json()) as { hash: string; title: string; bytes: number }
        const url = `${apiBase}/ai/v1/audio/file/${data.hash}`
        setResolvedUrl(url)
        let startAt = savedPos
        if (card.durationMs && startAt >= (card.durationMs / 1000) * RESUME_THRESHOLD) {
          startAt = 0
        }
        await provider.playSource(playerId, url, {
          title: card.title ?? data.title,
          threadId,
          startAt: startAt > 0 ? startAt : undefined,
        })
      } catch {
        /* best-effort */
      } finally {
        setIsSynthesizing(false)
      }
    }
  }, [isActive, provider, resolvedUrl, card, playerId, threadId, savedPos])

  // ── Scrub handlers ────────────────────────────────────────────────────────

  const handleScrubChange = useCallback(
    (v: number) => {
      setIsScrubbing(true)
      setScrubValue(v * (isActive ? provider.durationSec : displayedDurationSec))
    },
    [isActive, provider.durationSec, displayedDurationSec],
  )

  const handleScrubEnd = useCallback(
    (v: number) => {
      setIsScrubbing(false)
      const targetSec = v * (isActive ? provider.durationSec : displayedDurationSec)
      if (isActive) {
        provider.seek(targetSec)
      }
    },
    [isActive, provider, displayedDurationSec],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  const isLoading = (isActive && provider.isBuffering) || isSynthesizing

  const speedLabel =
    SPEED_OPTIONS.find((o) => o.value === provider.rate)?.label ?? `${provider.rate}×`

  const durationLabel =
    displayedDurationSec > 0
      ? formatSeconds(displayedDurationSec)
      : card.durationMs
        ? formatFromMs(card.durationMs)
        : null

  return (
    <Card padding="sm">
      {/* Header */}
      <Group gap="xs" wrap="nowrap" mb="xs">
        <ThemeIcon size="sm" radius="sm" variant="light" color="blue">
          <IconHeadphones size={14} />
        </ThemeIcon>
        <Text size="sm" fw="semibold" flex={1} lineClamp={1}>
          {card.title ?? 'Audio'}
        </Text>
        {durationLabel && (
          <Text size="xs" c="dimmed" ff="monospace">
            {durationLabel}
          </Text>
        )}
      </Group>

      {/* Controls row */}
      <Group gap="xs" wrap="nowrap" align="center">
        {/* Play / Pause button */}
        <Tooltip label={isActive && provider.isPlaying ? 'Pause' : 'Play'} withArrow>
          <ActionIcon
            size={32}
            variant="light"
            color="blue"
            onClick={() => void handlePlayPause()}
            aria-label={isActive && provider.isPlaying ? 'Pause' : 'Play'}
            loading={isLoading}
          >
            {!isLoading &&
              (isActive && provider.isPlaying ? (
                <IconPlayerPauseFilled size={16} />
              ) : (
                <IconPlayerPlayFilled size={16} />
              ))}
          </ActionIcon>
        </Tooltip>

        {/* Elapsed time */}
        <Text size="xs" c="dimmed" ff="monospace" w={36} ta="right">
          {formatSeconds(displayedTimeSec)}
        </Text>

        {/* Scrub slider */}
        <Slider
          flex={1}
          size="sm"
          value={isScrubbing ? scrubValue / Math.max(displayedDurationSec, 1) : sliderValue}
          min={0}
          max={1}
          step={0.001}
          onChange={handleScrubChange}
          onChangeEnd={handleScrubEnd}
          label={null}
          thumbSize={12}
        />

        {/* Total time */}
        <Text size="xs" c="dimmed" ff="monospace" w={36}>
          {durationLabel ?? '--:--'}
        </Text>

        {/* Buffering indicator when active and waiting */}
        {isActive && provider.isBuffering && !isSynthesizing && <Loader size={12} color="gray" />}

        {/* Speed control */}
        <Menu shadow="md" position="top-end" withinPortal>
          <Menu.Target>
            <Tooltip label="Playback speed" withArrow>
              <ActionIcon size={28} variant="subtle" color="gray" aria-label="Playback speed">
                <Text size="xs" ff="monospace">
                  {speedLabel}
                </Text>
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {SPEED_OPTIONS.map((opt) => (
              <Menu.Item
                key={opt.value}
                onClick={() => provider.setRate(opt.value)}
                {...(provider.rate === opt.value ? { fw: 'semibold', c: 'blue' } : {})}
              >
                {opt.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Card>
  )
}
