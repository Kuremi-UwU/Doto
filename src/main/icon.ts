import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Theme } from '../shared/types'

/** The Doto mark used for the window, the taskbar, and exported notes. */
export function appIconPath(): string {
  const file = 'icon.png'
  const candidates = [join(process.resourcesPath, file), join(app.getAppPath(), 'resources', file), join(process.cwd(), 'resources', file)]
  return candidates.find((path) => existsSync(path)) ?? candidates[candidates.length - 1]
}

/** Dark mark on a light window, light mark on a dark window. */
export function appIcon(theme: Theme): NativeImage {
  const image = nativeImage.createFromPath(appIconPath())
  if (theme !== 'dark' || image.isEmpty()) return image
  const { width, height } = image.getSize()
  const bitmap = Buffer.from(image.toBitmap())
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = 255 - bitmap[i]
    bitmap[i + 1] = 255 - bitmap[i + 1]
    bitmap[i + 2] = 255 - bitmap[i + 2]
  }
  return nativeImage.createFromBitmap(bitmap, { width, height })
}
