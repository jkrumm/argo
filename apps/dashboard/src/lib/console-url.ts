/** The factory Console's origin sits beside Argo's: the first host label `argo` becomes `factory`. */
const ARGO_LABEL = 'argo.'
const CONSOLE_LABEL = 'factory.'

type LocationLike = Pick<Location, 'protocol' | 'hostname'>

/**
 * The Console URL for a path, derived from the current location so no host is written down:
 * `argo.test` -> `factory.test`, `argo.<domain>` -> `factory.<domain>`, same protocol. A host that
 * does not start with `argo.` (localhost, an IP) has no sibling, so there is no Console to link: null.
 */
export function consoleUrl(location: LocationLike, path = '/'): string | null {
  if (!location.hostname.startsWith(ARGO_LABEL)) return null
  const rest = location.hostname.slice(ARGO_LABEL.length)
  return `${location.protocol}//${CONSOLE_LABEL}${rest}${path}`
}
