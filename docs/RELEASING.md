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
使用者跑 `git verify-tag v0.1.0` 驗到的會是攻擊者的版本。

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
```

`main/package.json` 的 `version` 要 bump。**它是版本的唯一真值** ——
About 頁、tray 提示、產物檔名、`latest.yml` 全部從它來。

> ⚠ 版號必須比上一個 Release **大**。`electron-updater` 純比 semver,
> 而且 `-rc.1` 這類 prerelease 標記排序**低於**同號正式版,不要拿來當後綴。

### 2. 清空舊產物再打包

```shell
rm -rf main/dist                 # 不清的話上一版的 exe 會混進雜湊清單
cd renderer && npm run build
cd ../main   && npm run build && npm run package
```

### 3. 產生雜湊清單

```shell
cd main && npm run checksums -- --write
```

腳本會擋下兩種錯誤:`main/dist/` 有不認得的檔案(可能該簽卻沒簽),
以及產物檔名不含當前版號(上一版的殘留)。**兩種都是硬失敗,不是警告。**

### 4. 簽章的 tag

```shell
git tag -s v0.1.0 -m "Awakened PoE Trade-zh-TW 0.1.0"
git push origin main
git push origin v0.1.0
git verify-tag v0.1.0            # 自己先驗一次
```

⚠ `git tag` 預設是**字串排序**,`v0.10.0` 會排在 `v0.9.0` 前面。
列 tag 一律加 `--sort=v:refname`,否則會誤以為某個版本沒打過 tag。

### 5. 建立 Release

上傳 `main/dist/` 裡的:

- 安裝版 `.exe`
- 免安裝版 `.exe`
- `latest.yml`(**漏掉的話「檢查更新」會失敗**,electron-updater 就是讀它)
- `SHA256SUMS-<版本>.txt`

Release 說明裡要放雜湊值本身,不要只放檔案連結 —— 使用者要能在不下載附件的
情況下看到該比對什麼。

### 6. 發布後驗證

```shell
# 從 GitHub 重新下載,重算雜湊,與公告比對
sha256sum <下載回來的檔>
```

再用舊版本跑一次「檢查更新」,確認能看到新 Release。

---

## 已知缺口(誠實記錄)

- **這套防的是「Release 被換掉」,防不了「維護者帳號被奪」。** 帳號一旦失守,
  攻擊者可以重簽一切。真正的解法是 code signing 憑證,本專案目前不打算買。
- **GPG 簽章驗的是 tag 指向哪個 commit,不是 exe 本身。** 從 commit 到 exe
  之間是本機建置,沒有可重現建置(reproducible build)保證。要補上這一段,
  得改成在 CI 建置並啟用 build provenance attestation。
- 使用者實際上**幾乎不會**去核對雜湊。這套的價值主要在於:出事時有辦法證明
  哪一份是真的。
