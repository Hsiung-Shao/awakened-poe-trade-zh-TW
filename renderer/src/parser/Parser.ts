import { Result, ok, err } from 'neverthrow'
import {
  CLIENT_STRINGS as _$,
  ITEM_BY_TRANSLATED,
  ITEM_BY_REF,
  STAT_BY_MATCH_STR,
  StatBetter,
  type BaseType
} from '@/assets/data'
import { ModifierType, sumStatsByModType } from './modifiers'
import { linesToStatStrings, tryParseTranslation, getRollOrMinmaxAvg } from './stat-translations'
import { ItemCategory, ACCESSORY } from './meta'
import { IncursionRoom, type ParsedItem, ItemInfluence, ItemRarity } from './ParsedItem'
import { magicBasetype } from './magic-name'
import { isModInfoLine, groupLinesByMod, parseModInfoLine, parseModType, type ModifierInfo, type ParsedModifier, ENCHANT_LINE, SCOURGE_LINE, IMPLICIT_LINE } from './advanced-mod-desc'
import { calcPropPercentile, QUALITY_STATS } from './calc-q20'

type SectionParseResult =
  | 'SECTION_PARSED'
  | 'SECTION_SKIPPED'
  | 'PARSER_SKIPPED'

type ParserFn = (section: string[], item: ParserState) => SectionParseResult
type VirtualParserFn = (item: ParserState) => Result<never, string> | void
/**
 * 能看到「目前為止沒有任何 parser 認領的 section」的處理階段。
 *
 * 上游沒有這個機制:section 若沒被認領就直接消失。但規格 §6.2 要求
 * 「未知資料不得靜默丟棄」,而實測繁中 corpus 裡確實有整段詞綴被丟掉的案例。
 * 可就地從 `sections` 移除已消化的項目。
 */
type LeftoverParserFn = (sections: string[][], item: ParserState) => void

interface ParserState extends ParsedItem {
  name: string
  baseType: string | undefined
  infoVariants: BaseType[]
}

const parsers: Array<
  ParserFn | { virtual: VirtualParserFn } | { leftovers: LeftoverParserFn }
> = [
  parseUnidentified,
  { virtual: parseSuperior },
  { virtual: parseFoulborn },
  { virtual: parseVestigial },
  parseSynthesised,
  parseCategoryByHelpText,
  { virtual: parseMapTier },
  { virtual: normalizeName },
  parseVaalGemName,
  { virtual: findInDatabase },
  // -----------
  parseItemLevel,
  parseTalismanTier,
  parseGem,
  parseArmour,
  parseWeapon,
  parseAccessory,
  parseFlask,
  parseTincture,
  parseStackSize,
  parseCorrupted,
  parseImbuedGem,
  parseFoil,
  parseInfluence,
  parseMap,
  parseSockets,
  parseHeistContract,
  parseHeistBlueprint,
  parseChart,
  parseAreaLevel,
  parseAtzoatlRooms,
  parseMirroredTablet,
  parseFilledCoffin,
  parseMirrored,
  parseSplit,
  parseSentinelCharge,
  parseLogbookArea,
  parseLogbookArea,
  parseLogbookArea,
  parseModifiers, // enchant
  parseModifiers, // scourge
  parseModifiers, // implicit
  parseModifiers, // explicit
  { leftovers: parseUnannotatedModifiers },
  { virtual: transformToLegacyModifiers },
  { virtual: parseFractured },
  { virtual: parseBlightedMap },
  { virtual: pickCorrectVariant },
  { virtual: calcBasePercentile }
]

export function parseClipboard (clipboard: string): Result<ParsedItem, string> {
  try {
    let sections = itemTextToSections(normalizeLabelPunctuation(clipboard))

    if (sections[0][2] === _$.CANNOT_USE_ITEM) {
      sections[0].pop() // remove CANNOT_USE_ITEM line
      sections[1].unshift(...sections[0]) // prepend item class & rarity into second section
      sections.shift() // remove first section where CANNOT_USE_ITEM line was
    }
    const parsed = parseNamePlate(sections[0])
    if (!parsed.isOk()) return parsed

    sections.shift()
    parsed.value.rawText = clipboard

    // each section can be parsed at most by one parser
    for (const parser of parsers) {
      if (typeof parser === 'object' && 'leftovers' in parser) {
        parser.leftovers(sections, parsed.value)
        continue
      }
      if (typeof parser === 'object') {
        const error = parser.virtual(parsed.value)
        if (error) return error
        continue
      }

      for (const section of sections) {
        const result = parser(section, parsed.value)
        if (result === 'SECTION_PARSED') {
          sections = sections.filter(s => s !== section)
          break
        } else if (result === 'PARSER_SKIPPED') {
          break
        }
      }
    }
    return Object.freeze(parsed)
  } catch (e) {
    // 上游只回一個沒有內容的 `item.parse_error`,並把例外丟進 console.log。
    // 結果是使用者只看得到「解析時發生錯誤」,連回報都不知道要附什麼
    // (上游 issue #1869 就卡在這裡)。把例外訊息帶進錯誤字串,
    // UI 的未知詞綴回報鈕才有東西可以附。
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return err(`item.parse_error: ${detail}`)
  }
}

/**
 * 行首標籤的標點正規化 —— **上游沒有這段**。
 *
 * `client_strings` 裡的分段標籤都是半形冒號加空格(`'物品種類: '`、`'護甲: '`),
 * 而 `parseNamePlate` 等處用 `line.startsWith(_$.ITEM_CLASS)` 精確比對。
 *
 * 但實測繁中客戶端存在**兩種標點慣例**:
 *
 *     物品種類: 手套     ← 半形冒號 + 空格(本專案 corpus 的樣本)
 *     物品種類：鞋子     ← 全形冒號、無空格(上游 issue #1869 的回報)
 *
 * 後者連第一行都比對不到,直接回 `item.parse_error` —— 那個 issue 至今未解,
 * 維護者宣稱修好但使用者持續回報。甚至同一份文字裡也會混用
 * (使用者的樣本中 `物品種類: ` 是半形而 `怪物等級：` 是全形)。
 *
 * 做法:從 `CLIENT_STRINGS` 自動導出每個標籤的全形寫法,只在**行首**做替換。
 * 刻意不做全文 `：` → `: ` 取代 —— 詞綴標註行裡的 `(階層：8)` 會被毀掉,
 * 而那個位置兩種客戶端本來就都是全形,不需要動。
 */
function normalizeLabelPunctuation (text: string): string {
  const dict = _$ as unknown as Record<string, unknown>
  /** 全形寫法 → 正規寫法。例:`物品種類：` → `物品種類: ` */
  const variants: Array<[string, string]> = []
  for (const key of Object.keys(dict)) {
    const value = dict[key]
    if (typeof value !== 'string') continue
    if (!value.endsWith(': ')) continue
    variants.push([value.slice(0, -2) + '：', value])
  }
  if (variants.length === 0) return text

  // 長的優先,避免短標籤先命中而截斷長標籤(「等級: 」vs「物品等級: 」)
  variants.sort((a, b) => b[0].length - a[0].length)

  return text.split('\n').map(line => {
    for (const [fullwidth, canonical] of variants) {
      if (line.startsWith(fullwidth)) {
        return canonical + line.slice(fullwidth.length)
      }
    }
    return line
  }).join('\n')
}

/**
 * 分隔線判定。
 *
 * ⚠ **這裡刻意偏離上游。** APT 的原始寫法是 `if (line !== '--------')`,嚴格比對
 * 8 個 dash。但實測繁體中文客戶端(國際服,3.29 Allflame)吐出的分隔線是**變長的**
 * —— 長度等於前一行的顯示寬度(CJK 字元算 2 欄)。實測樣本 260 條分隔線裡,
 * 258 條(99.2%)符合這個規律,只有 31 條剛好是 8 個 dash。
 *
 * 沿用上游寫法的話,整份物品文字會被當成單一 section,**每一件物品都解析失敗**。
 *
 * 改成「整行只有 3 個以上 dash」即視為分隔線,對 8-dash 與變長兩種格式都成立;
 * 物品文字裡不存在合法的純 dash 內容行,所以不會誤判。
 */
const SECTION_SEPARATOR = /^-{3,}$/

function itemTextToSections (text: string) {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }

  const sections: string[][] = [[]]
  lines.reduce((section, line) => {
    if (!SECTION_SEPARATOR.test(line)) {
      section.push(line)
      return section
    } else {
      const section: string[] = []
      sections.push(section)
      return section
    }
  }, sections[0]!)
  return sections.map(trimBlankEdges).filter(section => section.length)
}

/**
 * 剝除 section 前後的空行。
 *
 * ⚠ **這裡也偏離上游。** 進階格式在每條分隔線後面會多一個空行,於是 section 的
 * 第一行是空字串。大量 section parser 是用 `section[0] === _$.某欄位` 判斷的
 * (例如 `parseUnidentified` 比對「未鑑定」),空行會讓它們全部落空。
 *
 * 實例:未鑑定的傳奇地圖 —— `isUnidentified` 沒被設起來,於是走到
 * 「傳奇且已鑑定」的分支去 UNIQUE 命名空間查基底名,查不到就回 `item.unknown`。
 *
 * **只剝前後、不動內部空行**:沒有 `{ 前綴 … }` 標註的物品(例如破裂的腰帶)
 * 是靠內部空行分隔各條詞綴的,把它們一起清掉會讓多行詞綴黏成一條。
 */
function trimBlankEdges (section: string[]): string[] {
  let start = 0
  let end = section.length
  while (start < end && section[start]!.trim() === '') start += 1
  while (end > start && section[end - 1]!.trim() === '') end -= 1
  return section.slice(start, end)
}

function normalizeName (item: ParserState) {
  if (item.rarity === ItemRarity.Magic) {
    const baseType = magicBasetype(item.name)
    if (baseType) {
      item.name = baseType
    }
  }

  if (item.rarity === ItemRarity.Normal ||
      item.rarity === ItemRarity.Rare
  ) {
    if (item.baseType) {
      if (_$.MAP_BLIGHTED.test(item.baseType)) {
        item.baseType = _$.MAP_BLIGHTED.exec(item.baseType)![1]
      } else if (_$.MAP_BLIGHT_RAVAGED.test(item.baseType)) {
        item.baseType = _$.MAP_BLIGHT_RAVAGED.exec(item.baseType)![1]
      }
    } else {
      if (_$.MAP_BLIGHTED.test(item.name)) {
        item.name = _$.MAP_BLIGHTED.exec(item.name)![1]
      } else if (_$.MAP_BLIGHT_RAVAGED.test(item.name)) {
        item.name = _$.MAP_BLIGHT_RAVAGED.exec(item.name)![1]
      }
    }
  }

  if (item.category === ItemCategory.MetamorphSample) {
    if (_$.METAMORPH_BRAIN.test(item.name)) {
      item.name = 'Metamorph Brain'
    } else if (_$.METAMORPH_EYE.test(item.name)) {
      item.name = 'Metamorph Eye'
    } else if (_$.METAMORPH_LUNG.test(item.name)) {
      item.name = 'Metamorph Lung'
    } else if (_$.METAMORPH_HEART.test(item.name)) {
      item.name = 'Metamorph Heart'
    } else if (_$.METAMORPH_LIVER.test(item.name)) {
      item.name = 'Metamorph Liver'
    }
  }
}

function findInDatabase (item: ParserState) {
  let info: BaseType[] | undefined
  if (item.category === ItemCategory.DivinationCard) {
    info = ITEM_BY_TRANSLATED('DIVINATION_CARD', item.name)
  } else if (item.category === ItemCategory.CapturedBeast) {
    info = ITEM_BY_TRANSLATED('CAPTURED_BEAST', item.baseType ?? item.name)
  } else if (item.category === ItemCategory.Gem) {
    info = ITEM_BY_TRANSLATED('GEM', item.name)
  } else if (item.category === ItemCategory.MetamorphSample) {
    info = ITEM_BY_TRANSLATED('ITEM', item.name)
  } else if (item.category === ItemCategory.Voidstone) {
    info = ITEM_BY_REF('ITEM', 'Charged Compass')
  } else if (item.rarity === ItemRarity.Unique && !item.isUnidentified) {
    info = ITEM_BY_TRANSLATED('UNIQUE', item.name)
  } else {
    info = ITEM_BY_TRANSLATED('ITEM', item.baseType ?? item.name)
  }
  if (!info?.length) {
    return err('item.unknown')
  }
  if (info[0].unique) {
    const baseTypes = ITEM_BY_TRANSLATED('ITEM', item.baseType!)
    if (!baseTypes?.length) return err('item.unknown')

    // 上游只看 `baseTypes[0].refName`,但**一個顯示名可以對到多個英文底材**:
    // 繁中的「狼王魔符」同時是 `Greatwolf Talisman`(舊版譯名)與
    // `Wolf Alpha Talisman`(瑞佛詛咒的底材)。取第一個的話,瑞佛詛咒會被
    // 過濾成空陣列 → 整件解析失敗。改成比對**所有**候選。
    const baseTypeRefs = new Set(baseTypes.map(base => base.refName))
    const matched = info.filter(candidate => baseTypeRefs.has(candidate.unique!.base))
    // 上游也沒有檢查這裡是否濾空。濾空時 `info[0]` 是 undefined,錯誤會延後到下面的
    // `item.info.craftable` 才爆成看不懂的 TypeError。回報 item.unknown 才是
    // 誠實的結果 —— 「查不到這件物品」,而不是「程式壞了」。
    if (!matched.length) return err('item.unknown')
    info = matched

    // 記住實際對上的那一列底材。反過來也成立:**一個英文底材可以有兩個中文名**
    // (`Greatwolf Talisman` = 狼王魔符 / 巨狼魔符),而查詢要送的是物品身上那一個。
    item.baseTypeInfo = baseTypes.find(base => base.refName === matched[0].unique!.base)
  }
  item.infoVariants = info
  // choose 1st variant, correct one will be picked at the end of parsing
  item.info = info[0]
  // same for every variant
  if (!item.category) {
    if (item.info.craftable) {
      item.category = item.info.craftable.category
    } else if (item.info.unique) {
      item.category = ITEM_BY_REF('ITEM',
        item.info.unique.base)![0].craftable!.category
    }
  }
  // noImplicitReturns:此函式在失敗時回 err(...),成功則回 undefined。
  // 原本靠隱含 undefined,這裡寫明,行為不變。
  return undefined
}

function parseMapTier (item: ParserState) {
  const execResult = _$.MAP_TIER.exec(item.baseType || item.name)
  if (!execResult) return

  item.map = {
    tier: Number(execResult[1])
  }

  if (item.baseType) {
    item.baseType = item.baseType.replace(execResult[0], '')
  } else {
    item.name = item.name.replace(execResult[0], '')
  }
}

function parseMap (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Map) return 'PARSER_SKIPPED'

  if (!item.map) {
    item.map = { tier: undefined }
  }

  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.MAP_ITEM_QUANTITY)) {
      item.map.itemQuantity = parseInt(line.slice(_$.MAP_ITEM_QUANTITY.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_ITEM_RARITY)) {
      item.map.itemRarity = parseInt(line.slice(_$.MAP_ITEM_RARITY.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MONSTER_PACK_SIZE)) {
      item.map.packSize = parseInt(line.slice(_$.MAP_MONSTER_PACK_SIZE.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_MAPS)) {
      item.map.moreMaps = parseInt(line.slice(_$.MAP_MORE_MAPS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_SCARABS)) {
      item.map.moreScarabs = parseInt(line.slice(_$.MAP_MORE_SCARABS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_CURRENCY)) {
      item.map.moreCurrency = parseInt(line.slice(_$.MAP_MORE_CURRENCY.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (line.startsWith(_$.MAP_MORE_DIVINATION_CARDS)) {
      item.map.moreDivCards = parseInt(line.slice(_$.MAP_MORE_DIVINATION_CARDS.length), 10)
      isParsed = 'SECTION_PARSED'
    } else if (_$.MAP_COMPLETION_REWARD.test(line)) {
      item.mapCompletionReward = _$.MAP_COMPLETION_REWARD.exec(line)![1]
      isParsed = 'SECTION_PARSED'
    }
  }

  return isParsed
}

function parseBlightedMap (item: ParsedItem) {
  if (item.category !== ItemCategory.Map) return

  const calc = item.statsByType.find(calc =>
    calc.type === ModifierType.Implicit &&
    calc.stat.ref.startsWith('Area is infested with Fungal Growths'))
  if (calc !== undefined) {
    if (calc.sources[0].contributes!.value === 9) {
      item.mapBlighted = 'Blight-ravaged'
      item.info.icon = ITEM_BY_REF('ITEM', 'Blight-ravaged Map')![0].icon
    } else {
      item.mapBlighted = 'Blighted'
      item.info.icon = ITEM_BY_REF('ITEM', 'Blighted Map')![0].icon
    }
  }
}

function parseFractured (item: ParserState) {
  if (item.newMods.some(mod => mod.info.type === ModifierType.Fractured)) {
    item.isFractured = true
  }
}

function pickCorrectVariant (item: ParserState) {
  if (!item.info.disc) return

  for (const variant of item.infoVariants) {
    const cond = variant.disc!

    if (cond.propAR && !item.armourAR) continue
    if (cond.propEV && !item.armourEV) continue
    if (cond.propES && !item.armourES) continue

    if (cond.mapTier) {
      if (!item.map?.tier) continue
      if (cond.mapTier === 'W' && !(item.map.tier <= 5)) continue
      if (cond.mapTier === 'Y' && !(item.map.tier >= 6 && item.map.tier <= 10)) continue
      if (cond.mapTier === 'R' && !(item.map.tier >= 11)) continue
    }

    if (cond.hasImplicit && !item.statsByType.some(calc =>
      calc.type === ModifierType.Implicit &&
      calc.stat.ref === cond.hasImplicit!.ref)
    ) continue

    if (cond.hasExplicit && !item.statsByType.some(calc =>
      calc.type === ModifierType.Explicit &&
      calc.stat.ref === cond.hasExplicit!.ref)
    ) continue

    if (cond.sectionText && !item.rawText.includes(cond.sectionText)) continue

    item.info = variant
  }

  // it may happen that we don't find correct variant
  // i.e. corrupted implicit on Two-Stone Ring
}

function parseNamePlate (section: string[]) {
  let line = section.shift()
  if (!line?.startsWith(_$.ITEM_CLASS)) {
    return err('item.parse_error')
  }

  line = section.shift()
  let rarityText: string | undefined
  if (line?.startsWith(_$.RARITY)) {
    rarityText = line.slice(_$.RARITY.length)
    line = section.shift()
  }

  let name: string
  if (line != null) {
    name = markupConditionParser(line)
  } else {
    return err('item.parse_error')
  }

  line = section.shift()
  const baseType = line && markupConditionParser(line)

  const item: ParserState = {
    rarity: undefined,
    category: undefined,
    name: name,
    baseType: baseType,
    isUnidentified: false,
    isCorrupted: false,
    newMods: [],
    statsByType: [],
    unknownModifiers: [],
    influences: [],
    info: undefined!,
    infoVariants: undefined!,
    rawText: undefined!
  }

  switch (rarityText) {
    case _$.RARITY_CURRENCY:
      item.category = ItemCategory.Currency; break
    case _$.RARITY_DIVCARD:
      item.category = ItemCategory.DivinationCard; break
    case _$.RARITY_GEM:
      item.category = ItemCategory.Gem; break
    case _$.RARITY_NORMAL:
    case _$.RARITY_QUEST:
      item.rarity = ItemRarity.Normal; break
    case _$.RARITY_MAGIC:
      item.rarity = ItemRarity.Magic; break
    case _$.RARITY_RARE:
      item.rarity = ItemRarity.Rare; break
    case _$.RARITY_UNIQUE:
      item.rarity = ItemRarity.Unique; break
  }

  return ok(item)
}

function parseInfluence (section: string[], item: ParsedItem) {
  if (section.length <= 2) {
    const countBefore = item.influences.length

    for (const line of section) {
      switch (line) {
        case _$.INFLUENCE_CRUSADER:
          item.influences.push(ItemInfluence.Crusader)
          break
        case _$.INFLUENCE_ELDER:
          item.influences.push(ItemInfluence.Elder)
          break
        case _$.INFLUENCE_SHAPER:
          item.influences.push(ItemInfluence.Shaper)
          break
        case _$.INFLUENCE_HUNTER:
          item.influences.push(ItemInfluence.Hunter)
          break
        case _$.INFLUENCE_REDEEMER:
          item.influences.push(ItemInfluence.Redeemer)
          break
        case _$.INFLUENCE_WARLORD:
          item.influences.push(ItemInfluence.Warlord)
          break
      }
    }

    if (countBefore < item.influences.length) {
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseCorrupted (section: string[], item: ParsedItem) {
  if (section[0] === _$.CORRUPTED) {
    item.isCorrupted = true
    return 'SECTION_PARSED'
  } else if (section[0] === _$.UNMODIFIABLE) {
    item.isCorrupted = true
    item.isUnmodifiable = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseFoil (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Unique) {
    return 'PARSER_SKIPPED'
  }
  if (section[0] === _$.FOIL_UNIQUE) {
    item.isFoil = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseUnidentified (section: string[], item: ParsedItem) {
  if (section[0] === _$.UNIDENTIFIED) {
    item.isUnidentified = true
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseItemLevel (section: string[], item: ParsedItem) {
  let prefix = _$.ITEM_LEVEL
  if (item.info.refName === 'Filled Coffin') {
    prefix = _$.CORPSE_LEVEL
  }

  for (const line of section) {
    if (line.startsWith(prefix)) {
      item.itemLevel = Number(line.slice(prefix.length))
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseTalismanTier (section: string[], item: ParsedItem) {
  if (section[0].startsWith(_$.TALISMAN_TIER)) {
    item.talismanTier = Number(section[0].slice(_$.TALISMAN_TIER.length))
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseVaalGemName (section: string[], item: ParserState) {
  if (item.category !== ItemCategory.Gem) return 'PARSER_SKIPPED'

  // TODO blocked by https://www.pathofexile.com/forum/view-thread/3231236
  if (section.length === 1) {
    let gemName: string | undefined
    if (ITEM_BY_TRANSLATED('GEM', section[0])) {
      gemName = section[0]
    }
    if (gemName) {
      // 上游寫的是 `.refName`(英文),但下游 `findInDatabase` 對 GEM 走的是
      // `ITEM_BY_TRANSLATED` —— 拿英文去查翻譯名,在英文以外的語系必然落空,
      // 整件瓦爾寶石解析失敗。英文資料集 `name === refName`,所以寫回翻譯名
      // 對 en 是逐字相同的行為。
      item.name = ITEM_BY_TRANSLATED('GEM', gemName)![0].name
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseGem (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Gem) {
    return 'PARSER_SKIPPED'
  }
  if (section[1]?.startsWith(_$.GEM_LEVEL)) {
    // "Level: 20 (Max)"
    item.gemLevel = parseInt(section[1].slice(_$.GEM_LEVEL.length), 10)

    parseQualityNested(section, item)

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseImbuedGem (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Gem) return 'PARSER_SKIPPED'

  if (section.length === 1) {
    const support = STAT_BY_MATCH_STR(section[0])
    if (!support) return 'SECTION_SKIPPED'

    item.newMods.push({
      info: { tags: [], type: ModifierType.Imbued },
      stats: [{
        stat: support.stat,
        translation: support.matcher
      }]
    })
    item.imbuedGem = true

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseStackSize (section: string[], item: ParsedItem) {
  if (item.rarity !== ItemRarity.Normal &&
      item.category !== ItemCategory.Currency &&
      item.category !== ItemCategory.DivinationCard) {
    return 'PARSER_SKIPPED'
  }
  if (section[0].startsWith(_$.STACK_SIZE)) {
    // Portal Scroll "Stack Size: 2[localized separator]448/40"
    const [value, max] = section[0].slice(_$.STACK_SIZE.length).replace(/[^\d/]/g, '').split('/').map(Number)
    item.stackSize = { value, max }

    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseSockets (section: string[], item: ParsedItem) {
  if (section[0].startsWith(_$.SOCKETS)) {
    let sockets = section[0].slice(_$.SOCKETS.length).trimEnd()

    item.sockets = {
      white: (sockets.split('W').length - 1),
      linked: undefined
    }

    sockets = sockets.replace(/[^ -]/g, '#')
    if (sockets === '#-#-#-#-#-#') {
      item.sockets.linked = 6
    } else if (
      sockets === '# #-#-#-#-#' ||
      sockets === '#-#-#-#-# #' ||
      sockets === '#-#-#-#-#'
    ) {
      item.sockets.linked = 5
    }
    return 'SECTION_PARSED'
  }
  return 'SECTION_SKIPPED'
}

function parseQualityNested (section: string[], item: ParsedItem): boolean {
  for (const line of section) {
    if (line.startsWith(_$.QUALITY)) {
      // "Quality: +20% (augmented)"
      item.quality = parseInt(line.slice(_$.QUALITY.length), 10)
      return true
    }
  }
  return false
}

function parseMemoryStrandsNested (section: string[], item: ParsedItem): boolean {
  for (const line of section) {
    if (line.startsWith(_$.MEMORY_STRANDS)) {
      item.memoryStrands = parseInt(line.slice(_$.MEMORY_STRANDS.length), 10)
      return true
    }
  }
  return false
}

function parseArmour (section: string[], item: ParsedItem) {
  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.ARMOUR)) {
      item.armourAR = parseInt(line.slice(_$.ARMOUR.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.EVASION)) {
      item.armourEV = parseInt(line.slice(_$.EVASION.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ENERGY_SHIELD)) {
      item.armourES = parseInt(line.slice(_$.ENERGY_SHIELD.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.TAG_WARD)) {
      item.armourWARD = parseInt(line.slice(_$.TAG_WARD.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.BLOCK_CHANCE)) {
      item.armourBLOCK = parseInt(line.slice(_$.BLOCK_CHANCE.length), 10)
      isParsed = 'SECTION_PARSED'; continue
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
    parseMemoryStrandsNested(section, item)
  }

  return isParsed
}

function parseWeapon (section: string[], item: ParsedItem) {
  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (line.startsWith(_$.CRIT_CHANCE)) {
      item.weaponCRIT = parseFloat(line.slice(_$.CRIT_CHANCE.length))
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ATTACK_SPEED)) {
      item.weaponAS = parseFloat(line.slice(_$.ATTACK_SPEED.length))
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.PHYSICAL_DAMAGE)) {
      item.weaponPHYSICAL = getRollOrMinmaxAvg(line
        .slice(_$.PHYSICAL_DAMAGE.length)
        .split('-').map(str => parseInt(str, 10))
      )
      isParsed = 'SECTION_PARSED'; continue
    }
    if (line.startsWith(_$.ELEMENTAL_DAMAGE)) {
      item.weaponELEMENTAL =
        line.slice(_$.ELEMENTAL_DAMAGE.length)
          .split(', ')
          .map(element => getRollOrMinmaxAvg(element.split('-').map(str => parseInt(str, 10))))
          .reduce((sum, x) => sum + x, 0)

      isParsed = 'SECTION_PARSED'; continue
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
    parseMemoryStrandsNested(section, item)
  }

  return isParsed
}

function parseAccessory (section: string[], item: ParsedItem) {
  if (!item.category || !ACCESSORY.has(item.category)) return 'PARSER_SKIPPED'

  if (parseMemoryStrandsNested(section, item)) {
    return 'SECTION_PARSED'
  }

  return 'SECTION_SKIPPED'
}

function parseLogbookArea (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Expedition Logbook') return 'PARSER_SKIPPED'
  if (section.length < 3) return 'SECTION_SKIPPED'

  // skip Logbook Area line, parse Faction
  const faction = STAT_BY_MATCH_STR(section[1])
  if (!faction || !faction.stat.ref.startsWith('Has Logbook Faction:')) return 'SECTION_SKIPPED'

  const areaMods: ParsedModifier[] = [{
    info: { tags: [], type: ModifierType.Pseudo },
    stats: [{
      stat: faction.stat,
      translation: faction.matcher
    }]
  }]

  const { modType, lines } = parseModType(section.slice(2))
  for (const line of lines) {
    const found = STAT_BY_MATCH_STR(line)
    // Area contains an Expedition Boss (#)
    if (found && found.stat.better === StatBetter.NotComparable) {
      areaMods.push({
        info: { tags: [], type: modType },
        stats: [{
          stat: found.stat,
          translation: found.matcher
        }]
      })
    }
  }

  if (!item.logbookAreaMods) {
    item.logbookAreaMods = [areaMods]
  } else {
    item.logbookAreaMods.push(areaMods)
  }

  return 'SECTION_PARSED'
}

function parseModifiers (section: string[], item: ParsedItem) {
  if (
    item.rarity !== ItemRarity.Normal &&
    item.rarity !== ItemRarity.Magic &&
    item.rarity !== ItemRarity.Rare &&
    item.rarity !== ItemRarity.Unique
  ) {
    return 'PARSER_SKIPPED'
  }

  const recognizedLine = section.find(line =>
    line.endsWith(ENCHANT_LINE) ||
    line.endsWith(SCOURGE_LINE) ||
    isModInfoLine(line)
  )

  if (!recognizedLine) {
    return 'SECTION_SKIPPED'
  }

  if (isModInfoLine(recognizedLine)) {
    for (const { modLine, statLines } of groupLinesByMod(section)) {
      const modInfo = parseModInfoLine(modLine)
      if (statLines[0] === _$.VEILED_PREFIX || statLines[0] === _$.VEILED_SUFFIX) {
        modInfo.type = ModifierType.Veiled
        item.isVeiled = true
      }
      parseStatsFromMod(statLines, item, { info: modInfo, stats: [] })
    }
  } else {
    const { modType, lines } = parseModType(section)
    const modInfo: ModifierInfo = {
      type: modType,
      tags: []
    }
    parseStatsFromMod(lines, item, { info: modInfo, stats: [] })
  }

  return 'SECTION_PARSED'
}

function parseMirrored (section: string[], item: ParsedItem) {
  if (section.length === 1) {
    if (section[0] === _$.MIRRORED) {
      item.isMirrored = true
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseSplit (section: string[], item: ParsedItem) {
  if (section.length === 1) {
    if (section[0] === _$.SPLIT) {
      item.isSplit = true
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseFlask (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Flask) return 'PARSER_SKIPPED'

  // the purpose of this parser is to "consume" flask buffs
  // so they are not recognized as modifiers

  let isParsed: SectionParseResult = 'SECTION_SKIPPED'

  for (const line of section) {
    if (_$.FLASK_CHARGES.test(line)) {
      isParsed = 'SECTION_PARSED'; break
    }
  }

  if (isParsed === 'SECTION_PARSED') {
    parseQualityNested(section, item)
  }

  return isParsed
}

function parseTincture (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Tincture) return 'PARSER_SKIPPED'

  if (parseQualityNested(section, item)) {
    return 'SECTION_PARSED'
  }

  return 'SECTION_SKIPPED'
}

function parseSentinelCharge (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Sentinel) return 'PARSER_SKIPPED'

  if (section.length === 1) {
    if (section[0].startsWith(_$.SENTINEL_CHARGE)) {
      item.sentinelCharge = parseInt(section[0].slice(_$.SENTINEL_CHARGE.length), 10)
      return 'SECTION_PARSED'
    }
  }
  return 'SECTION_SKIPPED'
}

function parseSynthesised (section: string[], item: ParserState) {
  if (section.length === 1) {
    if (section[0] === _$.SECTION_SYNTHESISED) {
      item.isSynthesised = true
      if (item.baseType) {
        item.baseType = _$.ITEM_SYNTHESISED.exec(item.baseType)![1]
      } else {
        item.name = _$.ITEM_SYNTHESISED.exec(item.name)![1]
      }
      return 'SECTION_PARSED'
    }
  }

  return 'SECTION_SKIPPED'
}

function parseSuperior (item: ParserState) {
  if (
    (item.rarity === ItemRarity.Normal) ||
    (item.rarity === ItemRarity.Magic && item.isUnidentified) ||
    (item.rarity === ItemRarity.Rare && item.isUnidentified) ||
    (item.rarity === ItemRarity.Unique && item.isUnidentified)
  ) {
    if (_$.ITEM_SUPERIOR.test(item.name)) {
      item.name = _$.ITEM_SUPERIOR.exec(item.name)![1]
    }
  }
}

function parseFoulborn (item: ParserState) {
  if (item.rarity !== ItemRarity.Unique || item.isUnidentified) return

  if (_$.FOULBORN_NAME.test(item.name)) {
    item.name = _$.FOULBORN_NAME.exec(item.name)![1]
    item.isFoulborn = true
  }
}

/**
 * 3.29 軍團機制「殘存」(Vestigial)。籠罩晶石作用於傳奇護甲後,遊戲在**底材那一行**
 * 前面加一個裝飾詞:
 *
 *     毀面者
 *     殘存 扣環護手        ← `ITEM_BY_TRANSLATED('ITEM', …)` 查不到,整件解析失敗
 *
 * 剝的是 `baseType` 不是 `name`(與 `parseFoulborn` 相反,Foulborn 裝飾的是傳奇名),
 * 但仍照 `parseSynthesised` 的寫法留 `name` 的退路 —— 沒有底材那一行的物品也能處理。
 *
 * ⚠ 這**不是**繁中專屬的缺陷:英文的 `Vestigial Strapped Mitts` 在 en 資料集同樣查無,
 * 上游只是還沒遇到。`ru` / `ko` 沒有可信譯名,`VESTIGIAL_NAME` 在那兩個語系不存在,
 * 此函式直接跳過,行為與加這段之前一模一樣。
 */
function parseVestigial (item: ParserState) {
  const re = _$.VESTIGIAL_NAME
  if (!re) return

  if (item.baseType) {
    if (!re.test(item.baseType)) return
    item.baseType = re.exec(item.baseType)![1]
  } else {
    if (!re.test(item.name)) return
    item.name = re.exec(item.name)![1]
  }
  item.isVestigial = true
}

function parseCategoryByHelpText (section: string[], item: ParsedItem) {
  if (section[0] === _$.BEAST_HELP) {
    item.category = ItemCategory.CapturedBeast
    return 'SECTION_PARSED'
  } else if (section[0] === _$.METAMORPH_HELP) {
    item.category = ItemCategory.MetamorphSample
    return 'SECTION_PARSED'
  } else if (section[0] === _$.VOIDSTONE_HELP) {
    item.category = ItemCategory.Voidstone
    return 'SECTION_PARSED'
  }

  return 'SECTION_SKIPPED'
}

function parseHeistContract (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.HeistContract) return 'PARSER_SKIPPED'

  parseAreaLevelNested(section, item)
  if (!item.areaLevel) {
    return 'SECTION_SKIPPED'
  }

  item.heistContract = {}

  for (const line of section) {
    const jobMatch = line.match(_$.HEIST_CONTRACT_JOB)
    if (jobMatch) {
      switch (jobMatch.groups!.job) {
        case _$.HEIST_JOB_LOCKPICKING:
          item.heistContract.requiredJob = 'Lockpicking'; break
        case _$.HEIST_JOB_BRUTEFORCE:
          item.heistContract.requiredJob = 'Brute Force'; break
        case _$.HEIST_JOB_PERCEPTION:
          item.heistContract.requiredJob = 'Perception'; break
        case _$.HEIST_JOB_DEMOLITION:
          item.heistContract.requiredJob = 'Demolition'; break
        case _$.HEIST_JOB_COUNTERTHAUMATURGY:
          item.heistContract.requiredJob = 'Counter-Thaumaturgy'; break
        case _$.HEIST_JOB_TRAPDISARMAMENT:
          item.heistContract.requiredJob = 'Trap Disarmament'; break
        case _$.HEIST_JOB_AGILITY:
          item.heistContract.requiredJob = 'Agility'; break
        case _$.HEIST_JOB_DECEPTION:
          item.heistContract.requiredJob = 'Deception'; break
        case _$.HEIST_JOB_ENGINEERING:
          item.heistContract.requiredJob = 'Engineering'; break
      }
      item.heistContract.jobLevel = Number(jobMatch.groups!.level)
      continue
    }

    const targetMatch = line.match(_$.HEIST_CONTRACT_TARGET)
    if (targetMatch) {
      if (targetMatch[1] === _$.HEIST_TARGET_PRICELESS) {
        item.heistContract.targetValue = 'Priceless'
      }
      continue
    }
  }

  return 'SECTION_PARSED'
}

function parseHeistBlueprint (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.HeistBlueprint) return 'PARSER_SKIPPED'

  parseAreaLevelNested(section, item)
  if (!item.areaLevel) {
    return 'SECTION_SKIPPED'
  }

  item.heistBlueprint = {}

  for (const line of section) {
    if (line.startsWith(_$.HEIST_BLUEPRINT_TARGET)) {
      const targetText = line.slice(_$.HEIST_BLUEPRINT_TARGET.length)
      switch (targetText) {
        case _$.HEIST_BLUEPRINT_ENCHANTS:
          item.heistBlueprint.target = 'Enchants'; break
        case _$.HEIST_BLUEPRINT_GEMS:
          item.heistBlueprint.target = 'Gems'; break
        case _$.HEIST_BLUEPRINT_REPLICAS:
          item.heistBlueprint.target = 'Replicas'; break
        case _$.HEIST_BLUEPRINT_TRINKETS:
          item.heistBlueprint.target = 'Trinkets'; break
      }
    } else if (line.startsWith(_$.HEIST_WINGS_REVEALED)) {
      item.heistBlueprint.wingsRevealed = parseInt(line.slice(_$.HEIST_WINGS_REVEALED.length), 10)
    }
  }

  return 'SECTION_PARSED'
}

/**
 * 海圖(Chart)—— 3.29 Allflame 聯盟的新物品類別。
 *
 * 取自上游**尚未合併**的 PR #1884(closes #1872):
 *   https://github.com/SnosMe/awakened-poe-trade/pull/1884
 * 該 PR 於 2026-07-28 被關閉但 `merged: false`,所以上游至今不支援海圖 ——
 * master 最新的 `18a401e`(2026-07-27)與已發布的 v3.29.102 裡都沒有這三個基底。
 *
 * 這正是規格 §3.2 說的「新增物品類別」:每季幾乎必定發生、影響**程式碼**、
 * 永遠無法自動化。所以它需要的是三樣東西一起到位 ——
 * `ItemCategory.Chart`(meta.ts)、這支 section parser、以及 items/stats 的資料列。
 */
function parseChart (section: string[], item: ParsedItem) {
  if (item.category !== ItemCategory.Chart) return 'PARSER_SKIPPED'

  parseAreaLevelNested(section, item)
  if (!item.areaLevel) {
    return 'SECTION_SKIPPED'
  }

  // 海圖詞綴給的獎勵是彙總在同一個 section 裡的,而且沿用地圖的屬性行字串
  if (!item.map) {
    item.map = { tier: undefined }
  }
  for (const line of section) {
    if (line.startsWith(_$.MAP_ITEM_QUANTITY)) {
      item.map.itemQuantity = parseInt(line.slice(_$.MAP_ITEM_QUANTITY.length), 10)
    } else if (line.startsWith(_$.MAP_ITEM_RARITY)) {
      item.map.itemRarity = parseInt(line.slice(_$.MAP_ITEM_RARITY.length), 10)
    } else if (line.startsWith(_$.MAP_MONSTER_PACK_SIZE)) {
      item.map.packSize = parseInt(line.slice(_$.MAP_MONSTER_PACK_SIZE.length), 10)
    }
  }

  return 'SECTION_PARSED'
}

/**
 * 區域等級的標籤 —— **上游只認一種寫法,這裡兩種都認。**
 *
 * 英文只有一個 `Area Level: `,但繁中客戶端**用了兩個不同的詞來翻它**:
 *
 *   地區等級:    藍圖、契約書、探險日誌(Heist / Expedition 系)
 *   區域等級:    海圖、聖域研究
 *
 * `client_strings` 只收了前者,所以海圖與聖域研究的 `areaLevel` 永遠是 undefined ——
 * 海圖甚至因此讓 `parseChart` 一開始就 return,整段獎勵屬性跟著遺失。
 *
 * 第二種寫法放在資料檔的 `AREA_LEVEL_ALT`(規格 §3.4:parser 程式碼內不得有中文
 * 字面量,措辭一律留在資料層)。沒有第二種寫法的語系不必提供該欄位。
 */
function areaLevelLabels (): string[] {
  const labels = [_$.AREA_LEVEL]
  if (_$.AREA_LEVEL_ALT !== undefined && _$.AREA_LEVEL_ALT.length > 0) {
    labels.push(_$.AREA_LEVEL_ALT)
  }
  return labels
}

function parseAreaLevelNested (section: string[], item: ParsedItem) {
  for (const line of section) {
    for (const label of areaLevelLabels()) {
      if (line.startsWith(label)) {
        item.areaLevel = Number(line.slice(label.length))
        return
      }
    }
  }
}

function parseAreaLevel (section: string[], item: ParsedItem) {
  if (
    item.info.refName !== 'Chronicle of Atzoatl' &&
    item.info.refName !== 'Expedition Logbook' &&
    item.info.refName !== 'Mirrored Tablet' &&
    item.info.refName !== 'Forbidden Tome' &&
    // 海圖由 parseChart 處理,但它若因故沒認領到 section,這裡當備援
    item.category !== ItemCategory.Chart
  ) return 'PARSER_SKIPPED'

  parseAreaLevelNested(section, item)

  return (item.areaLevel)
    ? 'SECTION_PARSED'
    : 'SECTION_SKIPPED'
}

function parseAtzoatlRooms (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Chronicle of Atzoatl') return 'PARSER_SKIPPED'
  if (section[0] !== _$.INCURSION_OPEN) return 'SECTION_SKIPPED'

  let state = IncursionRoom.Open
  for (const line of section.slice(1)) {
    if (line === _$.INCURSION_OBSTRUCTED) {
      state = IncursionRoom.Obstructed
      continue
    }

    const found = STAT_BY_MATCH_STR(line)
    if (found) {
      item.newMods.push({
        info: { tags: [], type: ModifierType.Pseudo },
        stats: [{
          stat: found.stat,
          translation: {
            string: (state === IncursionRoom.Open)
              ? found.matcher.string
              : `${_$.INCURSION_OBSTRUCTED} ${found.matcher.string}`
          },
          roll: { value: state, min: state, max: state, dp: false, unscalable: true }
        }]
      })
    } else {
      item.unknownModifiers.push({
        text: line,
        type: ModifierType.Pseudo
      })
    }
  }

  return 'SECTION_PARSED'
}

function parseMirroredTablet (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Mirrored Tablet') return 'PARSER_SKIPPED'
  if (section.length < 8) return 'SECTION_SKIPPED'

  for (const line of section) {
    const found = tryParseTranslation({ string: line, unscalable: true }, ModifierType.Pseudo, undefined)
    if (found) {
      item.newMods.push({
        info: { tags: [], type: ModifierType.Pseudo },
        stats: [found]
      })
    } else {
      item.unknownModifiers.push({
        text: line,
        type: ModifierType.Pseudo
      })
    }
  }

  return 'SECTION_PARSED'
}

function parseFilledCoffin (section: string[], item: ParsedItem) {
  if (item.info.refName !== 'Filled Coffin') return 'PARSER_SKIPPED'
  if (!section.some(line => line.endsWith(IMPLICIT_LINE))) return 'SECTION_SKIPPED'

  const { lines } = parseModType(section)
  const modInfo: ModifierInfo = {
    type: ModifierType.Necropolis,
    tags: []
  }
  parseStatsFromMod(lines, item, { info: modInfo, stats: [] })

  return 'SECTION_PARSED'
}

function markupConditionParser (text: string) {
  // ignores state set by <<set:__>>
  // always evaluates first condition to true <if:__>{...}
  // full markup: https://gist.github.com/SnosMe/151549b532df8ea08025a76ae2920ca4

  text = text.replace(/<<set:.+?>>/g, '')
  text = text.replace(/<(if:.+?|elif:.+?|else)>{(.+?)}/g, (_, type: string, body: string) => {
    return type.startsWith('if:')
      ? body
      : ''
  })

  return text
}

/**
 * 沒有 `{ … }` 標註的詞綴區塊 —— **上游沒有這段,是本專案新增的**。
 *
 * `parseModifiers` 只認三種標記:`{ 前綴 "…"(階層:N) }` 標註行、` (enchant)`、
 * ` (scourge)`。都沒有的 section 直接 `SECTION_SKIPPED`,而未被任何 parser 認領
 * 的 section 會在 pipeline 結束後**無聲消失**。
 *
 * 實測繁中 corpus 裡兩種形態同時存在:
 *   - 胸甲、法杖、手套的詞綴**有**標註
 *   - 腰帶、藥劑的詞綴**沒有**標註(但一樣帶 `(min-max)` roll 區間)
 *   - 一般 implicit(非異界/亡焰那種)一律沒有標註
 *
 * 於是破裂腰帶整整 7 條詞綴、法杖的 implicit 全部被丟掉,而且
 * `unknownModifiers` 是空的 —— 使用者完全看不出東西掉了。規格 §6.2 明令禁止。
 *
 * 型別判定規則(可由 corpus 回測):
 *   - 已經解析到帶標註的詞綴 → 剩下的 mod-like section 是 implicit
 *     (標註只出現在詞綴上,implicit 不會有)
 *   - 完全沒有帶標註的詞綴 → 有兩段以上時第一段是 implicit,其餘 explicit;
 *     只有一段就全部視為 explicit
 */
function parseUnannotatedModifiers (sections: string[][], item: ParserState): void {
  if (
    item.rarity !== ItemRarity.Normal &&
    item.rarity !== ItemRarity.Magic &&
    item.rarity !== ItemRarity.Rare &&
    item.rarity !== ItemRarity.Unique
  ) return

  const modLike = sections.filter(section => countRecognizedStats(section, item) > 0)
  if (modLike.length === 0) return

  // 只有真的來自 `{ 前綴 "…"(階層:N) }` 的詞綴才算「已標註」——
  // 它們一定帶 name 或 tier。`(enchant)` / `(scourge)` 雖然也被 parseModifiers 認得,
  // 但那不是詞綴標註,把它算進來會讓藥劑的詞綴被誤判成 implicit,
  // 而 `tryParseTranslation` 對 implicit 查不到那些 stat(trade.ids 沒有 implicit 這個鍵),
  // 結果整條掉進 unknownModifiers。
  const hasAnnotatedMods = item.newMods.some(
    mod => mod.info.name !== undefined || mod.info.tier !== undefined)

  modLike.forEach((section, index) => {
    const type = hasAnnotatedMods
      ? ModifierType.Implicit
      : (modLike.length >= 2 && index === 0)
          ? ModifierType.Implicit
          : ModifierType.Explicit

    // 沒有標註時,詞綴之間是用空行分隔的(一條詞綴可能有多行 stat)
    for (const group of splitByBlankLines(section)) {
      parseStatsFromMod(group, item, { info: { type, tags: [] }, stats: [] })
    }

    const at = sections.indexOf(section)
    if (at !== -1) sections.splice(at, 1)
  })
}

/** 這個 section 有幾行能被辨識成已知詞綴?用來區分「詞綴區塊」與敘述文字。 */
function countRecognizedStats (section: string[], item: ParsedItem): number {
  const lines = section.filter(line => line.trim().length > 0)
  if (lines.length === 0) return 0

  let count = 0
  const iterator = linesToStatStrings(lines)
  let current = iterator.next()
  while (!current.done) {
    const parsedStat = tryParseTranslation(current.value, ModifierType.Explicit, item.category)
    if (parsedStat) {
      count += 1
      current = iterator.next(true)
    } else {
      current = iterator.next(false)
    }
  }
  return count
}

function splitByBlankLines (section: string[]): string[][] {
  const groups: string[][] = []
  let group: string[] = []
  for (const line of section) {
    if (line.trim() === '') {
      if (group.length > 0) { groups.push(group); group = [] }
    } else {
      group.push(line)
    }
  }
  if (group.length > 0) groups.push(group)
  return groups
}

function parseStatsFromMod (lines: string[], item: ParsedItem, modifier: ParsedModifier) {
  item.newMods.push(modifier)

  if (modifier.info.type === ModifierType.Veiled) {
    const found = STAT_BY_MATCH_STR(modifier.info.name!)
    if (found) {
      modifier.stats.push({
        stat: found.stat,
        translation: found.matcher
      })
    } else {
      item.unknownModifiers.push({
        text: modifier.info.name!,
        type: modifier.info.type
      })
    }
    return
  }

  const statIterator = linesToStatStrings(lines)
  let stat = statIterator.next()
  while (!stat.done) {
    const parsedStat = tryParseTranslation(stat.value, modifier.info.type, item.category)
    if (parsedStat) {
      modifier.stats.push(parsedStat)
      stat = statIterator.next(true)
    } else {
      stat = statIterator.next(false)
    }
  }

  item.unknownModifiers.push(...stat.value.map(line => ({
    text: line,
    type: modifier.info.type
  })))
}

/**
 * @deprecated
 */
function transformToLegacyModifiers (item: ParsedItem) {
  item.statsByType = sumStatsByModType(item.newMods)
}

function calcBasePercentile (item: ParsedItem) {
  const info = item.info.unique
    ? ITEM_BY_REF('ITEM', item.info.unique.base)![0].armour
    : item.info.armour
  if (!info) return

  // Base percentile is the same for all defences.
  // Using `AR/EV -> ES -> WARD` order to improve accuracy
  // of calculation (larger rolls = more precise).
  if (item.armourAR && info.ar) {
    item.basePercentile = calcPropPercentile(item.armourAR, info.ar, QUALITY_STATS.ARMOUR, item)
  } else if (item.armourEV && info.ev) {
    item.basePercentile = calcPropPercentile(item.armourEV, info.ev, QUALITY_STATS.EVASION, item)
  } else if (item.armourES && info.es) {
    item.basePercentile = calcPropPercentile(item.armourES, info.es, QUALITY_STATS.ENERGY_SHIELD, item)
  } else if (item.armourWARD && info.ward) {
    item.basePercentile = calcPropPercentile(item.armourWARD, info.ward, QUALITY_STATS.WARD, item)
  }
}
