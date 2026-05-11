import { useMemo, type ReactNode } from 'react'
import { useVxTheme } from '../theme'

function InfoIcon({ title }: { title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role="img"
      style={{
        cursor: 'help',
        marginLeft: 6,
        color: 'rgba(128,128,128,0.45)',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm0 5a1 1 0 0 1 1 1v7a1 1 0 1 1-2 0v-7a1 1 0 0 1 1-1z" />
      </svg>
    </span>
  )
}

/**
 * Standard wrapper for every visx chart — card with info-tooltip title + optional
 * subtitle (the question the chart answers) + optional extra slot (current value
 * badge etc.). Do not wrap visx charts in bare divs.
 */
export function ChartCard({
  title,
  subtitle,
  tooltip,
  extra,
  children,
}: {
  title: string
  subtitle?: string
  tooltip: string
  extra?: ReactNode
  children: ReactNode
}) {
  const theme = useVxTheme()
  const isDark = theme.colorScheme === 'dark'

  const cardStyle = useMemo(
    () => ({
      border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.08)',
      borderRadius: 8,
      marginBottom: 16,
      overflow: 'hidden' as const,
      backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#ffffff',
      boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
    }),
    [isDark],
  )

  const headerStyle = useMemo(
    () => ({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 12px',
      borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
    }),
    [isDark],
  )

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 500, fontSize: 14 }}
          >
            {title}
            <InfoIcon title={tooltip} />
          </span>
          {subtitle !== undefined && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: 'rgba(128,128,128,0.65)',
                marginTop: 2,
              }}
            >
              {subtitle}
            </span>
          )}
        </span>
        {extra !== undefined && <span>{extra}</span>}
      </div>
      <div style={{ padding: '8px 12px' }}>{children}</div>
    </div>
  )
}
