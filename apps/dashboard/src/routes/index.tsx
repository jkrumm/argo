import { createFileRoute } from '@tanstack/react-router'
import { TodayPage } from '../features/home/today-page'

export const Route = createFileRoute('/')({
  component: TodayPage,
})
