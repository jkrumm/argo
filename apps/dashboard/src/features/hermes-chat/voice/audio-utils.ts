// Shared audio helpers for Hermes Chat voice input/output. Kept framework-free so
// both composers (feed + in-thread) and the playback provider can reuse them.

// MediaRecorder output format differs by browser: Chrome/Firefox emit webm/opus,
// Safari/iOS only emit mp4/aac (it cannot produce webm). Pick the first supported
// container at record time — gpt-4o-transcribe accepts all of these, so no
// client-side transcoding is needed. Hardcoding webm silently broke iOS recording.
const PREFERRED_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg;codecs=opus',
]

export function pickRecordingMime(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  return PREFERRED_MIMES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function mimeToExt(mime: string): string {
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// A valid empty (zero-sample) WAV. Played once inside a user gesture (the mic tap)
// to "unlock" the playback element so voice-mode can auto-play the reply later,
// outside a gesture, under iOS/Safari autoplay policy.
export const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export function decodeAudioTitle(raw: string | null): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
