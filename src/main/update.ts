import { net } from 'electron'
import { APP_VERSION, GITHUB_REPO, versionFromTag } from '../shared/signature'
import type { UpdateCheck } from '../shared/types'

const TIMEOUT_MS = 10_000

/** Asks GitHub which release is current. A different tag is treated as an update. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Doto/${APP_VERSION}`
      }
    })
    if (response.status === 404) return { state: 'none' }
    if (!response.ok) return { state: 'error' }
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof body.tag_name !== 'string') return { state: 'error' }
    const version = versionFromTag(body.tag_name)
    if (!version) return { state: 'error' }
    if (version === APP_VERSION) return { state: 'current', version }
    const url = releasePage(body.html_url)
    if (!url) return { state: 'error' }
    return { state: 'available', version, url }
  } catch {
    return { state: 'error' }
  } finally {
    clearTimeout(timer)
  }
}

function releasePage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const prefix = `https://github.com/${GITHUB_REPO}/releases/`
  return value.startsWith(prefix) ? value : null
}
