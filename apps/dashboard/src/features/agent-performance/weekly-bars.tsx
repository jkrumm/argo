import { Bars, type BarsProps } from 'basalt-ui/charts'
import { WEEK_FORMAT } from './week-format'

const HEIGHT = { base: 200, regular: 240 } as const

type Props<T extends { at: Date }> = {
  ariaLabel: string
  data: T[]
  bars: BarsProps<T>['bars']
}

/** Stacked weekly bars: the one chart shape of the review and runs sections. */
export function WeeklyBars<T extends { at: Date }>({ ariaLabel, data, bars }: Props<T>) {
  return (
    <Bars
      ariaLabel={ariaLabel}
      data={data}
      height={HEIGHT}
      x={(d) => d.at}
      formatX={(x) => WEEK_FORMAT.format(new Date(x))}
      layout="stacked"
      cursorResolution="leading"
      bars={bars}
      y={{ domain: 'auto', autoMaxFloor: 4, ticks: 4, nice: true }}
      legend={{ placement: 'bottom' }}
      tooltip={{ formatHeader: (x) => `Week of ${WEEK_FORMAT.format(new Date(x))}` }}
    />
  )
}
