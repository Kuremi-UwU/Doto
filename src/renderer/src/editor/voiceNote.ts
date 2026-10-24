const BARS = 28
const WAVE_HEIGHT = 22

/** Builds the play button and waveform for a voice note. The audio element stays hidden. */
export function bindVoiceNote(root: HTMLElement, audio: HTMLAudioElement): void {
  audio.controls = false
  audio.preload = 'metadata'

  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'voice-note__play'
  play.innerHTML = PLAY_ICON
  play.addEventListener('pointerdown', stop)
  play.addEventListener('click', (event) => {
    stop(event)
    if (audio.paused) void audio.play()
    else audio.pause()
  })

  const wave = document.createElement('div')
  wave.className = 'voice-note__wave'
  wave.setAttribute('role', 'slider')
  wave.setAttribute('aria-label', 'Playback position')
  wave.setAttribute('aria-valuemin', '0')
  wave.setAttribute('aria-valuemax', '100')
  const bars = Array.from({ length: BARS }, () => {
    const bar = document.createElement('span')
    wave.appendChild(bar)
    return bar
  })
  wave.addEventListener('pointerdown', (event) => {
    stop(event)
    const box = wave.getBoundingClientRect()
    const ratio = box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0
    const total = duration()
    if (total > 0) audio.currentTime = ratio * total
    paint()
  })

  const time = document.createElement('span')
  time.className = 'voice-note__time'

  root.append(play, wave, time, audio)

  let peaks = Array.from({ length: BARS }, () => 0.28)
  let length = 0
  let drawn = ''

  const duration = (): number => {
    const stored = Number(root.dataset.duration)
    if (Number.isFinite(stored) && stored > 0) return stored
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration
    return length
  }

  const paint = (): void => {
    const total = duration()
    const progress = total > 0 ? audio.currentTime / total : 0
    const showBoth = !audio.paused || audio.currentTime > 0.05
    wave.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
    bars.forEach((bar, index) => {
      bar.style.height = `${Math.max(4, Math.round((peaks[index] ?? 0.2) * WAVE_HEIGHT))}px`
      bar.classList.toggle('is-played', (index + 0.5) / BARS <= progress)
    })
    time.textContent = total > 0 ? (showBoth ? `${clock(audio.currentTime)} / ${clock(total)}` : clock(total)) : ''
    play.setAttribute('aria-label', audio.paused ? 'Play voice note' : 'Pause voice note')
    play.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON
  }

  const drawWave = async (): Promise<void> => {
    const src = audio.currentSrc || audio.src
    if (!src || src === drawn) return
    drawn = src
    try {
      const response = await fetch(src)
      const bytes = await response.arrayBuffer()
      const context = new AudioContext()
      const decoded = await context.decodeAudioData(bytes.slice(0))
      await context.close()
      if (!(Number(root.dataset.duration) > 0) && decoded.duration > 0) length = decoded.duration
      peaks = peakLevels(decoded, BARS)
    } catch {
      drawn = ''
      peaks = Array.from({ length: BARS }, () => 0.3)
    }
    paint()
  }

  audio.addEventListener('timeupdate', paint)
  audio.addEventListener('play', paint)
  audio.addEventListener('pause', paint)
  audio.addEventListener('loadedmetadata', () => {
    paint()
    void drawWave()
  })
  audio.addEventListener('durationchange', paint)
  root.addEventListener('doto-duration', paint)
  paint()
  setTimeout(() => void drawWave(), 0)
}

function peakLevels(buffer: AudioBuffer, count: number): number[] {
  const data = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(data.length / count))
  const levels: number[] = []
  for (let index = 0; index < count; index += 1) {
    let sum = 0
    const start = index * block
    for (let sample = 0; sample < block; sample += 1) sum += Math.abs(data[start + sample] ?? 0)
    levels.push(sum / block)
  }
  const loudest = Math.max(...levels, 0.01)
  return levels.map((level) => level / loudest)
}

function clock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function stop(event: Event): void {
  event.preventDefault()
  event.stopPropagation()
}

const PLAY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg>'
const PAUSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
