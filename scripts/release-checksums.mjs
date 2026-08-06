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
import { execFileSync } from 'node:child_process'
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
  /^mac(-arm64)?$/,
  // 這支腳本自己的輸出。不列進去的話,第二次跑就會撞上「不認得的檔案」而中斷
  // (第一次能過只是因為它是在掃描之後才寫出來的)。
  /^SHA256SUMS-.*\.txt$/
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

/*
 * 先把帶空格的產物改名成連字號版,再算雜湊。
 *
 * electron-builder 產出的檔名帶空格,但它寫進 latest.yml 的 url 是空格換連字號的
 * 版本 —— 那是它自己上傳時會用的名字。我們手動建立 Release,GitHub 又會把空格
 * 換成**點**,於是本機檔名、latest.yml、上傳後的 asset、SHA256SUMS 四邊互不相同:
 * 更新檢查找不到 asset(安靜失敗),使用者核對雜湊也對不上檔名。
 *
 * 與其在文件裡叮嚀「記得改名」,不如在這裡改完再算 —— 四邊一次對齊,
 * 而且雜湊算的就是實際上傳的那個檔。
 */
if (process.argv.includes('--write')) {
  for (const e of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.includes(' ')) continue
    if (!DISTRIBUTABLE.test(e.name)) continue
    const to = e.name.replace(/ /g, '-')
    fs.renameSync(path.join(DIST, e.name), path.join(DIST, to))
    console.log(`改名:${e.name}\n  → ${to}`)
  }
}

/*
 * 把可散布的 exe 各自封進一個 zip,並在裡面附一份只針對它的對照檔。
 *
 * 起因:使用者只下載了 exe、沒下載旁邊的 SHA256SUMS,結果無從比對。對照檔跟著
 * 檔案走就不會漏掉。
 *
 * ⚠ 這擋得住「下載不完整或檔案損毀」,**擋不住惡意竄改** —— 能改 zip 的人也能
 *   改裡面的對照檔。真正的信任錨點是 Release 說明裡那幾行雜湊(那是另一個管道)。
 *   附在 zip 裡是為了可用性,不是為了安全,不要把兩者混為一談。
 *
 * ⚠ **安裝檔必須同時保留一份獨立的 .exe**。`latest.yml` 的 url 指向它,
 *   electron-updater 直接從 releases/download/<tag>/<那個檔名> 抓;只給 zip
 *   就是 404,而且更新失敗是安靜的。攜帶版沒有這個限制,所以只給 zip。
 */
const SEVEN_ZIP = path.join(ROOT, 'main/node_modules/7zip-bin/win/x64/7za.exe')

function zipWithChecksum (exeName, { keepExe }) {
  if (!fs.existsSync(SEVEN_ZIP)) {
    console.error(`找不到 7za:${SEVEN_ZIP}`)
    console.error('它是 electron-builder 的相依,請先在 main/ 跑 npm ci。')
    process.exit(1)
  }

  const zipName = exeName.replace(/\.exe$/, '.zip')
  const sumName = 'SHA256SUM.txt'
  const sumPath = path.join(DIST, sumName)

  fs.writeFileSync(sumPath, [
    `# Awakened PoE Trade-zh-TW ${VERSION}`,
    '#',
    '# 驗證方式:',
    '#   PowerShell:  Get-FileHash <檔名> -Algorithm SHA256',
    '#   bash:        sha256sum <檔名>',
    '#',
    '# 算出來的值與下面不同就不要執行。',
    '#',
    '# 這份對照檔與檔案放在同一個壓縮檔裡,擋得住下載損毀,但擋不住惡意竄改 ——',
    '# 要確認來源可信,請比對 Release 頁面上公告的雜湊。',
    '',
    `${sha256(path.join(DIST, exeName))}  ${exeName}`,
    ''
  ].join('\n'), 'utf8')

  fs.rmSync(path.join(DIST, zipName), { force: true })
  // -mx=1:exe 本身已經壓縮過,再壓幾乎沒有收益,不值得多花好幾分鐘
  execFileSync(SEVEN_ZIP, ['a', '-tzip', '-mx=1', zipName, exeName, sumName], {
    cwd: DIST,
    stdio: 'pipe'
  })
  fs.rmSync(sumPath, { force: true })
  if (!keepExe) fs.rmSync(path.join(DIST, exeName), { force: true })

  console.log(`封裝:${zipName}(內含 ${exeName} + ${sumName})${keepExe ? '' : ' —— 原 exe 已移除'}`)
  return zipName
}

if (process.argv.includes('--write')) {
  for (const e of fs.readdirSync(DIST, { withFileTypes: true })) {
    if (!e.isFile() || !/\.exe$/.test(e.name)) continue
    // 安裝檔留著獨立一份給自動更新;攜帶版沒有這個包袱,只出 zip
    zipWithChecksum(e.name, { keepExe: /Setup/i.test(e.name) })
  }
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

// 斷言三:`latest.yml` 引用的每個檔案都必須真的存在,且檔名逐字相同。
// 更新器讀 latest.yml 去找對應的 asset,對不上就是安靜失敗 —— 使用者只會看到
// 「檢查更新失敗」,不會知道是檔名的問題。
const latestYml = entries.find(e => e.isFile() && UPDATE_MANIFEST.test(e.name))
if (latestYml !== undefined) {
  const yml = fs.readFileSync(path.join(DIST, latestYml.name), 'utf8')
  const referenced = new Set(
    [...yml.matchAll(/^\s*(?:-\s*url|path):\s*(.+?)\s*$/gm)].map(m => m[1])
  )
  const present = new Set(hashed.map(h => h.name))
  const dangling = [...referenced].filter(r => !present.has(r))
  if (dangling.length > 0) {
    console.error(`${latestYml.name} 指向的檔案不存在:`)
    for (const d of dangling) console.error(`  ${d}`)
    console.error('\n實際有的是:')
    for (const h of hashed) console.error(`  ${h.name}`)
    console.error('\n更新器會照 latest.yml 去找 asset,對不上就是安靜失敗。')
    process.exit(1)
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

if (process.argv.includes('--write')) {
  const out = path.join(DIST, `SHA256SUMS-${VERSION}.txt`)
  fs.writeFileSync(out, body, 'utf8')
  console.log(`已寫入 ${out}`)
  console.log(`\n接著上傳這 ${hashed.length} 個檔 + 這份清單。其中:`)
  console.log('  .zip     給手動下載的人(裡面附了對照檔,不會漏)')
  console.log('  Setup 的 .exe  給 electron-updater —— latest.yml 指向它,少了就更新不到')
  console.log('\n然後建 tag(先 push 分支再建,否則 gh release 會把 tag 建在遠端舊 HEAD):')
  console.log(`  git tag -a v${VERSION} -m "Awakened PoE Trade-zh-TW ${VERSION}"`)
  console.log('  # 本專案沒有 GPG 金鑰,歷來都是 annotated tag。要改簽章請先產金鑰再改成 -s。')
} else {
  console.log('(乾跑。加 --write 才會寫進 main/dist/)')
}
