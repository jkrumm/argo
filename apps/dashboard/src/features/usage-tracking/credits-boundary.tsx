/**
 * A local error boundary for the Credits tab's suspense queries: a failed read renders in its own
 * card (with the shared Retry) instead of reaching the route's error component and taking the other
 * tabs' siblings with it. Retry resets the queries' error state and remounts the block.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { ChartCard } from 'basalt-ui/charts'

type Props = { noun: string; height: number | 'content'; reset: () => void; children: ReactNode }
type State = { error: Error | null }

class Catch extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The query layer already reports the failure; this keeps the component stack beside it.
    console.warn(`credits: ${this.props.noun} failed to load`, error.message, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <ChartCard
        placeholderHeight={this.props.height}
        stateNoun={this.props.noun}
        state={{ error }}
        onRetry={() => {
          this.props.reset()
          this.setState({ error: null })
        }}
      />
    )
  }
}

export function CreditsBoundary({
  noun,
  height = 'content',
  children,
}: {
  noun: string
  height?: number | 'content'
  children: ReactNode
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Catch noun={noun} height={height} reset={reset}>
          {children}
        </Catch>
      )}
    </QueryErrorResetBoundary>
  )
}
