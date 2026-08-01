#!/usr/bin/env node
// 把 `missing-items.json` 裡的物品補進 items.ndjson。
//
// 為什麼需要這個:
//   上游的資料庫缺了一批交易站其實搜得到的物品。實例:費斯特之鏡
//   (Facetor's Lens)、黃金(Gold)、獸魂玉(Bestiary Orb)——
//   查價時只會得到「Unknown Item」。這**不是繁中的問題**,英文版一樣查不到。
//
// 對照表怎麼來的、為什麼只收 currency 與 card:見 missing-items.json 的 _readme,
// 以及 docs/MISSING-ITEMS.md。
//
// 用法:node scripts/gen-missing-items.mjs [--write]
// 不帶 --write 只報告。寫入後必須跑 npm run make-index-files 重建索引。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'renderer/public/data')

/**
 * 產生列的標記。用途是讓這支腳本可重複執行 —— 每次先把上一輪產生的列拿掉再重放。
 *
 * 沒有標記的話,唯一的辨識方式是「refName 在對照表裡」,但那會在上游哪天自己補上
 * 這個物品時,把**上游那筆比較完整的列**(有 icon、有 tradeTag)一起刪掉。
 * 有標記就能區分「這是我們加的」與「這是上游的」。
 */
const MARKER = 'zh-tw-missing'

function makeRow (entry, lang) {
  const name = (lang === 'en') ? entry.refName : entry.name
  const base = { name, refName: entry.refName }

  if (entry.group === 'card') {
    return { ...base, namespace: 'DIVINATION_CARD', exchangeable: true, icon: '', src: MARKER }
  }
  // graft 之類的裝備型物品要帶 craftable.category,解析器才判得出 item.category。
  // 它們不是交易所物品,所以**不給** exchangeable —— 給了會把 merchantOnly 翻成
  // false(status: available),那是給通貨與命運卡用的。
  if (entry.category) {
    return { ...base, namespace: 'ITEM', craftable: { category: entry.category }, icon: '', src: MARKER }
  }
  // 通貨在上游是 namespace ITEM、不帶 craftable(對照 Chaos Orb)。
  // `exchangeable: true` 讓 merchantOnly 變 false —— 上游註解說明那是給
  // 「在通貨交易所、但還沒進 bulk 區」的物品用的,正是這批的處境。
  // 刻意**不給 tradeTag**:那會把查詢導向大宗交易端點,而我們不知道這些物品的
  // exchange 代碼,給錯比不給更糟。沒有它就走一般的名稱搜尋。
  return { ...base, namespace: 'ITEM', exchangeable: true, icon: '', src: MARKER }
}

const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/missing-items.json'), 'utf8'))
const entries = table.items
console.log(`對照表 ${entries.length} 筆(上游基準 ${table._upstreamBase})`)

let changed = 0
for (const lang of ['en', 'cmn-Hant']) {
  const file = path.join(DATA, lang, 'items.ndjson')
  const raw = fs.readFileSync(file, 'utf8')
  // 上游這份資料是 CRLF。切的時候正規化,寫回時沿用原本的行尾,
  // 否則會變成混合行尾而且所有 byte offset 都跑掉。
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const rows = raw.split(/\r?\n/).filter(l => l.length)

  // 先移除上一輪產生的列,讓這支腳本可重複執行。
  const kept = rows.filter(l => !l.includes(`"src":"${MARKER}"`))

  // 上游若已自行補上某個物品,就讓上游的版本勝出 —— 我們的列只有名字,
  // 上游的通常還有 icon 與 tradeTag。
  const existing = new Set()
  for (const l of kept) {
    try { existing.add(JSON.parse(l).refName) } catch { /* 略過壞行,下面的解析會報 */ }
  }

  const adopted = []
  const added = []
  for (const e of entries) {
    if (existing.has(e.refName)) { adopted.push(e.refName); continue }
    added.push(JSON.stringify(makeRow(e, lang)))
  }

  if (adopted.length > 0) {
    console.log(`  [${lang}] ℹ 上游已自行補上 ${adopted.length} 筆,可從對照表移除:`)
    console.log(`      ${adopted.slice(0, 8).join(', ')}${adopted.length > 8 ? ' …' : ''}`)
  }
  console.log(`  [${lang}] 產生 ${added.length} 列`)

  if (process.argv.includes('--write')) {
    fs.writeFileSync(file, [...kept, ...added].join(eol) + eol, 'utf8')
    changed += added.length
  }
}

if (!process.argv.includes('--write')) {
  console.log('\n(乾跑。加 --write 才會寫入,寫入後必須跑 npm run make-index-files)')
} else {
  console.log(`\n已寫入 ${changed} 列。接著必須跑:npm run make-index-files`)
}
