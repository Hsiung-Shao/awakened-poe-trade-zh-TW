# Awakened PoE Trade-zh-TW

[Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) 的**繁體中文修正版**。

原作是流亡黯道最廣泛使用的查價工具,但它對繁體中文客戶端長期是壞的 —— 解析不了物品
文字,海圖與傭兵契約書也搜不到正確結果。本專案修掉這些問題,其餘功能與原作相同。

| | |
|---|---|
| 上游專案 | [SnosMe/awakened-poe-trade](https://github.com/SnosMe/awakened-poe-trade) |
| 上游基準版本 | 3.29.102(commit `18a401e`) |
| 本版版號 | 0.1.0(**與上游脫鉤,自成一序**) |
| 授權 | MIT |

---

## 修了什麼

### 一、繁體中文客戶端無法解析物品

以 71 件國際服繁中客戶端(Allflame 聯盟)實機複製的物品驗證。上游不成立的假設:

| 問題 | 上游行為 | 實況 |
|---|---|---|
| 分隔線 | 嚴格比對八個 dash | 繁中的分隔線長度**等於前一行的顯示寬度**(260 條裡 258 條),導致**每一件物品**都解析失敗 |
| 魔法物品名 | `name.split(' ')` 切詞 | 繁中名稱沒有空格,切不出基底類型 |
| 進階物品說明 | 不處理 section 開頭空行 | 該格式每條分隔線後多一個空行,`section[0] === …` 這類判斷全部落空 |
| 無標註詞綴 | 沒有 `{ }` 標記的 section 直接跳過 | 腰帶的 7 條詞綴、法杖的全部 implicit **無聲消失** |
| 標點慣例 | 只認半形 `物品種類: ` | 有些客戶端輸出全形 `物品種類：` 且不帶空格,**第一行就比對失敗** |
| 詞綴標籤 | 分隔符只認 em-dash、標籤用 `', '` 切 | 繁中用不帶空格的逗號,`防禦,護甲` 會黏成單一標籤 |
| 區域等級 | 只認「地區等級」 | 繁中有**兩種寫法**:劫盜/遠征用「地區等級」,海圖/聖域用「區域等級」 |

而且失敗是**無聲的** —— 上游把例外丟進 console、回一個沒有訊息的 `parse_error`,
使用者連要回報什麼都不知道。本版把例外訊息帶進錯誤字串。

### 二、海圖區域與傭兵流派搜不到

交易站對這兩種物品的欄位擺法跟一般物品**相反**:變體是獨立的可搜尋類型,
`type` 放語言無關的內部 id,顯示名在 `text`。

```json
{"type":"BrineKingsDomain","text":"珊瑚礁海圖(海洋王的領域)","disc":"chart_coral_reef"}
```

送顯示名必定搜不到,查詢會退回基底類型。結果:

| | 修正前 | 修正後 |
|---|---|---|
| 傭兵契約書(動能師) | 10000 筆(全遊戲所有契約書) | 812 |
| 珊瑚礁海圖(海洋王的領域) | 10000 筆 | 247 |
| 珊瑚林海圖(海洋之柱) | 10000 筆 | 443 |

**已知限制**:交易站只開放 69 個海圖區域裡的 **16 個**可搜尋,其餘區域交易站本身不支援;
傭兵**等級無法篩選**(12 個 filter 群組都沒有 `mercenary_level`)。這兩項都是交易站的
限制,不是本工具能修的。

---

## 安裝

到 [Releases](https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW/releases) 下載,
有安裝版(`.exe`)與免安裝版(portable)兩種。

可以和官方版**同時安裝** —— 兩者的安裝目錄、登錄檔項目與設定目錄都是分開的。

### ⚠ 安裝檔沒有數位簽章

本專案沒有購買 code signing 憑證(一年約 US$200 起),所以:

- Windows SmartScreen 會跳警告,要點「更多資訊」→「仍要執行」
- **程式永遠不會自動下載安裝更新**(見下方「更新機制」)

取而代之,每個 Release 都附 `SHA256SUMS-<版本>.txt`,而且 tag 經過 GPG 簽章。
下載後請自行核對:

```powershell
# Windows PowerShell
Get-FileHash .\Awakened-PoE-Trade-zh-TW-Setup-0.1.0.exe -Algorithm SHA256
```

```bash
# 或用 git 驗證 tag 是本人簽的
git verify-tag v0.1.0
```

算出來的值必須與 Release 頁面公告的完全相同。**不相同就不要執行**。

---

## 更新機制

程式會在啟動時與每 16 小時檢查一次新版,但**只提示、不自動下載安裝**。

有新版時,設定頁的「關於」會顯示版本號與一顆開啟 Releases 頁的按鈕,由你自己決定
要不要下載。加上 `--no-updates` 參數可以連檢查都關掉。

> **為什麼不做自動更新?** 沒有 code signing 憑證的情況下開啟自動安裝,等於「任何能
> 寫入那個 GitHub Release 的人,就能在所有使用者的機器上執行任意程式」。這是整條
> 供應鏈風險最高的一環,而它換來的只是省下按一次下載。

---

## 本工具不與遊戲程序互動

| 會做 | 不會做 |
|---|---|
| 讀取剪貼簿 | 讀取遊戲記憶體 |
| 送出 `Ctrl + C` | 注入 DLL、hook 遊戲 process |
| overlay 疊加顯示 | 攔截或修改遊戲網路封包 |
| 1 個熱鍵 → 1 個動作 | 1 個熱鍵 → 連續多個遊戲動作 |
| 使用者手動觸發 | 定時輪詢、自動掃描背包 |
| 遵守 rate limit header | 忽略 429 持續重試 |

本專案與 Grinding Gear Games 無隸屬關係,亦未獲其認可。

---

## 開發

環境需求與建置步驟見 [DEVELOPING.md](./DEVELOPING.md)。`main` 與 `renderer` 是兩個
**各自獨立**的套件,沒有根 `package.json`,所以指令要分別在各自目錄下跑。

```shell
cd renderer && npm install && npm run make-index-files && npm run build
cd ../main   && npm install && npm run build && npm run package
```

### 資料維護

```shell
cd renderer
npm run gen-disc-variants        # 乾跑,只報告差異
npm run gen-disc-variants -- --write
npm run make-index-files         # ⚠ 改過 ndjson 後**必須**重建索引
npm run verify-datasets          # 檢查 en 與 cmn-Hant 的語言無關鍵是否對齊
```

`gen-disc-variants` 會打國際服與台服的交易站 API,用語言無關的 `type` 欄對接,
重新產生海圖區域與傭兵流派的 79 列變體。回應會快取在 `.cache/`,新賽季重跑前先刪掉。

### 同步上游

本 repo 是**淺層 clone**(shallow),要合併上游必須先取回完整歷史:

```shell
git fetch --unshallow upstream
git merge upstream/master
```

衝突只會出現在本專案改過的檔案。改完後務必重跑 `verify-datasets` 與實機測試。

---

## 致謝

本專案是 [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) 的衍生作品,
所有核心功能都出自原作者之手。如果這個工具對你有幫助,請支持原作者:
[Patreon](https://patreon.com/awakened_poe_trade)。

| 專案 | 作者 | 貢獻 |
|---|---|---|
| [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) | [@SnosMe](https://github.com/SnosMe) | 本專案的全部基礎 |
| [poe.ninja](https://poe.ninja/) | [@rasmuskl](https://github.com/rasmuskl) | 經濟資料 |
| [PoE Wiki](https://www.poewiki.net/) | contributors | 遊戲資料 |
| [poeprices.info](https://www.poeprices.info/) | [@SlugPranker](https://github.com/SlugPranker) | 機器學習價格預測 |
| [RePoE](https://github.com/brather1ng/RePoE) | [@brather1ng](https://github.com/brather1ng) | 遊戲資料 |
| [PyPoE](https://github.com/OmegaK2/PyPoE) | [@OmegaK2](https://github.com/OmegaK2) | 遊戲資料 |
| [libuiohook](https://github.com/kwhat/libuiohook) | [@kwhat](https://github.com/kwhat) | 全域熱鍵 |

繁體中文的詞綴與物品名以本機國際服 GGPK 遊戲檔為第一真值,並與 RePoE、poedb.tw、
台服交易站 API 交叉比對。

---

## 授權

MIT。原作 Copyright (c) 2020 Alexander Drozdov,完整授權條文見 [LICENSE](./LICENSE)。
本專案的修改同樣以 MIT 釋出。
