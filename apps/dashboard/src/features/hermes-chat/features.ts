// Hardcoded feature flags for Hermes Chat composer surfaces that are wired end
// to end but not yet production-ready. Flip a flag to `true` to re-enable — the
// backing API endpoints stay in place, so this only gates the composer UI.
//
// Typed as `boolean` (not the literal `false`) on purpose: it keeps both render
// branches type-reachable and avoids a constant-condition lint flag.
export const HERMES_CHAT_FEATURES: {
  imageUpload: boolean
  fileUpload: boolean
  audioTranscription: boolean
} = {
  // Image attachments are not yet forwarded to Hermes (no multimodal support).
  imageUpload: false,
  // File attachments are not yet forwarded to Hermes.
  fileUpload: false,
  // Voice input (mic → STT transcription) + voice mode (auto-send + spoken replies).
  audioTranscription: true,
}
