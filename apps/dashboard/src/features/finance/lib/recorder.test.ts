import { describe, expect, it } from 'bun:test'
import { pauseSessionRecording } from './recorder'

const fake = () => {
  const calls: string[] = []
  return {
    calls,
    recorder: {
      stopSessionRecorder: () => void calls.push('stop'),
      resumeSessionRecorder: () => void calls.push('resume'),
    },
  }
}

describe('pauseSessionRecording', () => {
  it('stops replay at once and resumes it only when the returned cleanup runs', () => {
    const { calls, recorder } = fake()
    const resume = pauseSessionRecording(recorder)
    expect(calls).toEqual(['stop'])
    resume()
    expect(calls).toEqual(['stop', 'resume'])
  })

  it('survives an SDK with no recorder (never initialised, or replay disabled)', () => {
    const throwing = {
      stopSessionRecorder: () => {
        throw new TypeError('no recorder')
      },
      resumeSessionRecorder: () => {
        throw new TypeError('no recorder')
      },
    }
    const resume = pauseSessionRecording(throwing)
    expect(() => resume()).not.toThrow()
  })
})
