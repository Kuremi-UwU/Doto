import { useSyncExternalStore } from 'react'

const BARS = 12
const IDLE = Object.freeze(Array.from({ length: BARS }, () => 0.16))

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let levels: readonly number[] = IDLE
let audioContext: AudioContext | null = null
let paintFrame = 0
let startedAt = 0
let recordedSeconds = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function useAudioRecording(): boolean {
  return useSyncExternalStore(subscribe, recordingNow, recordingNow)
}

/** Live bar heights, from 0 to 1, while the microphone is open. */
export function useAudioLevels(): readonly number[] {
  return useSyncExternalStore(subscribe, () => levels, () => levels)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function recordingNow(): boolean {
  return recorder?.state === 'recording'
}

/** Whole seconds of the clip that just stopped. */
export function lastRecordingSeconds(): number {
  return recordedSeconds
}

/** Starts the Windows default microphone, or stops it and returns the clip. */
export async function toggleAudioRecording(): Promise<Blob | null> {
  if (recorder?.state === 'recording') return stopRecording()
  const next = await openDefaultMicrophone()
  try {
    chunks = []
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
    const rec = mime ? new MediaRecorder(next, { mimeType: mime }) : new MediaRecorder(next)
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    stream = next
    recorder = rec
    startedAt = performance.now()
    recordedSeconds = 0
    watchLevels(next)
    rec.start(200)
    emit()
    return null
  } catch (error) {
    next.getTracks().forEach((track) => track.stop())
    throw error
  }
}

/** `default` is Chromium's name for the input Windows has set as the default microphone. */
async function openDefaultMicrophone(): Promise<MediaStream> {
  const tries: MediaStreamConstraints[] = [
    { audio: { deviceId: { exact: 'default' }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
    { audio: { deviceId: { ideal: 'default' }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
    { audio: true }
  ]
  let last: unknown
  for (const constraints of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error('Microphone unavailable')
}

function stopRecording(): Promise<Blob> {
  const rec = recorder
  if (!rec) return Promise.resolve(new Blob())
  return new Promise((resolve) => {
    rec.addEventListener(
      'stop',
      () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        release()
        resolve(blob)
      },
      { once: true }
    )
    recordedSeconds = Math.max(0, Math.round((performance.now() - startedAt) / 1000))
    if (rec.state === 'recording') rec.requestData()
    rec.stop()
  })
}

function watchLevels(next: MediaStream): void {
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  context.createMediaStreamSource(next).connect(analyser)
  audioContext = context
  void context.resume()
  const data = new Uint8Array(analyser.fftSize)
  const draw = (): void => {
    analyser.getByteTimeDomainData(data)
    const step = Math.floor(data.length / BARS)
    const nextLevels: number[] = []
    for (let bar = 0; bar < BARS; bar += 1) {
      let energy = 0
      for (let sample = 0; sample < step; sample += 1) {
        const value = (data[bar * step + sample] - 128) / 128
        energy += value * value
      }
      nextLevels.push(Math.min(1, Math.sqrt(energy / step) * 3.2))
    }
    levels = nextLevels
    emit()
    paintFrame = requestAnimationFrame(draw)
  }
  paintFrame = requestAnimationFrame(draw)
}

function release(): void {
  cancelAnimationFrame(paintFrame)
  stream?.getTracks().forEach((track) => track.stop())
  void audioContext?.close()
  audioContext = null
  stream = null
  recorder = null
  chunks = []
  levels = IDLE
  emit()
}
