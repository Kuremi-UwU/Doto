export const APP_VERSION = '0.3b-a'
export const MADE_BY_LINE = 'Doto made by Krish <3'
export const MADE_BY_SITE = 'https://www.kuremi.in'
export const GITHUB_REPO = 'Kuremi-UwU/Doto'

/** Release tags may be `v0.3b-a` or `0.3b-a`. */
export function versionFromTag(tag: string): string {
  return tag.replace(/^v/i, '').trim()
}
