#!/usr/bin/env node
// @ts-check
/**
 * 把 `scripts/missing-stat-ids.json` 列的 implicit 交易 id 補進兩份 `stats.ndjson`。
 *
 * ## 為什麼需要這支
 *
 * 解析器在 [stat-translations.ts] `tryParseTranslation` 有這道守門:
 *
 *     if (!found || !(modType in found.stat.trade.ids)) continue
 *
 * 一條詞綴的譯文明明認得,只要 `trade.ids` 少了**當下那個 modType**,它就會被
 * 當成完全沒認出來,收進 `unknownModifiers`。畫面上的症狀是「這條詞綴不在篩選
 * 清單裡」—— 不是錯誤、不是紅字,就是不見了。
 *
 * 3.29 的**殘存(Vestigial)**機制把這個缺口變成常態:它把另一件同部位傳奇的一條
 * 詞綴複製到這件物品上,而複製後是以**固定屬性(implicit)**呈現的。所以同一條
 * 詞綴天生有兩個身分 —— 在原主身上是 `explicit.stat_N`,被賦予後是
 * `implicit.stat_N`。上游的資料集只收了前者,後者整批缺席。
 *
 * ## 判準(每一條都可複驗,不靠推測)
 *
 * 1. 資料集裡該 stat 的 `trade.ids.explicit` 含 `explicit.stat_N`;
 * 2. 同一個 stat 的 `trade.ids.implicit` **沒有** `implicit.stat_N`;
 * 3. `implicit.stat_N` 出現在**國際服** `/api/trade/data/stats` 的 implicit 群組裡。
 *
 * ⚠ 第 3 條**不可以**改成「送去搜尋沒報錯」。搜尋端點是寬鬆的:它只驗 `stat_N`
 *   這個編號存在,不驗 implicit 群組收不收得到。實測把 5,577 個候選整批送出,
 *   兩服一個都沒拒絕,而兩服 implicit 群組總共才 1,811 / 1,684 個。用它當判準會
 *   收進一大批送出去必定 0 筆的死條件 —— 而交易站對這種條件**不報錯**,
 *   使用者只會看到「查無結果」。
 *   (真正不存在的編號如 `implicit.stat_999999999` 才回 400 Unknown stat provided。)
 *
 * ## 為什麼加 id 不會改變既有行為
 *
 * `_resolveTranslation` 用 `modType in stat.trade.ids` 篩選候選,所以替
 * **`resolve` 群組成員**加 id 原則上會改變消歧結果。實測這批 102 筆裡落在群組內的
 * 只有 1 筆,且它的 strat 是 `select` —— 那個分支在 `onTradeStats` 過濾**之前**
 * 就 return 了,碰不到消歧。其餘全是頂層 stat,沒有這一層。
 *
 * ## 用法
 *
 *   node scripts/gen-missing-stat-ids.mjs              # 檢查(不寫檔),有落差回非零
 *   node scripts/gen-missing-stat-ids.mjs --write      # 實際補進 stats.ndjson
 *   node scripts/gen-missing-stat-ids.mjs --audit      # 需網路:重新推導清單並驗證兩服
 *   node scripts/gen-missing-stat-ids.mjs --audit --write   # 連同 missing-stat-ids.json 一起更新
 *
 * `--audit` **不進 `regen-data`** —— 它要打外部 API,與 `audit-trade-names` 同一個
 * 分類:發版前跑,不進離線測試。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'renderer/public/data')
const LIST_FILE = path.join(ROOT, 'scripts/missing-stat-ids.json')

/** 只動我們自己維護的兩個語系,理由與 `verify-datasets.mjs` 相同。 */
const LANGUAGES = ['en', 'cmn-Hant']

const WRITE = process.argv.includes('--write')
const AUDIT = process.argv.includes('--audit')

// GGG 的 Cloudflare 只要一般瀏覽器 UA 就放行,403 是缺 UA 不是要登入。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const REALMS = [
  { key: 'intl', host: 'https://www.pathofexile.com' },
  // ⚠ canonical host 是 pathofexile.tw,`www.` 會 301。
  { key: 'tw', host: 'https://pathofexile.tw' }
]

/**
 * `trade.ids` 的鍵序慣例(取自上游資料集的實際分佈):implicit 永遠緊接在
 * explicit 之後。照著插能讓 diff 只有新增的那一段,不會整列重排。
 */
function insertImplicitAfterExplicit (ids, implicitId) {
  const out = {}
  for (const key of Object.keys(ids)) {
    out[key] = ids[key]
    if (key === 'explicit' && !('implicit' in ids)) {
      out.implicit = [implicitId]
    }
  }
  if ('implicit' in ids && !out.implicit.includes(implicitId)) {
    out.implicit = [...ids.implicit, implicitId]
  }
  return out
}

/** 走訪一列裡的每個 stat —— 頂層是一個,`resolve` 群組列是 `stats` 陣列。 */
function statsOf (row) {
  return Array.isArray(row.stats) ? row.stats : [row]
}

function readLines (lang) {
  // ⚠ 出貨資料集是 CRLF。用 split(/\r?\n/) 讀、'\n' 寫回會把整個檔重寫成 LF,
  //   diff 變成 8200 行全改,審查等於瞎的。
  const raw = fs.readFileSync(path.join(DATA, lang, 'stats.ndjson'), 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  return { lines: raw.split(eol), eol }
}

function loadList () {
  const json = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'))
  if (!Array.isArray(json.entries)) throw new Error('missing-stat-ids.json 缺 entries 陣列')
  for (const e of json.entries) {
    if (typeof e.explicit !== 'string' || typeof e.implicit !== 'string') {
      throw new Error(`entries 的每筆都要有 explicit / implicit 字串:${JSON.stringify(e)}`)
    }
    // 這條斷言不是形式主義:兩者只差前綴是整個判準的基礎,手改清單時打錯一個數字
    // 就會送出一個不存在的 id,而交易站對未知 id 回 400 —— 整個查詢失敗。
    if (e.explicit.replace(/^explicit\./, '') !== e.implicit.replace(/^implicit\./, '')) {
      throw new Error(`explicit 與 implicit 的 stat 編號不一致:${e.explicit} / ${e.implicit}`)
    }
  }
  return json
}

function apply (lang, entries) {
  const byExplicit = new Map(entries.map(e => [e.explicit, e.implicit]))
  const { lines, eol } = readLines(lang)
  const out = []
  let changedLines = 0
  let addedIds = 0
  const touchedRefs = []

  for (const line of lines) {
    if (line.trim().length === 0) { out.push(line); continue }
    const row = JSON.parse(line)
    let dirty = false

    for (const stat of statsOf(row)) {
      const ids = stat.trade?.ids
      if (!ids?.explicit) continue
      for (const eid of ids.explicit) {
        const iid = byExplicit.get(eid)
        if (iid === undefined) continue
        if (ids.implicit?.includes(iid)) continue
        stat.trade.ids = insertImplicitAfterExplicit(ids, iid)
        dirty = true
        addedIds += 1
        touchedRefs.push(`${stat.ref.replace(/\n/g, ' / ')}  +${iid}`)
      }
    }

    out.push(dirty ? JSON.stringify(row) : line)
    if (dirty) changedLines += 1
  }

  if (WRITE && changedLines > 0) {
    fs.writeFileSync(path.join(DATA, lang, 'stats.ndjson'), out.join(eol), 'utf8')
  }
  return { changedLines, addedIds, touchedRefs }
}

/**
 * 該 realm **實際索引**的 implicit 篩選器清單。
 *
 * ⚠ 判準只能是這一份,不能是「送去搜尋沒報錯」。搜尋端點是**寬鬆的**:它只驗
 *   `stat_N` 這個編號存在,不驗 implicit 這個群組裡有沒有它。實測把資料集裡
 *   5,577 個「有 explicit、缺 implicit」的候選整批送出,兩服**一個都沒拒絕**,
 *   而兩服的 implicit 群組總共才 1,811 / 1,684 個 —— 差三倍。
 *   拿它當判準會收進一大批送出去必定 0 筆的死條件。
 *   (`implicit.stat_999999999` 這種編號不存在的才會回 400 Unknown stat provided,
 *    所以「沒報錯」只證明編號存在,不證明這個群組收得到。)
 */
async function realmImplicitFilters (host) {
  const res = await fetch(`${host}/api/trade/data/stats`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${host}/api/trade/data/stats 回 ${res.status}`)
  const json = await res.json()
  const group = json.result.find(g => g.id === 'implicit' || g.label === 'Implicit')
  if (!group) throw new Error(`${host} 的 /data/stats 沒有 implicit 群組`)
  return new Set(group.entries.map(e => e.id))
}

async function audit () {
  console.log('=== 稽核:重新推導缺口並向兩個 realm 驗證 ===\n')

  const found = new Map() // explicit id -> { implicit, ref, inGroup, strat }
  for (const lang of LANGUAGES) {
    const { lines } = readLines(lang)
    for (const line of lines) {
      if (line.trim().length === 0) continue
      const row = JSON.parse(line)
      const inGroup = Array.isArray(row.stats)
      for (const stat of statsOf(row)) {
        const ids = stat.trade?.ids
        if (!ids?.explicit) continue
        for (const eid of ids.explicit) {
          // ⚠ 一定要檢查前綴。資料集把 52 條 sanctum 詞綴也塞在 `explicit` 鍵底下,
          //   直接做字串取代會把 `sanctum.stat_*` 誤報成缺口。
          if (!eid.startsWith('explicit.')) continue
          const iid = 'implicit.' + eid.slice('explicit.'.length)
          if (ids.implicit?.includes(iid)) continue
          if (!found.has(eid)) {
            found.set(eid, { explicit: eid, implicit: iid, ref: stat.ref, inGroup, strat: row.resolve?.strat })
          }
        }
      }
    }
  }
  console.log(`資料集裡「有 explicit、缺同號 implicit」的候選:${found.size} 筆`)

  const candidates = [...found.values()]
  if (candidates.length === 0) {
    // 沒有候選就不要打 API。送一個空的 filters 陣列回來的東西沒有意義,
    // 卻會讓「稽核跑過了」看起來像通過。
    console.log('資料集已無缺口,略過線上驗證。')
    return 0
  }
  const indexedBy = {}
  for (const realm of REALMS) {
    indexedBy[realm.key] = await realmImplicitFilters(realm.host)
    const hit = candidates.filter(c => indexedBy[realm.key].has(c.implicit)).length
    console.log(`  ${realm.key}:implicit 群組 ${indexedBy[realm.key].size} 個篩選器,命中候選 ${hit} 筆`)
  }

  // 收錄判準是**國際服**的 implicit 群組:app 的預設 realm 是 pc-ggg,而且
  // `Config.ts` 的 `useIntlSite` 讓「繁中 + pc-ggg」也走國際站 —— 上游的出貨資料集
  // 本來就是照國際服對齊的(實測國際服不認得的出貨 id 為 0,台服為 281)。
  const PRIMARY = 'intl'
  const keep = candidates.filter(c => indexedBy[PRIMARY].has(c.implicit))
  const twAlso = keep.filter(c => indexedBy.tw.has(c.implicit)).length
  console.log(`\n國際服索引得到的:${keep.length} 筆(其中台服也索引得到 ${twAlso} 筆)`)
  if (keep.length > twAlso) {
    // 不隱藏這個落差:台服沒索引的那些,送出去會回 0 筆而不是報錯 —— 靜默的錯答案。
    console.log(`⚠ 另外 ${keep.length - twAlso} 筆台服的 implicit 群組沒有。` +
      '台服玩家勾選後會查到 0 筆(交易站不會報錯)。' +
      '資料集是按語系而非按 realm 出貨的,無法只對某一服生效。')
  }

  const risky = keep.filter(c => c.inGroup && c.strat !== 'select')
  if (risky.length > 0) {
    // `select` 以外的 strat 會用 `modType in trade.ids` 挑候選,加 id 就是改行為。
    console.log(`\n⚠ 其中 ${risky.length} 筆落在會消歧的 resolve 群組裡,需人工判斷後才可納入:`)
    for (const c of risky) console.log(`    [${c.strat}] ${c.implicit} <- ${c.ref.replace(/\n/g, ' / ')}`)
  }

  const existing = loadList()
  const known = new Set(existing.entries.map(e => e.explicit))
  const fresh = keep.filter(c => !known.has(c.explicit))
  console.log(`\n清單已有 ${known.size} 筆,新發現 ${fresh.length} 筆`)
  for (const c of fresh) console.log(`  + ${c.implicit} <- ${c.ref.replace(/\n/g, ' / ')}`)

  if (WRITE) {
    const merged = [...existing.entries]
    for (const c of fresh) {
      merged.push({
        explicit: c.explicit,
        implicit: c.implicit,
        ref: c.ref,
        // 留下當下兩服各自索引得到與否 —— 台服沒有的那些,勾了會查到 0 筆而非報錯,
        // 出問題時要看得出是哪一批。
        realms: REALMS.filter(r => indexedBy[r.key].has(c.implicit)).map(r => r.key)
      })
    }
    merged.sort((a, b) => a.ref.localeCompare(b.ref) || a.explicit.localeCompare(b.explicit))
    existing.entries = merged.filter(e => !risky.some(r => r.explicit === e.explicit))
    fs.writeFileSync(LIST_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf8')
    console.log(`\n已寫回 ${path.relative(ROOT, LIST_FILE)}(${existing.entries.length} 筆)`)
  } else if (fresh.length > 0) {
    console.log('\n(唯讀模式。要寫進清單請加 --write)')
  }
  return fresh.length
}

async function main () {
  if (AUDIT) {
    const fresh = await audit()
    // 有新缺口但沒寫進去 -> 非零,讓發版前檢查看得見
    process.exitCode = (!WRITE && fresh > 0) ? 1 : 0
    return
  }

  const { entries } = loadList()
  console.log(`清單 ${entries.length} 筆,套用到 ${LANGUAGES.join(' / ')}`)

  let totalAdded = 0
  for (const lang of LANGUAGES) {
    const { changedLines, addedIds, touchedRefs } = apply(lang, entries)
    totalAdded += addedIds
    console.log(`  ${lang}: ${changedLines} 列變更,補入 ${addedIds} 個 id${WRITE ? '(已寫檔)' : ''}`)
    if (process.argv.includes('--verbose')) {
      for (const r of touchedRefs) console.log(`      ${r}`)
    }
  }

  if (!WRITE && totalAdded > 0) {
    console.log('\n資料集與清單不一致。跑 `node scripts/gen-missing-stat-ids.mjs --write` 補上。')
    process.exitCode = 1
  } else if (totalAdded === 0) {
    console.log('\n資料集已與清單一致。')
  } else {
    // ⚠ 這不是客套話。`stats-ref.index.bin` / `stats-matcher.index.bin` 存的是
    //   **位元組偏移量**,改動任何一列都會讓其後每一列的偏移量失效,查表會切在
    //   一列的中間、JSON.parse 當場炸掉。而 `verify-datasets` 看不到這一層
    //   (它只比語言無關鍵的集合),所以單獨跑這支再直接出貨是會壞的。
    console.log('\n⚠ 索引檔還沒重建。接著跑 `npm run make-index-files`,' +
      '或改用一次做完的 `npm run regen-data`。')
  }
}

await main()
