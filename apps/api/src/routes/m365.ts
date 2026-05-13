import { Elysia } from 'elysia'
import { z } from 'zod'
import { listTools } from '../clients/m365.js'

const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
})

export const m365Routes = new Elysia({ prefix: '/m365' }).get(
  '/tools',
  async () => {
    const tools = await listTools()
    return { tools, count: tools.length }
  },
  {
    response: z.object({
      tools: z.array(ToolSchema),
      count: z.number().int(),
    }),
    detail: {
      tags: ['M365'],
      summary: 'Discover available M365 MCP tools',
      description:
        'Calls tools/list on the IU Microsoft 365 MCP server (a Microsoft Graph wrapper covering Outlook calendar, mail, Teams chats/channels/messages, OneDrive, OneNote, etc.) and returns each tool definition with its JSON-Schema input shape. Phase 1 discovery endpoint — used to plan which tools to wrap as first-class REST endpoints (calendar, channel messages, mail). Requires that /oauth/m365/init has been completed once.',
      security: [{ BearerAuth: [] }],
    },
  },
)
