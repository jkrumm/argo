import { useMutation, useQueryClient } from '@tanstack/react-query'
import { unwrap } from 'basalt-ui'
import { api } from '../../lib/eden'
import { userProfileQueries } from '../../lib/queries/user-profile'

/** `PUT /user-profile` with only the goal weight; refreshes the profile query. */
export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (goalWeightKg: number) =>
      api['user-profile'].put({ goal_weight_kg: goalWeightKg }).then(unwrap),
    onSuccess: () => void qc.invalidateQueries({ queryKey: userProfileQueries.all() }),
  })
}
