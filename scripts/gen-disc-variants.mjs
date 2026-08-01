#!/usr/bin/env node
// 產生「同名多變體」的 items.ndjson 列:海圖(Chart)的區域、傭兵契約書的流派。
//
// 為什麼需要這個:
//   交易站把這兩種物品的變體做成了**獨立的可搜尋類型**,例如
//     {"type":"BrineKingsDomain","text":"珊瑚礁海圖(海洋王的領域)","disc":"chart_coral_reef"}
//     {"type":"MiscScionWandAttacks","text":"傭兵契約書 (動能師)","disc":"mercenary_warrant"}
//   剪貼簿裡有變體名(海圖是屬性區的一行、傭兵是「流派: xxx」),但 APT 把它整行丟掉,
//   於是搜尋只能送出基底類型 → 撈回全部變體,價格完全沒有參考價值。
//
// 對接鍵:**`type` 欄(語言無關的內部 id)**。兩服 API 的 `type` 完全一致,
// 用它把國際服英文名與台服繁中名配起來,絕不用位置對位。
//
// 產出的列靠 APT 既有的兩個機制運作,不需要發明新東西:
//   disc.sectionText → 解析期用 rawText.includes() 選出正確變體(Parser.ts pickCorrectVariant)
//   tradeDisc        → 查詢期送 { discriminator, option }(create-item-filters.ts)
//   tradeType        → **本專案新增**,帶交易站要的內部 id;沒有它就只能送顯示名而搜不到
//
// 用法:node scripts/gen-disc-variants.mjs [--write]
// 不帶 --write 只報告差異。改完 ndjson 必須跑 npm run make-index-files 重建索引。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'renderer/public/data')
const CACHE = path.join(ROOT, '.cache/trade-items')

// 語系 → 該語系的交易站 API host。兩邊回傳的 `type` 欄一致,是唯一的對接鍵。
//
// ⚠ 本專案的 data/ 底下還有 ko 與 ru,它們**不會**拿到變體列。
// 那兩個語系由上游社群維護、本專案原樣沿用,而且要補也得先找到對應 realm 的
// 交易站 API(韓服 poe.game.daum.net、俄文走國際服)。韓俄使用者查海圖與傭兵
// 契約書時的行為與上游相同 —— 不是退步,只是沒被修好。
const REALMS = {
  en: 'www.pathofexile.com',
  'cmn-Hant': 'pathofexile.tw'
}

// sectionText 只比對變體名本身(「動能師」「海洋王的領域」),不含任何標籤前綴。
//
// 繁中的流派行是「流派: 動能師」,大可把前綴一起寫進 sectionText 讓比對更嚴格;
// 但英文客戶端的對應標籤我**沒有樣本可以驗證**,猜一個字串進去會變成只有英文玩家
// 才會踩到的無聲失效。變體名本身已經夠獨特,兩語系一律只比對它。

/*
 * 交易站目前有 12 種 disc,這裡只收沒人處理的那幾種:
 *
 *   alt_x / alt_y / alt_z (215)  上游資料自己就帶 tradeDisc,不要重複產生
 *   blighted / uberblighted (282) 上游在 Parser.ts 用 MAP_BLIGHTED 剝掉前綴、
 *                                 歸到基底地圖處理,不走 disc 機制
 *   legacy (85) / map (32)        舊版唯一變體與無顯示名的地圖變體,尚未評估
 *
 *   chart_* (16) / mercenary_warrant (63) / scrying_orb (100)  ← 本專案補的
 *
 * scrying_orb(占卜寶珠)與海圖同形:變體的 `type` 是語言無關的數字 id
 * (10021、10211…),顯示名在 `text`,要查詢的區域寫在物品的「地圖區域: 」那行。
 */
const WANTED_DISC = (disc) =>
  disc === 'mercenary_warrant' || disc === 'scrying_orb' || disc.startsWith('chart_')

// 兩服的變體清單並非完全一致:台服交易站少了這幾個 type,但國際服有。
// 缺了它們,那些區域只會退回基底類型,等於沒有收斂。
//
// 譯名一律取自 GGPK(第一真值)。若哪天台服補上了,下面的比對會顯示
// 「該服已提供」,對應的 override 就可以刪掉。
const MISSING_TRANSLATIONS = {
  'cmn-Hant': {
    // 海圖:與台服其餘 78 筆逐筆比對 100% 一致的同一張 `deepwaterrooms` 表
    UnremarkableSeabed: { base: '沙質海床海圖', variant: '平凡海床', disc: 'chart_sandy_seabed' },
    // 占卜寶珠:台服交易站少了這 4 個地圖區域(同樣的 type 也被凋落地圖使用,
    // 但那類由上游的 parser 剝前綴處理,不走這裡)
    20343: { base: '占卜寶珠', variant: '岩漿熔湖', disc: 'scrying_orb' },
    25202: { base: '占卜寶珠', variant: '古兵工廠', disc: 'scrying_orb' },
    26156: { base: '占卜寶珠', variant: '禁忌之森', disc: 'scrying_orb' },
    58981: { base: '占卜寶珠', variant: '詭譎晶洞', disc: 'scrying_orb' }
  }
}

async function fetchItems (lang) {
  fs.mkdirSync(CACHE, { recursive: true })
  const cached = path.join(CACHE, `${lang}.json`)
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'))

  const url = `https://${REALMS[lang]}/api/trade/data/items`
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const json = await res.json()
  fs.writeFileSync(cached, JSON.stringify(json), 'utf8')
  return json
}

// text 形如「珊瑚礁海圖(海洋王的領域)」或「砂質海床海圖 (深海平原)」——
// GGG 自己的空格慣例不一致,所以括號前的空白可有可無。取**最後一組**括號。
function splitVariant (text) {
  const m = /^(.*?)\s*[(（]([^()（）]+)[)）]\s*$/.exec(text)
  if (!m) return null
  return { base: m[1], variant: m[2] }
}

function collect (json) {
  const out = new Map() // type(內部 id) → { disc, base, variant }
  for (const group of json.result ?? []) {
    for (const e of group.entries ?? []) {
      if (!e.disc || !WANTED_DISC(e.disc) || !e.type || !e.text) continue
      const split = splitVariant(e.text)
      if (!split) continue
      out.set(e.type, { disc: e.disc, ...split })
    }
  }
  return out
}

const byLang = {}
for (const lang of Object.keys(REALMS)) {
  byLang[lang] = collect(await fetchItems(lang))
  for (const [type, info] of Object.entries(MISSING_TRANSLATIONS[lang] ?? {})) {
    if (byLang[lang].has(type)) {
      console.log(`  ℹ [${lang}] ${type} 該服已提供,MISSING_TRANSLATIONS 的 override 可以刪了`)
    } else {
      byLang[lang].set(type, info)
      console.log(`  ℹ [${lang}] ${type} 該服缺席,以 GGPK 譯名補上:${info.variant}`)
    }
  }
}

// 以語言無關的 type 對接。任一邊缺席就是資料不齊,必須報出來而不是靜靜跳過。
const types = [...byLang.en.keys()]
const missing = types.filter(t => !byLang['cmn-Hant'].has(t))
const extra = [...byLang['cmn-Hant'].keys()].filter(t => !byLang.en.has(t))
console.log(`對接:en ${byLang.en.size} 筆 / cmn-Hant ${byLang['cmn-Hant'].size} 筆`)
if (missing.length) console.log(`  ⚠ cmn-Hant 缺 ${missing.length} 個 type:${missing.slice(0, 5).join(', ')}`)
if (extra.length) console.log(`  ⚠ en 缺 ${extra.length} 個 type:${extra.slice(0, 5).join(', ')}`)
const joined = types.filter(t => byLang['cmn-Hant'].has(t))
console.log(`  對接成功 ${joined.length}/${types.length}`)

let changed = 0
for (const lang of Object.keys(REALMS)) {
  const file = path.join(DATA, lang, 'items.ndjson')
  const raw = fs.readFileSync(file, 'utf8')

  // 上游這份資料是 CRLF。若照 '\n' 切、再用 '\n' 接回去,既有列會保留行尾的 '\r'
  // 而新產生的列沒有,檔案變成混合行尾——JSON.parse 容忍尾端空白所以看似正常,
  // 但那是運氣,而且 diff 會把每一列都當成有差異。切的時候正規化,寫回時沿用原本的行尾。
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const rows = raw.split(/\r?\n/).filter(l => l.length)

  // 先移除上一輪產生的變體列(以 tradeType 為標記),讓這支腳本可重複執行。
  const kept = rows.filter(l => !l.includes('"tradeType"'))

  // 依 refName 分組,**不是**依顯示名。
  //
  // 台服交易站與國際服客戶端的繁中譯名並不一致(實測:Sandy Seabed Chart 台服作
  // 「砂質海床海圖」、GGPK 作「沙質海床海圖」;Coral Forest Chart 台服「珊瑚森林海圖」、
  // GGPK「珊瑚林海圖」)。items.ndjson 的譯名取自 GGPK ——也就是使用者剪貼簿裡真正會
  // 出現的字——所以拿台服顯示名去比對會找不到基底。refName 兩邊一致,是唯一安全的鍵。
  const groups = new Map()
  for (const type of joined) {
    const refName = byLang.en.get(type).base
    if (!groups.has(refName)) groups.set(refName, [])
    groups.get(refName).push({ type, ...byLang[lang].get(type) })
  }

  const notFound = []
  let inserted = 0
  for (const [refName, variants] of groups) {
    const at = kept.findIndex(l => {
      try {
        const o = JSON.parse(l)
        return o.namespace === 'ITEM' && o.refName === refName
      } catch { return false }
    })
    if (at === -1) { notFound.push(refName); continue }

    const baseObj = JSON.parse(kept[at])
    // 基底列自己要帶 disc(即使是空條件),否則 commonFind 只會收到它一列、
    // pickCorrectVariant 也會在 `if (!item.info.disc) return` 直接返回。
    // 空條件恆匹配,因此它同時是「沒有任何變體對上」時的退路。
    baseObj.disc = {}
    kept[at] = JSON.stringify(baseObj)

    // 依 sectionText 長度**升冪**排,配合 pickCorrectVariant 的 last-wins:
    // 「萬惡動能師」比「動能師」長 → 排在後面 → 遇到萬惡款時勝出,不會被短的蓋掉。
    const lines = variants
      .map(v => ({ v, sectionText: v.variant }))
      .sort((a, b) => a.sectionText.length - b.sectionText.length ||
        a.sectionText.localeCompare(b.sectionText))
      .map(({ v, sectionText }) => JSON.stringify({
        ...baseObj,
        disc: { sectionText },
        tradeDisc: v.disc,
        tradeType: v.type
      }))

    kept.splice(at + 1, 0, ...lines)
    inserted += lines.length
  }

  if (notFound.length) {
    console.log(`  [${lang}] ⚠ items.ndjson 找不到這些基底,其變體未產生:${notFound.join(', ')}`)
  }
  console.log(`  [${lang}] 產生 ${inserted} 列(基底 ${groups.size - notFound.length} 種)`)

  if (process.argv.includes('--write')) {
    fs.writeFileSync(file, kept.join(eol) + eol, 'utf8')
    changed += inserted
  }
}

if (!process.argv.includes('--write')) {
  console.log('\n(乾跑。加 --write 才會寫入,寫入後必須跑 npm run make-index-files)')
} else {
  console.log(`\n已寫入 ${changed} 列。接著必須跑:npm run make-index-files`)
}
