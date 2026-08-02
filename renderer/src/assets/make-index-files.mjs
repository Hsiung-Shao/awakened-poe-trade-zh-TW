// @ts-check

import fnv1a from '@sindresorhus/fnv1a'
import fs from 'fs'
import path from 'path'

const LANGUAGES = ['en', 'ru', 'cmn-Hant', 'ko']

for (const lang of LANGUAGES) {
  const lineStarts = {
    /** @type{Array<{ hash: number, start: number }>} */
    statsByRef: [],
    /** @type{Array<{ hash: number, start: number }>} */
    matchers: []
  }

  {
    const ndjson = fs.readFileSync(`./public/data/${lang}/stats.ndjson`, { encoding: 'utf-8' })
    let start = 0
    while (start !== ndjson.length) {
      const end = ndjson.indexOf('\n', start)
      /** @type {import('./data/interfaces').StatOrGroup} */
      const statOrGroup = JSON.parse(ndjson.slice(start, end))
      const stats = ('stats' in statOrGroup) ? statOrGroup.stats : [statOrGroup]
      for (const stat of stats) {
        lineStarts.statsByRef.push({ start, hash: Number(fnv1a(stat.ref, { size: 32 })) })
        for (const matcher of stat.matchers) {
          if (matcher.advanced) {
            lineStarts.matchers.push({ start, hash: Number(fnv1a(matcher.advanced, { size: 32 })) })
          } else {
            lineStarts.matchers.push({ start, hash: Number(fnv1a(matcher.string, { size: 32 })) })
          }
        }
      }
      start = (end + 1)
    }
  }

  {
    const indexData = new Uint32Array(lineStarts.statsByRef.length * 2)
    lineStarts.statsByRef.sort((a, b) => a.hash - b.hash)
    for (let i = 0; i < lineStarts.statsByRef.length; i += 1) {
      indexData[i * 2 + 0] = lineStarts.statsByRef[i].hash
      indexData[i * 2 + 1] = lineStarts.statsByRef[i].start
    }
    fs.writeFileSync(
      path.join('./public/data', lang, 'stats-ref.index.bin'),
      indexData
    )
  }

  {
    const indexData = new Uint32Array(lineStarts.matchers.length * 2)
    lineStarts.matchers.sort((a, b) => a.hash - b.hash)
    for (let i = 0; i < lineStarts.matchers.length; i += 1) {
      indexData[i * 2 + 0] = lineStarts.matchers[i].hash
      indexData[i * 2 + 1] = lineStarts.matchers[i].start
    }
    fs.writeFileSync(
      path.join('./public/data', lang, 'stats-matcher.index.bin'),
      indexData
    )
  }
}

/**
 * 兩個索引的**去重鍵不一樣**,所以不能共用同一份 lineStarts。
 *
 * refName 索引:`namespace::refName`。一個 refName 一項,維持原樣。
 *
 * 名稱索引:`namespace::refName::name`。上游用的也是 `namespace::refName`,只寫每組
 * **第一列**的 `hashName` —— 於是同一個 refName 的第二個譯名在索引裡連鍵都沒有,
 * 依名字永遠查不到。這不是假設,GGPK `baseitemtypes` 本來就有這種列:
 *
 *     Talismans/Talisman4          Greatwolf Talisman  狼王魔符    ← 舊版
 *     Talismans/TalismanGreatwolf  Greatwolf Talisman  巨狼魔符    ← 現行,遊戲現在掉的是這個
 *
 * 兩個譯名在台服交易站都是有效的 type,只是分屬現行與 (舊版)。全資料集掃描:
 * `en` / `ru` / `ko` 各 0 組,`cmn-Hant` 5 組。
 *
 * ⚠ 這**不會**動到變體:`disc` 變體(傭兵契約書、占卜寶珠…)同 refName 且同 name,
 * 新鍵一樣收斂成一項,`commonFind` 依然靠相鄰列走訪。因此 `en`/`ru`/`ko` 的
 * `items-name.index.bin` 必須逐位元組不變,四個語系的 `items-ref.index.bin` 亦然。
 */
for (const lang of LANGUAGES) {
  /** @type{Array<{ hash: number, start: number }>} */
  let nameStarts
  /** @type{Array<{ hash: number, start: number }>} */
  let refStarts
  {
    const ndjson = fs.readFileSync(`./public/data/${lang}/items.ndjson`, { encoding: 'utf-8' })
    let start = 0
    /** @type{Map<string, { hash: number, start: number }>} */
    const byName = new Map()
    /** @type{Map<string, { hash: number, start: number }>} */
    const byRef = new Map()
    while (start !== ndjson.length) {
      const end = ndjson.indexOf('\n', start)
      /** @type {import('./data/interfaces').BaseType} */
      const item = JSON.parse(ndjson.slice(start, end))

      const nameKey = `${item.namespace}::${item.refName}::${item.name}`
      if (!byName.has(nameKey)) {
        byName.set(nameKey, {
          hash: Number(fnv1a(`${item.namespace}::${item.name}`, { size: 32 })),
          start: start
        })
      }
      const refKey = `${item.namespace}::${item.refName}`
      if (!byRef.has(refKey)) {
        byRef.set(refKey, {
          hash: Number(fnv1a(`${item.namespace}::${item.refName}`, { size: 32 })),
          start: start
        })
      }
      start = (end + 1)
    }
    nameStarts = Array.from(byName.values())
    refStarts = Array.from(byRef.values())
  }

  for (const [file, entries] of [
    ['items-name.index.bin', nameStarts],
    ['items-ref.index.bin', refStarts]
  ]) {
    const indexData = new Uint32Array(entries.length * 2)
    entries.sort((a, b) => a.hash - b.hash)
    for (let i = 0; i < entries.length; i += 1) {
      indexData[i * 2 + 0] = entries[i].hash
      indexData[i * 2 + 1] = entries[i].start
    }
    fs.writeFileSync(path.join('./public/data', lang, file), indexData)
  }
}
