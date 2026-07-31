#!/usr/bin/env node
/**
 * 產生 Release 用的 `SHA256SUMS-<版本>.txt`。
 *
 * 本專案沒有 code signing 憑證,所以使用者能驗證的只有兩樣東西:
 * 這份雜湊清單,以及 GPG 簽章的 tag。清單本身必須正確,否則整套驗證是空的。
 *
 * 設計上刻意採**白名單斷言**而非排除清單:電子建置的產物種類會隨設定變動,
 * 「列出不要的」永遠會漏掉下一個變體,「列出要的、其餘一律報錯」不會。
 *
 * 用法:
 *   node scripts/release-checksums.mjs            # 印出來,不寫檔
 *   node scripts/release-checksums.mjs --write    # 寫進 main/dist/
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'main/dist')

/** 要納入雜湊清單的檔案。副檔名以外的一律報錯,不靜默略過。 */
const DISTRIBUTABLE = /\.(exe|AppImage|dmg|zip)$/
/** 更新器讀的清單檔。使用者也該能驗它,否則「檢查更新」看到的版本無從查證。 */
const UPDATE_MANIFEST = /^latest(-linux|-mac)?\.yml$/
/**
 * 建置中間產物,已知且刻意排除。
 *
 * ⚠ `main/dist/` 同時裝了兩種東西:esbuild 的輸出(main.js / vision.js,
 * 是 electron-builder 的**輸入**)與 electron-builder 的輸出。前者會被打包
 * 進安裝檔,不是獨立散布的檔案,所以不列進雜湊清單。
 */
const IGNORED = [
  /^(main|vision)\.js(\.map)?$/, // esbuild 輸出,會被包進 exe
  /\.blockmap$/, // electron-builder 的差分更新索引,隨 exe 重算
  /^builder-(debug|effective-config)\.ya?ml$/, // 實際副檔名是 .yml,不是 .yaml
  /-unpacked$/,
  /^\.icon-(ico|icns)$/,
  /^mac(-arm64)?$/
]

function version () {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'main/package.json'), 'utf8'))
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`main/package.json 的 version 不是三段式:${pkg.version}`)
  }
  return pkg.version
}

function sha256 (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const VERSION = version()

if (!fs.existsSync(DIST)) {
  console.error(`找不到 ${DIST} —— 請先在 main/ 跑 npm run package`)
  process.exit(1)
}

const entries = fs.readdirSync(DIST, { withFileTypes: true })
const hashed = []
const unexpected = []

for (const e of entries) {
  const name = e.name
  if (IGNORED.some(re => re.test(name))) continue
  if (e.isDirectory()) { unexpected.push(`${name}/ (未預期的目錄)`); continue }
  if (DISTRIBUTABLE.test(name) || UPDATE_MANIFEST.test(name)) {
    hashed.push({ name, hash: sha256(path.join(DIST, name)) })
    continue
  }
  unexpected.push(name)
}

// 斷言一:不認得的產物一律當失敗。漏簽一個檔比多簽一個危險得多。
if (unexpected.length > 0) {
  console.error('main/dist/ 有不認得的檔案,無法判斷該不該納入雜湊清單:')
  for (const n of unexpected) console.error(`  ${n}`)
  console.error('\n確認它是產物就加進 DISTRIBUTABLE,是中間檔就加進 IGNORED。')
  process.exit(1)
}

// 斷言二:每個可散布檔的檔名都必須帶當前版號。混進上一版的殘留產物,
// 公告的雜湊就會對不上使用者下載到的檔案。
const stale = hashed.filter(h => DISTRIBUTABLE.test(h.name) && !h.name.includes(VERSION))
if (stale.length > 0) {
  console.error(`這些檔名不含版本 ${VERSION},可能是上一版的殘留:`)
  for (const h of stale) console.error(`  ${h.name}`)
  console.error('\n請先清空 main/dist/ 再重新打包。')
  process.exit(1)
}

if (hashed.length === 0) {
  console.error('main/dist/ 裡沒有任何可散布檔 —— 打包是不是失敗了?')
  process.exit(1)
}

// 斷言三:`latest.yml` 引用的檔名必須與實際上傳的一致。
//
// electron-builder 產出的檔名帶空格(`Awakened PoE Trade-zh-TW Setup 3.29.900.exe`),
// 但它寫進 latest.yml 的 url 是把空格換成連字號的版本 —— 那是它自己上傳時會用的名字。
// 我們手動建立 Release,GitHub 又會把檔名裡的空格換成**點**,三邊互不相同。
// 更新器讀 latest.yml 找不到對應 asset 就會失敗,而且是安靜地失敗。
const latestYml = entries.find(e => e.isFile() && UPDATE_MANIFEST.test(e.name))
const renames = []
if (latestYml !== undefined) {
  const yml = fs.readFileSync(path.join(DIST, latestYml.name), 'utf8')
  const referenced = [...yml.matchAll(/^\s*(?:-\s*url|path):\s*(.+?)\s*$/gm)].map(m => m[1])
  for (const { name } of hashed) {
    if (!DISTRIBUTABLE.test(name)) continue
    const asUploaded = name.replace(/ /g, '-')
    if (referenced.includes(asUploaded) && asUploaded !== name) {
      renames.push({ from: name, to: asUploaded })
    }
  }
}

const body = [
  `# Awakened PoE Trade-zh-TW ${VERSION}`,
  '#',
  '# 驗證方式:',
  '#   PowerShell:  Get-FileHash <檔名> -Algorithm SHA256',
  '#   bash:        sha256sum <檔名>',
  '#',
  '# 算出來的值與下面不同就不要執行。',
  '',
  ...hashed.map(h => `${h.hash}  ${h.name}`),
  ''
].join('\n')

console.log(body)

if (renames.length > 0) {
  console.log('⚠ 上傳前必須改名,否則 latest.yml 指向的 asset 不存在,更新檢查會安靜地失敗:')
  for (const r of renames) console.log(`    "${r.from}"\n  → ${r.to}`)
  console.log('')
}

if (process.argv.includes('--write')) {
  const out = path.join(DIST, `SHA256SUMS-${VERSION}.txt`)
  fs.writeFileSync(out, body, 'utf8')
  console.log(`已寫入 ${out}`)
  console.log(`\n接著:上傳 ${hashed.length} 個產物 + 這份清單,並建立 GPG 簽章的 tag:`)
  console.log(`  git tag -s v${VERSION} -m "Awakened PoE Trade-zh-TW ${VERSION}"`)
} else {
  console.log('(乾跑。加 --write 才會寫進 main/dist/)')
}
