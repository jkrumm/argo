import { describe, expect, it } from 'bun:test'
import { redactSecretsDeep, redactSecretText } from './secret-redaction'

describe('redactSecretText', () => {
  it('redacts a $VAR shell expansion', () => {
    expect(redactSecretText('echo $HERMES_API_TOKEN')).toBe('echo [redacted]')
  })

  it('redacts a ${VAR} shell expansion', () => {
    expect(redactSecretText('echo ${HERMES_API_TOKEN}')).toBe('echo [redacted]')
  })

  it('redacts an inline env assignment before a command', () => {
    expect(redactSecretText('FOO_TOKEN=abc123 ./deploy.sh')).toBe('[redacted] ./deploy.sh')
  })

  it('redacts a realistic production-shaped command', () => {
    const input = 'DB_PASSWORD=$DB_PASSWORD psql -h localhost -c "select 1"'
    expect(redactSecretText(input)).toBe('[redacted] psql -h localhost -c "select 1"')
  })

  it('redacts a --token= long flag', () => {
    expect(redactSecretText('curl --api-token=sk-xyz https://example.com')).toBe(
      'curl [redacted] https://example.com',
    )
  })

  it('redacts an Authorization header', () => {
    expect(redactSecretText('Authorization: Bearer sk-abc123')).toBe('[redacted]')
  })

  it('leaves plain text untouched', () => {
    expect(redactSecretText('ls -la /tmp')).toBe('ls -la /tmp')
  })

  it('redacts multiple secrets in one string', () => {
    expect(redactSecretText('TOKEN=$TOKEN curl -H "Authorization: Bearer $TOKEN" https://x')).toBe(
      '[redacted] curl -H "[redacted]" https://x',
    )
  })
})

describe('redactSecretsDeep', () => {
  it('redacts string leaves inside a nested object', () => {
    const input = {
      command: 'FOO_TOKEN=$FOO_TOKEN ./run.sh',
      env: { PATH: '/usr/bin', SECRET_KEY: '$SECRET_KEY' },
    }
    expect(redactSecretsDeep(input)).toEqual({
      command: '[redacted] ./run.sh',
      env: { PATH: '/usr/bin', SECRET_KEY: '[redacted]' },
    })
  })

  it('redacts string leaves inside arrays', () => {
    expect(redactSecretsDeep(['echo $TOKEN', 'ls -la'])).toEqual(['echo [redacted]', 'ls -la'])
  })

  it('passes through numbers, booleans and null unchanged', () => {
    expect(redactSecretsDeep({ exitCode: 0, ok: true, note: null })).toEqual({
      exitCode: 0,
      ok: true,
      note: null,
    })
  })

  it('handles a circular reference without throwing', () => {
    const obj: Record<string, unknown> = { command: 'echo $TOKEN' }
    obj.self = obj
    const result = redactSecretsDeep(obj) as Record<string, unknown>
    expect(result.command).toBe('echo [redacted]')
    expect(result.self).toBe('[circular]')
  })

  it('returns a primitive unchanged when not a string', () => {
    expect(redactSecretsDeep(42)).toBe(42)
    expect(redactSecretsDeep(undefined)).toBe(undefined)
  })
})
