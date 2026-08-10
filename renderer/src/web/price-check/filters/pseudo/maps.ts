import { stat, pseudoStatByRef } from '@/assets/data'
import { ItemRarity } from '@/parser/ParsedItem'
import { ModifierType } from '@/parser/modifiers'
import { FiltersCreationContext } from '../create-stat-filters'
import { noSourcePseudoToFilter, propToFilter } from './item-property'
import { findAndResolveByRef, statToNotFilter } from './utils'

const PSEUDO = {
  MORE_SCARABS: stat('More Scarabs: #%'),
  MORE_MAPS: stat('More Maps: #%'),
  MORE_DIVINATION_CARDS: stat('More Divination Cards: #%'),
  MORE_CURRENCY: stat('More Currency: #%'),
  EXPLICIT_MODIFIERS: stat('# Modifiers')
}

const VALDO_LETHAL_STATS = [
  stat('Players who Die in area are sent to the Void')
]

export function mapProps (ctx: FiltersCreationContext): void {
  const { item } = ctx
  if (!item.map || item.mapBlighted || item.mapCompletionReward || item.rarity === ItemRarity.Unique) return

  const hasMoreDrops = Boolean(item.map.moreMaps || item.map.moreScarabs || item.map.moreCurrency || item.map.moreDivCards)

  // 上游原本在這裡整段早退:`if (!isCorrupted && !hasMoreDrops && refName !== 'Nightmare Map') return`。
  // 它的效果是「沒汙染、沒有更多掉落的普通稀有地圖」連物品數量都不產生 —— 面板上
  // 只剩一長串隨機詞綴。但物品數量/物品稀有度/怪物群大小正是地圖定價的主要依據,
  // 所以那三項改成**有數值就產生**,與汙染狀態、更多掉落無關。
  //
  // ⚠ 早退只影響這三項與最下面的 `# Modifiers`,**四個更多掉落的 pseudo 不受影響** ——
  //   它們各自有 `if (item.map.moreX)`,而只要其中一個有值 `hasMoreDrops` 就是 true,
  //   早退本來就不會發生。所以放寬這裡不會改動那四項的行為。
  //
  // `# Modifiers` 仍維持原本的適用範圍(見下方),因為它問的是「這張圖是不是滿詞綴」,
  // 那是汙染圖/夢魘地圖才會被拿來定價的東西。
  const isEndgameMap = (item.isCorrupted || hasMoreDrops || item.info.refName === 'Nightmare Map')

  if (item.map.itemQuantity) {
    ctx.filters.push(propToFilter({
      ref: 'Item Quantity: +#%',
      tradeId: 'item.map_item_quantity',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.itemQuantity },
      sources: [],
      disabled: false
    }, ctx))
  }
  if (item.map.itemRarity) {
    ctx.filters.push(propToFilter({
      ref: 'Item Rarity: +#%',
      tradeId: 'item.map_item_rarity',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.itemRarity },
      sources: [],
      // ⚠ 有更多掉落時物品稀有度**刻意預設不勾**(上游行為,使用者的截圖也是這樣:
      //   數量與群大小有勾、稀有度沒勾)。這條圖賣的是掉落量,稀有度拿來當條件只會
      //   把結果篩掉。沒有更多掉落的圖反過來,稀有度就是它的賣點,所以勾起來。
      disabled: hasMoreDrops
    }, ctx))
  }
  if (item.map.packSize) {
    ctx.filters.push(propToFilter({
      ref: 'Monster Pack Size: +#%',
      tradeId: 'item.map_pack_size',
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.packSize },
      sources: [],
      disabled: false
    }, ctx))
  }

  if (item.map.moreMaps) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.MORE_MAPS)!,
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.moreMaps },
      disabled: false
    }, ctx))
  }
  if (item.map.moreScarabs) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.MORE_SCARABS)!,
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.moreScarabs },
      disabled: false
    }, ctx))
  }
  if (item.map.moreCurrency) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.MORE_CURRENCY)!,
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.moreCurrency },
      disabled: false
    }, ctx))
  }
  if (item.map.moreDivCards) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.MORE_DIVINATION_CARDS)!,
      roll: { min: 0, max: Number.MAX_SAFE_INTEGER, value: item.map.moreDivCards },
      disabled: false
    }, ctx))
  }

  const explicitMods = item.newMods.filter(mod => mod.info.generation === 'prefix' || mod.info.generation === 'suffix')
  // `isEndgameMap && !hasMoreDrops` 等價於「汙染圖或夢魘地圖」,與放寬前逐字相同 ——
  // 放寬的是上面那三項,不是這一項。
  if (isEndgameMap && explicitMods.length === 8 && !hasMoreDrops) {
    ctx.filters.push(noSourcePseudoToFilter({
      pseudo: pseudoStatByRef(PSEUDO.EXPLICIT_MODIFIERS)!,
      roll: { min: 0, max: 8, value: explicitMods.length },
      disabled: false
    }, { ...ctx, searchInRange: 0 }))
  }
}

export function valdoBadMods (ctx: FiltersCreationContext): void {
  if (!ctx.item.mapCompletionReward) return

  for (const lethalStatRef of VALDO_LETHAL_STATS) {
    if (ctx.item.statsByType.some(calc => calc.stat.ref === lethalStatRef)) continue

    const lethalStat = findAndResolveByRef(lethalStatRef, ctx.item.category)
    const filter = statToNotFilter({
      stat: lethalStat,
      type: ModifierType.Explicit,
      disabled: false
    })
    ctx.filters.push(filter)
  }
}
