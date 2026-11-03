/** The two session-replay calls of the HyperDX browser SDK. */
export type SessionRecorder = {
  stopSessionRecorder(): void
  resumeSessionRecorder(): void
}

/**
 * Stops session replay for as long as a finance page is open and returns the function that resumes
 * it. The finance layout also carries the `hdx-block` class, but replay is the one channel that
 * would copy rendered amounts and merchants off the mini, so it is off while they are on screen.
 *
 * Both calls are no-ops in the SDK when it was never initialised (no API key); the try/catch also
 * covers a replay that was disabled at init (dev), where resuming has no recorder to resume.
 */
export function pauseSessionRecording(recorder: SessionRecorder): () => void {
  try {
    recorder.stopSessionRecorder()
  } catch {
    // Nothing is recording: nothing to stop.
  }
  return () => {
    try {
      recorder.resumeSessionRecorder()
    } catch {
      // Nothing was recording before: nothing to resume.
    }
  }
}
