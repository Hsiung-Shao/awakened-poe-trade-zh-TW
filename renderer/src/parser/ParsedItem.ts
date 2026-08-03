import type { ModifierType, StatCalculated } from './modifiers'
import type { ParsedModifier } from './advanced-mod-desc'
import type { BaseType } from '@/assets/data'
import { ItemCategory } from './meta'

export enum ItemRarity {
  Normal = 'Normal',
  Magic = 'Magic',
  Rare = 'Rare',
  Unique = 'Unique'
}

export enum ItemInfluence {
  Crusader = 'Crusader',
  Elder = 'Elder',
  Hunter = 'Hunter',
  Redeemer = 'Redeemer',
  Shaper = 'Shaper',
  Warlord = 'Warlord'
}

export interface ParsedItem {
  rarity?: ItemRarity
  itemLevel?: number
  armourAR?: number
  armourEV?: number
  armourES?: number
  armourWARD?: number
  armourBLOCK?: number
  basePercentile?: number
  weaponCRIT?: number
  weaponAS?: number
  weaponPHYSICAL?: number
  weaponELEMENTAL?: number
  mapBlighted?: 'Blighted' | 'Blight-ravaged'
  mapCompletionReward?: string
  map?: {
    tier: number | undefined
    itemQuantity?: number
    itemRarity?: number
    packSize?: number
    moreMaps?: number
    moreScarabs?: number
    moreCurrency?: number
    moreDivCards?: number
  }
  gemLevel?: number
  imbuedGem?: boolean
  areaLevel?: number
  talismanTier?: number
  memoryStrands?: number
  quality?: number
  sockets?: {
    linked?: number // only 5 or 6
    white: number
  }
  stackSize?: { value: number, max: number }
  isUnidentified: boolean
  isCorrupted: boolean
  isUnmodifiable?: boolean
  isMirrored?: boolean
  isSplit?: boolean
  influences: ItemInfluence[]
  logbookAreaMods?: ParsedModifier[][]
  sentinelCharge?: number
  isSynthesised?: boolean
  isFractured?: boolean
  isVeiled?: boolean
  isFoil?: boolean
  isFoulborn?: boolean
  /** 3.29 軍團機制:籠罩晶石作用過的傳奇護甲,底材名帶「殘存 」裝飾詞。 */
  isVestigial?: boolean
  statsByType: StatCalculated[]
  newMods: ParsedModifier[]
  unknownModifiers: Array<{
    text: string
    type: ModifierType
  }>
  heistBlueprint?: {
    wingsRevealed?: number
    target?: 'Enchants' | 'Trinkets' | 'Gems' | 'Replicas'
  }
  heistContract?: {
    requiredJob?: 'Lockpicking' | 'Brute Force' | 'Perception' | 'Demolition' | 'Counter-Thaumaturgy' | 'Trap Disarmament' | 'Agility' | 'Deception' | 'Engineering'
    jobLevel?: number
    targetValue?: 'Priceless'
  }
  category?: ItemCategory
  info: BaseType
  /**
   * 傳奇物品**實際那一行底材**對應到的資料列。
   *
   * 不能事後用 `ITEM_BY_REF('ITEM', info.unique.base)![0]` 補算 —— 同一個英文底材可以有
   * 兩個中文名,而那個 `[0]` 永遠是 ndjson 裡的第一列。實測:巨狼之眼送
   * `type=狼王魔符`(舊版)撈到 2521 筆,送 `type=巨狼魔符`(現行)只有 55 筆,
   * 拿舊版的價估現行的物品就是報錯價。
   */
  baseTypeInfo?: BaseType
  rawText: string
}

// NOTE: should match option values on trade
export enum IncursionRoom {
  Open = 1,
  Obstructed = 2
}

export function createVirtualItem (
  props: Partial<ParsedItem> & Pick<ParsedItem, 'info'>
): ParsedItem {
  return {
    ...props,
    isUnidentified: props.isUnidentified ?? false,
    isCorrupted: props.isCorrupted ?? false,
    newMods: props.newMods ?? [],
    statsByType: props.statsByType ?? [],
    unknownModifiers: props.unknownModifiers ?? [],
    influences: props.influences ?? [],
    rawText: 'VIRTUAL_ITEM'
  }
}
