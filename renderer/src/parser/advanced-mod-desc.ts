import { CLIENT_STRINGS as _$ } from '@/assets/data'
import type { ParsedStat } from './stat-translations'
import { ModifierType } from './modifiers'

export const SCOURGE_LINE = ' (scourge)'
export const ENCHANT_LINE = ' (enchant)'
export const IMPLICIT_LINE = ' (implicit)'

export interface ParsedModifier {
  info: ModifierInfo
  stats: ParsedStat[]
}

export interface ModifierInfo {
  type: ModifierType
  generation?: 'suffix' | 'prefix' | 'corrupted' | 'eldritch' | 'foulborn'
  name?: string
  tier?: number
  rank?: number
  tags: string[]
  rollIncr?: number
}

/**
 * 標籤分隔符。上游只認 em-dash(U+2014),而上游 issue #1869 的繁中回報用的是
 * 半形 hyphen:
 *
 *     { 前綴 "運動員的"(階層：1)— 生命 }      本專案 corpus 的樣本(em-dash)
 *     { 前綴 "健康的" (階層：8)- 生命 }        issue #1869(半形 hyphen)
 *
 * ⚠ 無法確定那個 hyphen 是真的客戶端差異,還是回報者手打進 GitHub 時的產物 ——
 * 同一則回報裡的基底名「遠古堅甲」經四方查證(本機國際服 GGPK 遊戲檔、
 * GGPK_zh 字典、poedb、APT 出貨資料)確定是「遠古脛甲」的誤植,所以這份樣本
 * 的可信度是打折的。
 *
 * 因此採「嚴格優先、失敗才放寬」:先照上游的 em-dash 切,切完解析得動就用它;
 * 只有在**原本就會 throw** 的情況下才退回寬鬆分隔符。這樣現有行為一個位元都不會變,
 * 而原本會整件解析失敗的輸入多一次機會。
 *
 * 半形 hyphen 只在「右括號之後、且後面接空白」時才視為分隔符 —— 直接用
 * `[—-]` 全域切會切壞詞綴名或標籤裡合法出現的連字號。
 */
const MOD_INFO_SEPARATOR_STRICT = '\u2014'
const MOD_INFO_SEPARATOR_RELAXED = /\u2014|(?<=\))\s*-(?=\s)/

export function parseModInfoLine (line: string): ModifierInfo {
  try {
    return parseModInfoLineWith(line, MOD_INFO_SEPARATOR_STRICT)
  } catch (strictError) {
    try {
      return parseModInfoLineWith(line, MOD_INFO_SEPARATOR_RELAXED)
    } catch {
      // 兩種都不行就回報嚴格模式的錯誤 —— 那才是真正該修的訊息
      throw strictError
    }
  }
}

function parseModInfoLineWith (line: string, separator: string | RegExp): ModifierInfo {
  const [modText, xText2, xText3] = line
    .slice(1, -1)
    .split(separator as string)
    .map(_ => _.trim())

  let type = ModifierType.Explicit
  let generation: ModifierInfo['generation']
  let name: ModifierInfo['name']
  let tier: ModifierInfo['tier']
  let rank: ModifierInfo['rank']

  if (_$.EATER_IMPLICIT.test(modText) || _$.EXARCH_IMPLICIT.test(modText)) {
    const match = modText.match(_$.EATER_IMPLICIT) ?? modText.match(_$.EXARCH_IMPLICIT)!

    type = ModifierType.Implicit
    generation = 'eldritch'

    switch (match.groups!.rank) {
      case _$.ELDRITCH_MOD_R1: rank = 1; break
      case _$.ELDRITCH_MOD_R2: rank = 2; break
      case _$.ELDRITCH_MOD_R3: rank = 3; break
      case _$.ELDRITCH_MOD_R4: rank = 4; break
      case _$.ELDRITCH_MOD_R5: rank = 5; break
      case _$.ELDRITCH_MOD_R6: rank = 6; break
    }
  } else {
    const match = modText.match(_$.MODIFIER_LINE)
    if (!match) {
      throw new Error('Invalid regex for mod info line')
    }

    switch (match.groups!.type) {
      case _$.IMPLICIT_MODIFIER:
      case _$.CORRUPTED_IMPLICIT:
        type = ModifierType.Implicit; break
      case _$.FRACTURED_PREFIX:
      case _$.FRACTURED_SUFFIX:
        type = ModifierType.Fractured; break
      case _$.CRAFTED_PREFIX:
      case _$.CRAFTED_SUFFIX:
        type = ModifierType.Crafted; break
    }

    switch (match.groups!.type) {
      case _$.PREFIX_MODIFIER:
      case _$.FRACTURED_PREFIX:
      case _$.CRAFTED_PREFIX:
        generation = 'prefix'; break
      case _$.SUFFIX_MODIFIER:
      case _$.FRACTURED_SUFFIX:
      case _$.CRAFTED_SUFFIX:
        generation = 'suffix'; break
      case _$.CORRUPTED_IMPLICIT:
        generation = 'corrupted'; break
      case _$.FOULBORN_MODIFIER:
        generation = 'foulborn'; break
    }

    name = match.groups!.name ?? undefined
    tier = Number(match.groups!.tier) || undefined
    rank = Number(match.groups!.rank) || undefined
  }

  let tags: ModifierInfo['tags']
  let rollIncr: ModifierInfo['rollIncr']
  {
    const incrText = (xText3 !== undefined)
      ? xText3
      : (xText2 !== undefined && _$.MODIFIER_INCREASED.test(xText2))
          ? xText2
          : undefined

    const tagsText = (xText2 !== undefined && incrText !== xText2)
      ? xText2
      : undefined

    // 上游是 `split(', ')`(逗號 + 空格)—— 那是英文的寫法。
    // 繁中用不帶空格的逗號(`防禦,護甲`),照上游切會整串黏成一個 tag。
    // 兩種都吃,順帶容忍全形逗號與頓號。
    tags = tagsText ? tagsText.split(/\s*[,，、]\s*/).filter(t => t.length > 0) : []
    rollIncr = incrText ? Number(_$.MODIFIER_INCREASED.exec(incrText)![1]) : undefined
  }

  return { type, generation, name, tier, rank, tags, rollIncr }
}

export function isModInfoLine (line: string): boolean {
  return line.startsWith('{') && line.endsWith('}')
}

interface GroupedModLines {
  modLine: string
  statLines: string[]
}

export function * groupLinesByMod (lines: string[]): Generator<GroupedModLines, void> {
  if (!lines.length || !isModInfoLine(lines[0])) {
    return
  }

  let last: GroupedModLines | undefined
  for (const line of lines) {
    if (!isModInfoLine(line)) {
      last!.statLines.push(line)
    } else {
      if (last) { yield last }
      last = { modLine: line, statLines: [] }
    }
  }
  yield last!
}

export function parseModType (lines: string[]): { modType: ModifierType, lines: string[] } {
  let modType: ModifierType
  if (lines.some(line => line.endsWith(SCOURGE_LINE))) {
    modType = ModifierType.Scourge
    lines = removeLinesEnding(lines, SCOURGE_LINE)
  } else if (lines.some(line => line.endsWith(ENCHANT_LINE))) {
    modType = ModifierType.Enchant
    lines = removeLinesEnding(lines, ENCHANT_LINE)
  } else if (lines.some(line => line.endsWith(IMPLICIT_LINE))) {
    modType = ModifierType.Implicit
    lines = removeLinesEnding(lines, IMPLICIT_LINE)
  } else {
    throw new Error('Expected to be used only on lines that have modifier type')
  }

  return { modType, lines }
}

function removeLinesEnding (
  lines: readonly string[], ending: string
): string[] {
  return lines.map(line =>
    line.endsWith(ending)
      ? line.slice(0, -ending.length)
      : line
  )
}

// stat values internally stored as ints,
// this is the most common formatter
const DIV_BY_100 = 2

export function applyIncr (mod: ModifierInfo, parsed: ParsedStat): ParsedStat | null {
  const { rollIncr } = mod
  const { roll } = parsed

  if (!rollIncr || !roll || roll.unscalable) {
    return null
  }

  return {
    stat: parsed.stat,
    translation: parsed.translation,
    roll: {
      unscalable: roll.unscalable,
      dp: roll.dp,
      value: incrRoll(roll.value, rollIncr, (roll.dp) ? DIV_BY_100 : 0),
      min: incrRoll(roll.min, rollIncr, (roll.dp) ? DIV_BY_100 : 0),
      max: incrRoll(roll.max, rollIncr, (roll.dp) ? DIV_BY_100 : 0)
    }
  }
}

export function incrRoll (
  value: number,
  p: number,
  dp: number
): number {
  const res = value + (value * p / 100)
  const rounding = Math.pow(10, dp)
  return Math.trunc((res + Number.EPSILON) * rounding) / rounding
}
