#!/usr/bin/env node
// 把 `missing-items.json` 裡的物品補進 items.ndjson。
//
// 為什麼需要這個:
//   上游的資料庫缺了一批交易站其實搜得到的物品。實例:費斯特之鏡
//   (Facetor's Lens)、黃金(Gold)、獸魂玉(Bestiary Orb)——
//   查價時只會得到「Unknown Item」。這**不是繁中的問題**,英文版一樣查不到。
//
// 缺的不只通貨。上游也少了 202 個**傳奇物品**(連 Voidheart、Timetwist 這種
// 老東西都沒有)。傳奇是依物品名查表的,所以缺了同樣是查不到。
//
// 對照表怎麼來的、為什麼只收這幾類:見 missing-items.json 的 _readme,
// 以及 docs/MISSING-ITEMS.md。
//
// 用法:node scripts/gen-missing-items.mjs [--write]
// 不帶 --write 只報告。寫入後必須接著跑 gen-disc-variants 與 make-index-files,
// 順序見 DEVELOPING.md;`npm run regen-data` 會一次跑完。

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

/**
 * 複合鍵 `namespace + refName` 的分隔字元。用 NUL 是因為兩邊都不可能含它 ——
 * 空白不行,物品名本身就有空白("The Draugur's Lantern")。
 *
 * ⚠ 一定要寫成跳脫序列。原始碼裡放**原始 NUL 位元組**會讓 git 把整個檔判成
 *   二進位檔,從此 diff 只剩「Bin 4501 -> 8159 bytes」,審查等於瞎的。
 */
const SEP = '\u0000'

function makeRow (entry, lang) {
  const name = (lang === 'en') ? entry.refName : entry.name
  const base = { name, refName: entry.refName }

  // 傳奇。`unique.base` 是英文 refName,語言無關,兩個語系共用同一個值。
  // 解析器靠它把同名的不同傳奇分開(Parser.ts:307),也靠它從底材取得
  // item.category(Parser.ts:321)—— 所以底材必須在 en 資料裡且帶
  // craftable.category,下面有斷言擋著。
  // 不給 disenchantValue:那是「賣給商人值多少」,型別上是選填,而我們沒有
  // 可信的來源。給個猜的數字比不給更糟。
  if (entry.namespace === 'UNIQUE') {
    return { ...base, namespace: 'UNIQUE', unique: { base: entry.base }, icon: '', src: MARKER }
  }

  if (entry.group === 'card') {
    return { ...base, namespace: 'DIVINATION_CARD', exchangeable: true, icon: '', src: MARKER }
  }
  // graft 之類的裝備型物品要帶 craftable.category,解析器才判得出 item.category。
  // 它們不是交易所物品,所以**不給** exchangeable —— 給了會把 merchantOnly 翻成
  // false(status: available),那是給通貨與命運卡用的。
  if (entry.category) {
    return { ...base, namespace: 'ITEM', craftable: { category: entry.category }, icon: '', src: MARKER }
  }
  // 地圖碎片。形狀刻意與上游的 Mirrored Tablet 一致 —— 純 ITEM 列,靠名字查表。
  //
  // **不給 exchangeable**:那個旗標的語意是「在通貨交易所、只是還沒進 bulk 區」,
  // 它會讓查價視窗掛上「這件物品可以在通貨交易市場買賣」的橫幅(TradeListing.vue),
  // 而地圖碎片不在通貨交易所 —— 掛了就是騙人。
  // **不給 tradeTag**:理由同下面的通貨,我們不知道它的 exchange 代碼,給錯比不給更糟。
  // **不給 craftable**:碎片沒有 ItemCategory,category 留 undefined 才與上游一致;
  //   需要認出某一個特定碎片時,parser 走 `item.info.refName`(見 parseBloodFilledVessel)。
  if (entry.group === 'fragment') {
    return { ...base, namespace: 'ITEM', icon: '', src: MARKER }
  }
  // 通貨在上游是 namespace ITEM、不帶 craftable(對照 Chaos Orb)。
  // `exchangeable: true` 讓 merchantOnly 變 false —— 上游註解說明那是給
  // 「在通貨交易所、但還沒進 bulk 區」的物品用的,正是這批的處境。
  // 刻意**不給 tradeTag**:那會把查詢導向大宗交易端點,而我們不知道這些物品的
  // exchange 代碼,給錯比不給更糟。沒有它就走一般的名稱搜尋。
  return { ...base, namespace: 'ITEM', exchangeable: true, icon: '', src: MARKER }
}

const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/missing-items.json'), 'utf8'))
const entries = [
  ...table.items.map(e => ({ ...e, namespace: e.group === 'card' ? 'DIVINATION_CARD' : 'ITEM' })),
  ...table.uniques.map(e => ({ ...e, namespace: 'UNIQUE' }))
]
console.log(`對照表 items ${table.items.length} 筆、uniques ${table.uniques.length} 筆` +
            `(上游基準 ${table._upstreamBase})`)

/**
 * 傳奇的底材必須在 en 資料裡且帶 craftable.category。
 *
 * 少了它,解析器在 Parser.ts:321 的
 *   ITEM_BY_REF('ITEM', item.info.unique.base)![0].craftable!.category
 * 會在兩個 non-null 斷言上炸成 TypeError —— 症狀是「解析物品時發生錯誤」,
 * 完全看不出是資料的問題。寧可在這裡硬失敗。
 */
function assertUniqueBases () {
  const enRows = fs.readFileSync(path.join(DATA, 'en/items.ndjson'), 'utf8')
    .split(/\r?\n/).filter(l => l.length).map(l => JSON.parse(l))
  const byRef = new Map()
  for (const r of enRows) {
    if (r.namespace === 'ITEM' && !byRef.has(r.refName)) byRef.set(r.refName, r)
  }
  const bad = table.uniques.filter(u => !byRef.get(u.base)?.craftable?.category)
  if (bad.length) {
    console.error(`\n✗ ${bad.length} 個傳奇的底材在 en 資料裡不存在或缺 craftable.category:`)
    for (const u of bad) console.error(`    ${u.refName} -> ${u.base}`)
    process.exit(1)
  }
}
assertUniqueBases()

let changed = 0
let droppedVariants = 0
for (const lang of ['en', 'cmn-Hant']) {
  const file = path.join(DATA, lang, 'items.ndjson')
  const raw = fs.readFileSync(file, 'utf8')
  // 上游這份資料是 CRLF。切的時候正規化,寫回時沿用原本的行尾,
  // 否則會變成混合行尾而且所有 byte offset 都跑掉。
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const rows = raw.split(/\r?\n/).filter(l => l.length)

  // 先移除上一輪產生的列,讓這支腳本可重複執行。
  //
  // ⚠ 這一刀會**連 gen-disc-variants 產生的變體列一起砍掉**,那是刻意的。
  //   占卜寶珠的 100 個區域變體是「本表的基底列」的變體,同時帶 `src` 與
  //   `tradeType`。它們必須**緊接在基底列之後**,索引才找得到(索引依
  //   namespace::refName 去重,只留第一筆的位移,查表再往後走相鄰同名列)。
  //   而本腳本會把重建的基底列接在檔尾 —— 只留變體、不留基底,相鄰關係就斷了。
  //   所以正確做法是兩支都重跑,順序固定:先本腳本,再 gen-disc-variants。
  //   下面的 droppedVariants 會在真的砍到變體時大聲提醒。
  const kept = rows.filter(l => !l.includes(`"src":"${MARKER}"`))
  droppedVariants += rows.length - kept.length -
    rows.filter(l => l.includes(`"src":"${MARKER}"`) && !l.includes('"tradeType"')).length

  // 上游若已自行補上某個物品,就讓上游的版本勝出 —— 我們的列只有名字,
  // 上游的通常還有 icon 與 tradeTag。
  //
  // 判斷**必須帶 namespace**。同一個英文名在不同 namespace 是不同東西:
  // Wildfire 既是技能寶石(GEM)也是傳奇珠寶(UNIQUE)。不分 namespace 的話,
  // 上游哪天補上寶石版,我們的傳奇珠瑰就會被誤判成「上游已有」而悄悄消失。
  const existing = new Set()
  for (const l of kept) {
    try {
      const r = JSON.parse(l)
      existing.add(r.namespace + SEP + r.refName)
    } catch { /* 略過壞行,下面的解析會報 */ }
  }

  const adopted = []
  const added = []
  for (const e of entries) {
    if (existing.has(e.namespace + SEP + e.refName)) { adopted.push(e.refName); continue }
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

if (droppedVariants > 0) {
  console.log(`\n⚠ 順帶移除了 ${droppedVariants} 列 disc 變體(占卜寶珠 / 海圖 / 傭兵契約書)。`)
  console.log('   它們只有 gen-disc-variants 會重建,而且必須排在基底列後面。')
}

if (!process.argv.includes('--write')) {
  console.log('\n(乾跑。加 --write 才會寫入。)')
} else {
  console.log(`\n已寫入 ${changed} 列。`)
}
console.log('\n接著**依序**跑完這三步,少一步資料就是壞的:')
console.log('   npm run gen-disc-variants -- --write')
console.log('   npm run make-index-files')
console.log('   npm run verify-datasets')
console.log('(或一次跑完:npm run regen-data)')
