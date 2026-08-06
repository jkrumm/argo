// A3 (Hermes Chat rebuild on basalt-ui/agent-chat): the ai-sdk `UIMessage`-based types this file
// used to carry (`HermesUIMessage`, `ToolProgress`, `HermesMessageMetadata`, `AudioRefMeta`) are
// gone — the transport now speaks `basalt-ui/agent`'s `AgentPart`/`ChatMessage`, not `UIMessage`,
// and the transient `data-toolProgress` chunk they described is never surfaced to the client at
// all (aiSdkTransport's snapshot-diff silently drops every `data-*` part — see hermes-transport.ts).
// Only the attachment shape survives, kept for `attachment-display.tsx` (KEEP list).

/** A user-supplied text (longform markdown) attachment. */
export type TextAttachment = {
  type: 'text'
  title?: string
  content?: string
}

/** A user-supplied image attachment stored inline as a data URL. */
export type ImageAttachment = {
  type: 'image'
  title?: string
  dataUrl: string
  mimeType: string
  fileName?: string
}

/** A user-supplied file attachment stored inline as a data URL. */
export type FileAttachment = {
  type: 'file'
  title?: string
  dataUrl: string
  mimeType: string
  fileName: string
  sizeBytes: number
}

export type Attachment = TextAttachment | ImageAttachment | FileAttachment
