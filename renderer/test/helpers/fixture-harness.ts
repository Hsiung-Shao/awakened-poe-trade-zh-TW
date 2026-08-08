import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClipboard } from '@/parser'
import type { ParsedItem } from '@/parser/ParsedItem'

export const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../fixtures')

/** `UPDATE_FIXTURES=1 npm test` 時改寫快照,而不是比對。 */
export const UPDATE_MODE = process.env.UPDATE_FIXTURES === '1'

export interface Fixture {
  name: string
  language: string
  text: string
  expectedPath: string
}

export type FixtureOutcome =
  | { kind: 'parsed', item: ParsedItem, snapshot: unknown }
  | { kind: 'error', error: string }

export async function listFixtures (language: string): Promise<Fixture[]> {
  const dir = path.join(FIXTURES_DIR, language)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const out: Fixture[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.txt')) continue
    const name = entry.slice(0, -'.txt'.length)
    out.push({
      name,
      language,
      text: await fs.readFile(path.join(dir, entry), 'utf8'),
      expectedPath: path.join(dir, `${name}.expected.json`)
    })
  }
  return out
}

export function runFixture (fixture: Fixture): FixtureOutcome {
  const result = parseClipboard(fixture.text)
  if (result.isErr()) {
    return { kind: 'error', error: result.error }
  }
  const item = result.value
  return { kind: 'parsed', item, snapshot: stableSnapshot(item) }
}

/**
 * 把解析結果轉成**鍵順序固定**的純資料。
 *
 * 不排序鍵的話,快照的差異會取決於物件屬性的賦值順序 —— parser 裡挪動一行
 * 賦值就會產生整份 diff,而真正的行為改變會被埋在雜訊裡。`undefined` 一併移除,
 * 因為 JSON 沒有這個值,留著會讓「欄位不存在」與「欄位是 undefined」看起來不同。
 */
function stableSnapshot (value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSnapshot)
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue
      out[key] = stableSnapshot(src[key])
    }
    return out
  }
  return value
}

export async function readExpected (fixture: Fixture): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(fixture.expectedPath, 'utf8'))
  } catch {
    return undefined
  }
}

export async function writeExpected (fixture: Fixture, snapshot: unknown): Promise<void> {
  await fs.writeFile(fixture.expectedPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
}

export interface SnapshotDiff {
  field: string
  expected: unknown
  actual: unknown
}

/** 逐欄比對,回報**路徑**而不是整份物件 —— 只印 diff 的話看不出哪個欄位變了。 */
export function diffSnapshots (expected: unknown, actual: unknown, at = ''): SnapshotDiff[] {
  if (Object.is(expected, actual)) return []

  const bothObjects = (
    expected !== null && typeof expected === 'object' &&
    actual !== null && typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  )
  if (!bothObjects) {
    return [{ field: at || '(根)', expected, actual }]
  }

  const keys = new Set([
    ...Object.keys(expected as object),
    ...Object.keys(actual as object)
  ])
  const out: SnapshotDiff[] = []
  for (const key of [...keys].sort()) {
    const childPath = Array.isArray(expected) ? `${at}[${key}]` : (at ? `${at}.${key}` : key)
    out.push(...diffSnapshots(
      (expected as Record<string, unknown>)[key],
      (actual as Record<string, unknown>)[key],
      childPath
    ))
  }
  return out
}

export function formatDiff (diffs: SnapshotDiff[]): string {
  const shown = diffs.slice(0, 12)
  const lines = shown.map(d =>
    `  ${d.field}\n` +
    `      期望: ${brief(d.expected)}\n` +
    `      實際: ${brief(d.actual)}`)
  if (diffs.length > shown.length) {
    lines.push(`  …另有 ${diffs.length - shown.length} 處`)
  }
  return lines.join('\n')
}

function brief (value: unknown): string {
  if (value === undefined) return '(不存在)'
  const text = JSON.stringify(value)
  return (text !== undefined && text.length > 120) ? text.slice(0, 120) + '…' : String(text)
}
