// 檢查繁中介面字串沒有漏、佔位符沒有被翻掉。發版前跑,CI 也跑。
//
// 為什麼需要這支:i18n 的漏翻**不會讓建置失敗**。vue-i18n 設了
// `fallbackFormat: true` + `missingWarn: false`,少一個鍵就安靜地退回英文,
// 沒有錯誤、沒有警告。3.29.904 之前 315 個鍵裡有 311 個是這樣退回去的,
// 而所有測試、型別檢查、lint 全都是綠的。
//
// 這個檔案要處理三種鍵,少看一種就會誤判:
//
//   1. 巢狀鍵          settings: { hotkeys: "…" }      → t('settings.hotkeys')
//   2. 字面帶點的鍵    "map.mods.heist": "…"           → t('map.mods.heist')
//      (vue-i18n 兩種都吃,實測過;en 這個檔自己就混用)
//   3. **en 裡沒有條目的英文原文鍵**  t('Save')
//      這不是漏翻,是 fallbackFormat 的用法:找不到就把鍵本身當訊息顯示。
//      en 因此不需要條目,但繁中**必須**有,否則畫面上就是英文。
//      這種鍵只能從原始碼掃出來,拿 en 當清單會整批漏掉。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer')
const DATA = path.join(ROOT, 'public/data')
const PRIMARY = 'cmn-Hant' // 本專案自己維護的語系,判準嚴格;其餘只報告

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? flat(v, p + k + '.') : [[p + k, v]])
const load = (l) => new Map(flat(JSON.parse(fs.readFileSync(path.join(DATA, l, 'app_i18n.json'), 'utf8'))))

// --- 掃原始碼,找出第 3 種鍵 -------------------------------------------------
const srcFiles = []
;(function walk (d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(vue|ts)$/.test(e.name)) srcFiles.push(p)
  }
})(path.join(ROOT, 'src'))

const calledKeys = new Map() // key -> 第一個用到它的檔案
for (const f of srcFiles) {
  const s = fs.readFileSync(f, 'utf8')
  // useI18nNs('price_check') 讓同檔的 t(':hotkey') 解析成 price_check.hotkey
  const ns = (s.match(/useI18nNs\(\s*['"]([^'"]+)['"]/) || [])[1]
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  const add = (raw) => {
    if (!raw || raw.includes('${')) return // 動態組出來的鍵掃不到,只能靠 en 清單涵蓋
    const k = (raw.startsWith(':') && ns) ? ns + '.' + raw.slice(1) : raw
    if (!calledKeys.has(k)) calledKeys.set(k, rel)
  }
  for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) add(m[1].replace(/\\'/g, "'"))
  for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) add(m[1].replace(/\\"/g, '"'))
  for (const m of s.matchAll(/keypath="([^"]+)"/g)) add(m[1])
}

const en = load('en')
const literalKeys = [...calledKeys.keys()].filter(k => !en.has(k))

// --- 判定 -------------------------------------------------------------------
const placeholders = (s) => (String(s).match(/\{[^}]*\}/g) || []).sort()
let failed = false

const locales = fs.readdirSync(DATA, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'en')
  .map(e => e.name)

for (const locale of locales) {
  const strict = locale === PRIMARY
  const zh = load(locale)
  const missing = [...en.keys()].filter(k => !zh.has(k))
  const missingLiteral = literalKeys.filter(k => !zh.has(k))
  const badPh = []
  for (const [k, v] of en) {
    if (!zh.has(k)) continue
    const a = placeholders(v); const b = placeholders(zh.get(k))
    const same = a.length === b.length && a.every((x, i) => x === b[i])
    if (strict) {
      if (!same) badPh.push([k, a, b, '與英文不一致'])
    } else {
      // ⚠ 這條判準的第一版是錯的:寫成「兩邊逐字相同」,結果把俄文報成缺陷。
      //     en: "This tool relies on {0} and {1}, consider supporting them as well"
      //     ru: "Это приложение полагается на сайт {1}, можете поддержать и его"
      //   俄文把句子改寫成單數、只提一個網站,那是譯者的取捨 —— 句子通順、程式
      //   也不會壞。**譯文少用一個佔位符是合法的。**
      //
      //   真正會壞的只有「用了英文沒有的佔位符」(渲染成空白或原樣吐出)與
      //   「把佔位符本身翻掉」({0} → {零})。這兩種對任何語系都是硬錯。
      //
      //   繁中是本專案自己維護的,判準才要嚴格相等 —— 我們沒有「刻意改寫成少
      //   一個參數」的授權,少一個就是漏掉了資訊。
      const unknown = b.filter(x => !a.includes(x))
      if (unknown.length) badPh.push([k, a, b, '用了英文沒有的佔位符:' + unknown.join('、')])
    }
  }

  const tag = strict ? '' : ' (非本專案維護,僅報告)'
  console.log(`\n=== ${locale}${tag} ===`)
  console.log(`  en 的 ${en.size} 個鍵中,已翻譯 ${en.size - missing.length}`)
  console.log(`  程式碼直接用英文當鍵的 ${literalKeys.length} 個中,已翻譯 ${literalKeys.length - missingLiteral.length}`)

  for (const [k, a, b, why] of badPh) {
    console.error(`  ✗ 佔位符 ${k}(${why}): ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  }
  if (strict) {
    for (const k of missing) console.error(`  ✗ 缺鍵 ${k}`)
    for (const k of missingLiteral) console.error(`  ✗ 缺英文原文鍵 ${k}  (${calledKeys.get(k)})`)
    if (missing.length || missingLiteral.length || badPh.length) failed = true
  } else if (badPh.length) {
    failed = true
  }
}

if (failed) {
  console.error('\n✗ 未通過。')
  process.exit(1)
}
console.log('\n✓ 通過:繁中沒有漏鍵,且沒有任何語系用到英文沒有的佔位符。')
