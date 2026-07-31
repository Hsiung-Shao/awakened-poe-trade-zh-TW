import { ITEM_BY_TRANSLATED } from '@/assets/data'

/**
 * ⚠ 本檔取自上游**尚未合併**的 PR。
 *
 *   https://github.com/SnosMe/awakened-poe-trade/pull/1890  (commit 488d2cb)
 *   "Fix: magic items price check failed in chinese"
 *
 * 背景:baseline(`18a401e`)的版本用 `name.split(' ')` 切詞,對沒有空格的
 * 中文/韓文物品名只會產生「整個帶詞綴的名字」這一個候選,永遠查不到基底,
 * 整件物品回 `item.unknown`。實測 47 件繁中 fixture 中有 9 件因此失敗。
 *
 * 本專案原本自己寫了一版(詞組合優先、查不到再退回逐字元),行為與這個 PR
 * 對整個 corpus **逐件相同**,但這版只有 5 行改動。既然等價就採用上游的,
 * 把偏離面積壓到最小 —— 將來 PR 合併時這個檔案可以直接對上。
 *
 * 若上游在合併前改了這個 PR,`npm run check-upstream` 會報出來。
 */
export function magicBasetype (name: string) {
  // Chinese/Korean names have no spaces to split on, so fall back to characters
  const hasSpaces = name.includes(' ')
  const words = hasSpaces ? name.split(' ') : [...name]
  const separator = hasSpaces ? ' ' : ''

  const perm: string[] = words.flatMap((_, start) =>
    Array(words.length - start).fill(undefined)
      .map((_, idx) => words
        .slice(start, start + idx + 1)
        .join(separator)
      )
  )

  const result = perm
    .map(name => {
      const result = ITEM_BY_TRANSLATED('ITEM', name)
      return { name, found: (result && result[0].craftable) }
    })
    .filter(res => res.found)
    .sort((a, b) => b.name.length - a.name.length)

  return result.length ? result[0].name : undefined
}
