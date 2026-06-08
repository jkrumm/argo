// Hermes streams the OpenAI SSE protocol PLUS a custom `event: hermes.tool.progress`
// channel ({ tool, emoji, label, toolCallId, status }). The AI SDK's
// `@ai-sdk/openai-compatible` parser only understands plain OpenAI `data:` chunks
// and would choke on (or silently drop) the custom event. So before handing the
// upstream body to the SDK we run it through this filter, which:
//
//   • forwards every non-tool-progress event verbatim to the SDK branch, and
//   • peels off `hermes.tool.progress` events and hands their parsed payload to
//     a callback (the proxy injects them as transient UI data parts).
//
// See docs/HERMES-CHAT-PRD.md → "AI SDK ↔ Hermes custom-event tap".

/** Parsed payload of a Hermes `event: hermes.tool.progress` SSE frame. */
export interface ToolProgressData {
  tool: string
  emoji?: string
  label: string
  toolCallId: string
  status: string
}

const TOOL_PROGRESS_EVENT = 'hermes.tool.progress'

/** Parse a single SSE event block into its `event` name and joined `data`. */
function parseSseBlock(block: string): { event: string | undefined; data: string } {
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // comment / keepalive
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }
  return { event, data: dataLines.join('\n') }
}

/**
 * Wrap a raw Hermes SSE byte stream, routing `hermes.tool.progress` events to
 * `onToolProgress` and re-emitting all other events unchanged for the AI SDK.
 *
 * A malformed progress payload is ignored — the main OpenAI stream must never
 * break because of an auxiliary tool-progress frame.
 */
export function filterToolProgress(
  upstream: ReadableStream<Uint8Array>,
  onToolProgress: (data: ToolProgressData) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = upstream.getReader()

      const dispatch = (block: string): void => {
        const { event, data } = parseSseBlock(block)
        if (event === TOOL_PROGRESS_EVENT) {
          if (data) {
            try {
              onToolProgress(JSON.parse(data) as ToolProgressData)
            } catch {
              // swallow malformed progress payloads
            }
          }
          return
        }
        controller.enqueue(encoder.encode(`${block}\n\n`))
      }

      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            // Strip CR so both `\n\n` and `\r\n\r\n` frame delimiters split cleanly.
            buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
            let idx: number
            while ((idx = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              if (block.length) dispatch(block)
            }
          }
          buffer += decoder.decode().replace(/\r/g, '')
          const rest = buffer.trim()
          if (rest.length) dispatch(rest)
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      })()
    },
  })
}
