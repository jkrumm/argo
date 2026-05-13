import { env } from '../env.js'
import { tracedFetch } from '../lib/traced-fetch.js'
import { createClient, createConfig } from '../generated/ticktick/client'
import {
  getAllProjects,
  getProjectWithDataById,
  createSingleTask,
  completeSpecifyTask,
  deleteSpecifyTask,
} from '../generated/ticktick/sdk.gen'
import type { Task } from '../generated/ticktick/types.gen'

const API_KEY = env.TICKTICK_API_KEY

export const ticktickClient = createClient(
  createConfig({
    baseUrl: 'https://ticktick.com',
    // Type-cast: @hey-api expects a typeof-fetch-shaped function (which carries
    // the static `preconnect` prop in lib.dom). tracedFetch is fully compatible
    // for the call sites the client uses; the static prop isn't read.
    fetch: tracedFetch as unknown as typeof fetch,
  }),
)

ticktickClient.interceptors.request.use((request) => {
  request.headers.set('Authorization', `Bearer ${API_KEY}`)
  return request
})

export const ticktickOps = {
  getProjects: () => getAllProjects({ client: ticktickClient }),

  getProjectData: (projectId: string) =>
    getProjectWithDataById({ client: ticktickClient, path: { projectId } }),

  createTask: (body: Task) => createSingleTask({ client: ticktickClient, body }),

  updateTask: async (taskId: string, body: Task): Promise<Response> => {
    return tracedFetch(`https://ticktick.com/open/v1/task/${taskId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  },

  completeTask: (projectId: string, taskId: string) =>
    completeSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),

  deleteTask: (projectId: string, taskId: string) =>
    deleteSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),
}
