import { Box, Skeleton, Text } from '@mantine/core'
import { useObjectUrl, usePaperBlob } from './paper-blob'

type AuthImageProps = {
  path: string | null
  version?: string | number
  alt: string
  /** Shown instead of the image while the path is null or the fetch failed. */
  missing?: string
}

export function AuthImage({ path, version, alt, missing = 'No preview' }: AuthImageProps) {
  const blob = usePaperBlob(path, version)
  const url = useObjectUrl(blob.data)
  if (path === null || blob.isError) {
    return (
      <Box h="100%" display="flex" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text size="xs" c="dimmed">
          {missing}
        </Text>
      </Box>
    )
  }
  if (!url) return <Skeleton h="100%" />
  return (
    <img
      src={url}
      alt={alt}
      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
    />
  )
}
