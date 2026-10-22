export function isRecordingShortcut(): boolean {
  return recording
}

export function setRecordingShortcut(on: boolean): void {
  recording = on
  void window.doto.setShortcutCapture(on)
}

let recording = false
