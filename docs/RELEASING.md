# 發布流程與防竄改設定

本專案**沒有 code signing 憑證**。使用者能驗證「這支 exe 真的是維護者發的」的唯一
依據,是這份流程產出的雜湊清單與 GPG 簽章的 tag。流程走完整套,那兩樣才有意義。

---

## 一次性:GitHub 端設定

這些要在 GitHub 網頁上點,只做一次。

### 1. 帳號 2FA(**先做這個**)

`Settings → Password and authentication → Two-factor authentication`

這是唯一的根防線。帳號被奪的話,下面所有措施都會跟著失效 —— 攻擊者可以同時
換掉 exe、換掉 SHA256SUMS、刪掉 tag 再重打一個。

### 2. Ruleset 保護 `main`

`Settings → Rules → Rulesets → New branch ruleset`

- Target branches:`main`
- ☑ Restrict deletions
- ☑ Block force pushes

防的是「歷史被悄悄改寫」——沒有這個,`git push --force` 可以讓某個 commit
從歷史上消失,而 Release 仍指著那個 tag。

### 3. Ruleset 保護 `v*` tag

`Settings → Rules → Rulesets → New tag ruleset`

- Target tags:`v*`
- ☑ Restrict deletions
- ☑ Block force pushes

**這條最重要。** 沒有它,已發布版本的 tag 可以被刪掉再指向另一個 commit,
使用者跑 `git verify-tag v3.29.900` 驗到的會是攻擊者的版本。

### 4. Immutable releases(若設定裡有這個選項)

`Settings → General → Releases`

開啟後,Release 發布之後 assets 不能再修改或刪除。這直接堵掉「悄悄換掉
已發布的 exe、但版本號與公告不變」這條路。

### 5. GPG 金鑰

`Settings → SSH and GPG keys → New GPG key`

把公鑰貼上去,GitHub 才會在簽章的 tag 與 commit 旁顯示 **Verified** 標章。
本機要先設定:

```shell
git config user.signingkey <你的 key id>
```

---

## 每次發布

### 1. 前置檢查

```shell
cd renderer
npm run verify-datasets          # en 與 cmn-Hant 的語言無關鍵必須對齊
npm run make-index-files         # 確保索引與 ndjson 同步
npm run lint                     # ⚠ `npm run build` 不含它
npm run verify-i18n              # ⚠ 漏翻不會讓建置失敗,只會安靜退回英文
npm test                         # ⚠ 解析器回歸網,見下
npm run build                    # 型別檢查 + 打包 renderer
```

> ### ⚠ 每一步都要看退出碼,不要接管線
>
> `npm run build | tail -2` 這種寫法**會把失敗吞掉** —— 管線的退出碼是最後一個
> 指令(`tail`)的,所以 `&&` 後面照跑。實際發生過:renderer 建置失敗被吃掉,
> 打包照樣成功,產出的 exe 裡是**上一次建置的 renderer**,版號對、檔案新、
> 功能沒進去。要精簡輸出就導檔再看:
>
> ```shell
> npm run build > /tmp/build.log 2>&1; echo "exit=$?"; tail -4 /tmp/build.log
> ```

> ### ⚠ `npm run build` **不會**跑 lint 也不會跑測試
>
> `build` 是 `vue-tsc --noEmit && vite build` —— 型別過了不代表 lint 過。
> 3.29.904 就是這樣發出去的:程式碼正確、型別乾淨,卻因為四行縮排讓 CI 紅掉
> (CI 已於 2026-08-08 移除,所以現在**沒有任何獨立的建置驗證**,這些本機
> 檢查是唯一防線)。

> ### 解析器回歸網(`npm test`)
>
> 拿真實剪貼簿文字跑一遍,與人工核可過的快照逐欄比對。**改壞既有物品是靜默的** ——
> 認不出來的詞綴會被收進 `unknownModifiers` 而不是拋錯,型別/lint/建置全看不到。
>
> 更新快照:`UPDATE_FIXTURES=1 npm test`,然後 `git diff renderer/test/fixtures/`
> **逐項核對再 commit**。盲目更新等於把回歸網拆掉:解析器壞掉時它會把錯誤結果
> 寫成「期望值」,測試從此永遠是綠的。
>
> ⚠ 目前只有繁中三件樣本。測試會列出沒有樣本的語系 —— 那是待補清單,不是雜訊。
>
> ⚠ 本機第一次跑會說「'eslint' 不是內部或外部命令」—— 那不是壞掉,是
> `renderer/node_modules` 少了 dev 相依。**修法只有 `npm ci`**:
>
> ```shell
> cd renderer && npm ci
> ```
>
> **不要用 `npm install` 補**。實測它會把 `package-lock.json` 砍掉 331 行
> (整棵 eslint 連同其他 dev 相依),而且回報「up to date」不報任何錯 ——
> 之後 `npm ci` 就再也裝不出 eslint,CI 卻還是紅的。真的誤跑了就
> `git checkout -- renderer/package-lock.json` 還原再 `npm ci`。
>
> **2026-08-08 已修掉這個坑的根源**:eslint、eslint-plugin-vue 與
> `@vue/eslint-config-*` 過去裝在 `node_modules` 卻**沒登記進 `package.json`**,
> 所以任何一次 `npm install`(哪怕只是加一個無關套件)都會把它們 prune 掉。
> 現在它們是正式的 devDependencies,`npm i` 新套件不會再讓 lint 消失。

```shell
cd main
npm run check-user-agent         # ⚠ 見下方,遊戲改版後這是最容易漏掉的一步
```

`main/package.json` 的 `version` 要 bump。**它是版本的唯一真值** ——
About 頁、tray 提示、產物檔名、`latest.yml`、**以及 User-Agent** 全部從它來。

> ⚠ 版號必須比上一個 Release **大**。`electron-updater` 純比 semver,
> 而且 `-rc.1` 這類 prerelease 標記排序**低於**同號正式版,不要拿來當後綴。

> ### ⚠⚠ major.minor 不是我們能自由選的
>
> Electron 把版號寫進 User-Agent,而 **GGG 的 Cloudflare 用它擋過舊的第三方工具**。
> 卡的是 `major.minor` 必須等於**當前遊戲版本系列**:
>
> | UA 版本 | 結果 |
> |---|---|
> | `3.29.0` / `3.29.101` / `3.29.900` | 200 |
> | `3.0.0` / `0.1.0` | 403(太舊) |
> | `3.30.0` | 403(**比現行還新也擋**) |
>
> 所以本專案用 `3.29.<我們的號>`,patch 從 **900** 起(避開上游的 1xx)。
>
> **遊戲改版到 3.30 時,沒跟著把版號改成 `3.30.9xx`,所有使用者會在改版當天
> 同時失效。** 症狀極度誤導:app 說「Failed to load leagues,可能要完成 CAPTCHA」,
> 內建瀏覽器顯示 Cloudflare 的「Sorry, you have been blocked」,兩者都不提版號;
> 同一台機器用一般瀏覽器 UA 打同一個 API 卻是 200,很容易誤判成 IP 被封或 cookie 過期。
>
> `npm run check-user-agent` 會用**開發模式與打包後兩種 UA** 實打 GGG API,
> 被擋就非零退出。改版後第一件事就是跑它。

### 2. 清空舊產物再打包

```shell
rm -rf main/dist                 # 不清的話上一版的 exe 會混進雜湊清單
cd renderer && npm run build
cd ../main   && npm run build && npm run package
```

> ⚠ `package` 一定要帶 `-p never`(已寫在 npm script 裡,不要拿掉)。
> electron-builder 的**預設策略是 `onTagOrDraft`** —— 只要 `electron-builder.yml`
> 有 `publish` 設定,而 HEAD 剛好在 tag 上、或遠端已有 draft release,
> 它就會**自己建立 draft 並上傳檔案**。實際發生過:本機打包一次就多出一個
> 內容不完整的 draft release。發布必須是刻意的動作,由下面的 `gh release create` 執行。

### 3. 產生雜湊清單

```shell
cd main && npm run checksums -- --write
```

腳本會擋下兩種錯誤:`main/dist/` 有不認得的檔案(可能該簽卻沒簽),
以及產物檔名不含當前版號(上一版的殘留)。**兩種都是硬失敗,不是警告。**

它同時會把每個 exe 封進一個 `.zip`,裡面附一份只針對該檔的 `SHA256SUM.txt` ——
起因是使用者只下載了 exe、沒下載旁邊的對照檔,結果無從比對。

> ⚠ **附在 zip 裡的對照檔擋不住惡意竄改**,能改 zip 的人也能改它。它解決的是
> 「漏下載」與「下載損毀」。要確認來源可信,靠的是 Release 說明裡公告的雜湊 ——
> 那是另一個管道,所以第 5 步仍然要把雜湊寫進說明。

> ⚠ **安裝檔會同時保留一份獨立的 `.exe`**,不要以為 zip 可以取代它:
> `latest.yml` 的 `url` 指向那個檔名,electron-updater 直接去
> `releases/download/<tag>/<檔名>` 抓,只給 zip 就是 404,而且更新失敗是安靜的。
> 攜帶版沒有這個限制,所以只出 zip。

### 4. tag

```shell
git push origin master              # 先推分支,再建 tag
git tag -a v3.29.900 -m "Awakened PoE Trade-zh-TW 3.29.900"
git push origin v3.29.900
git rev-parse v3.29.900^{}          # 必須等於 master HEAD
```

> ⚠ 本專案的預設分支是 **`master`**,不是 `main`。

> ⚠ **順序不能顛倒。** 先建 tag 再推分支的話,`gh release create` 會把 tag 建在
> 遠端**當時的** HEAD 上 —— 附件、發版說明全對,只有 Release 頁的原始碼是上一版,
> 而且 `targetCommitish` 只顯示 `"master"`,從介面上看不出來。實際發生過。
> 驗證只認 `git rev-parse <tag>^{}`:annotated tag 自己有一個 hash,
> `git ls-remote --tags` 印的是那個,**不是它指向的 commit**。

> 本專案**沒有 GPG 金鑰**,歷來的 tag 都是 annotated 而非簽章。要改成 `-s`
> 得先產金鑰並上傳到 GitHub;已經存在的 tag 補不回去。

> ### ⚠⚠ `gh` 預設指向的是**上游**,不是我們的 repo
>
> 這個 clone 有兩個 remote(`origin` 是我們的、`upstream` 是 SnosMe 的),而
> `gh repo view` 實測回的是 **`SnosMe/awakened-poe-trade`**。不帶 `--repo` 的
> `gh release create` 會往上游發 —— 權限會擋下來,但錯誤訊息不會告訴你是打錯了地方。
>
> 每條 `gh` 指令都帶 `--repo Hsiung-Shao/awakened-poe-trade-zh-TW`,或先固定一次:
>
> ```shell
> gh repo set-default Hsiung-Shao/awakened-poe-trade-zh-TW
> ```

⚠ `git tag` 預設是**字串排序**,`v0.10.0` 會排在 `v0.9.0` 前面。
列 tag 一律加 `--sort=v:refname`,否則會誤以為某個版本沒打過 tag。

### 5. 建立 Release

上傳 `main/dist/` 裡的:

- 安裝版 `.zip`(給手動下載的人,內含對照檔)
- 免安裝版 `.zip`(同上)
- 安裝版 `.exe`(**給 electron-updater**,`latest.yml` 指向它,漏掉就更新不到)
- `latest.yml`(**漏掉的話「檢查更新」會失敗**,electron-updater 就是讀它)
- `SHA256SUMS-<版本>.txt`

發版說明要講清楚 `.exe` 與 `.zip` 的分工,否則使用者會直接抓那個獨立的 exe,
又回到「漏下載對照檔」的原點。

Release 說明裡要放雜湊值本身,不要只放檔案連結 —— 使用者要能在不下載附件的
情況下看到該比對什麼。

### 6. 發布後驗證

```shell
# 從 GitHub 重新下載,重算雜湊,與公告比對
sha256sum <下載回來的檔>
```

#### 怎麼實測「檢查更新」

⚠ **開發模式測不出來。** electron-updater 會直接跳過:

```
Skip checkForUpdates because application is not packed and dev update config is not forced
```

要測就得跑**打包後**的執行檔,而且版本要比 Release 舊:

1. 暫時把 `main/package.json` 的 version 調低一階(例如 `3.29.899`)
2. `npm run build && npm run package`,執行產生的 portable exe
3. 查詢 app 自己的狀態端點 —— 它直接回報更新器狀態,不必看 UI:

```powershell
# 打包版的 port 是隨機的(開發模式才固定 8584),先找出來
$pids = (Get-Process | Where-Object { $_.ProcessName -match 'Awakened' }).Id
$port = (Get-NetTCPConnection -State Listen | Where-Object { $pids -contains $_.OwningProcess }).LocalPort
(Invoke-WebRequest "http://127.0.0.1:$port/config" -UseBasicParsing).Content | ConvertFrom-Json
```

期望結果:

```json
{ "state": "update-available", "version": "3.29.900", "noDownloadReason": "unsigned-build" }
```

4. **確認沒有自動下載**:看 `%LOCALAPPDATA%\awakened-poe-trade-updater`。

   > ### ⚠⚠ 「有 `installer.exe` 就代表 autoDownload 沒關掉」是**錯的判準**
   >
   > 這條寫在這裡誤導過一次。實測(3.29.904 發布後):**NSIS 安裝檔自己就會在那個
   > 目錄放一份 `installer.exe`** —— 把 app 關掉、刪掉該檔、單獨執行 Setup,
   > 檔案照樣出現。它跟更新器有沒有自動下載完全無關。
   >
   > 那個目錄還是**兩個 app 共用的**:`updaterCacheDirName` 是
   > `awakened-poe-trade-updater`,與官方版 APT 相同。實測看到
   > `pending\Awakened-PoE-Trade-Setup-3.29.103.exe`(檔名沒有 `-zh-TW`)——
   > 那是官方版下載的,不是我們的。
   >
   > **可信的判準只有一個:app 自己回報的更新器狀態。** 上面第 3 步的 `/config`
   > 回 `noDownloadReason` 就代表它決定不下載。要再確認一層,就比對
   > `installer.exe` 的 SHA-256 是不是「比目前安裝版**更新**的那一版」——
   > 等於現行版本的話,那份是安裝當下留的,不是下載來的。

5. 測完把版本改回去,並清掉 `main/dist`

---

## 已知缺口(誠實記錄)

- **這套防的是「Release 被換掉」,防不了「維護者帳號被奪」。** 帳號一旦失守,
  攻擊者可以重簽一切。真正的解法是 code signing 憑證,本專案目前不打算買。
- **GPG 簽章驗的是 tag 指向哪個 commit,不是 exe 本身。** 從 commit 到 exe
  之間是本機建置,沒有可重現建置(reproducible build)保證。要補上這一段,
  得改成在 CI 建置並啟用 build provenance attestation。
- 使用者實際上**幾乎不會**去核對雜湊。這套的價值主要在於:出事時有辦法證明
  哪一份是真的。
