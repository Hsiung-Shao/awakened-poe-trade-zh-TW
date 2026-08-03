# Awakened PoE Trade-zh-TW

[Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) 的**繁體中文修正版**。

原作是流亡黯道最廣泛使用的查價工具,但它對繁體中文客戶端長期是壞的 —— 物品文字解析
不了,海圖與傭兵契約書也搜不到正確結果。本專案修掉這些,其餘功能與原作完全相同。

> ### ⚠ 使用前必讀
>
> 本專案與 Grinding Gear Games **無隸屬關係,也未獲任何授權**。GGG 公開表示
> 不鼓勵第三方工具,且不保證任何工具現在或未來被允許。
> **帳號被限制或停權的風險無法排除,使用即代表你自行承擔。**
>
> 詳情與如何把風險降到最低 → **[免責聲明與風險說明](./docs/DISCLAIMER.md)**

---

## 下載

到 [Releases](https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW/releases) 取得
安裝版或免安裝版。

**安裝檔沒有數位簽章**,Windows SmartScreen 會跳警告(點「更多資訊」→「仍要執行」)。
每個 Release 都附 `SHA256SUMS-<版本>.txt`,請下載後核對:

```powershell
Get-FileHash .\Awakened-PoE-Trade-zh-TW-Setup-3.29.900.exe -Algorithm SHA256
```

算出來的值與 Release 頁公告的不同 → **不要執行**。

### 與官方版並存

安裝目錄與解除安裝項目是分開的,但**設定目錄共用**(都是 `%APPDATA%\awakened-poe-trade`)。
所以從官方版換過來時聯盟、熱鍵、登入狀態會自動沿用,**但兩個版本不要同時執行**。

---

## 修正內容

### 一、繁體中文客戶端無法解析物品

以 71 件國際服繁中客戶端實機複製的物品驗證,修掉 7 類缺陷:

- **分隔線長度不固定** —— 繁中的分隔線長度等於前一行顯示寬度(260 條裡 258 條),
  上游嚴格比對八個 dash,導致**每一件物品**都解析失敗
- **魔法物品名沒有空格** —— 上游用 `split(' ')` 切詞,繁中切不出基底類型
- **進階物品說明的空行** —— 每條分隔線後多一個空行,讓 `section[0] === …` 全部落空
- **無標註詞綴被跳過** —— 腰帶的 7 條詞綴、法杖的 implicit 全部無聲消失
- **全形冒號** —— 有些客戶端輸出 `物品種類：` 不帶空格,第一行就比對失敗
- **詞綴標籤分隔** —— 繁中用不帶空格的逗號,`防禦,護甲` 會黏成單一標籤
- **區域等級兩種寫法** —— 劫盜/遠征用「地區等級」,海圖/聖域用「區域等級」

而且上游的失敗是**無聲的**(例外丟進 console、回一個沒有訊息的 `parse_error`),
使用者連要回報什麼都不知道。本版把例外訊息帶進錯誤字串。

### 二、海圖區域與傭兵流派搜不到

交易站對這兩種物品的欄位擺法跟一般物品**相反**:變體是獨立的可搜尋類型,
`type` 放語言無關的內部 id、顯示名在 `text`,送顯示名必定搜不到。

| 查詢 | 修正前 | 修正後 |
|---|---|---|
| 傭兵契約書(動能師) | 10000(全遊戲所有契約書) | **812** |
| 珊瑚礁海圖(海洋王的領域) | 10000 | **247** |
| 珊瑚林海圖(海洋之柱) | 10000 | **443** |

**交易站本身的限制**(非本工具能修):69 個海圖區域只開放 **16 個**可搜尋;
傭兵**等級無法篩選**。

---

## 更新機制

啟動時與每 16 小時檢查一次。有新版時「設定 → 關於」會顯示版本號與一顆
**「Install now」按鈕,按下才會開始下載並在關閉程式時安裝**。

**程式不會自作主張下載或執行任何東西** —— 沒按按鈕之前,連暫存檔都不會產生。
下載的檔案由 electron-updater 比對 `latest.yml` 裡的 sha512。

想自己核對 SHA-256 再裝的人,按鈕下方另有一條「開啟下載頁」的連結。
加 `--no-updates` 參數可以連檢查都關掉;免安裝版沒有就地安裝的能力,一律走下載頁。

> 上游是**偵測到更新就在背景自動下載安裝**,使用者全程不知情。本專案要求按一下,
> 比上游保守 —— 但兩者的信任基礎相同,見[免責聲明](./docs/DISCLAIMER.md)。

---

## 開發

建置、資料維護、同步上游、**遊戲改版時必做的版號更新** → [DEVELOPING.md](./DEVELOPING.md)

發布流程與 GitHub 防竄改設定 → [docs/RELEASING.md](./docs/RELEASING.md)

---

## 致謝

本專案是衍生作品,**所有核心功能都出自原作者之手**。如果這個工具對你有幫助,
請支持原作者:[Patreon](https://patreon.com/awakened_poe_trade)。

> ### 兩個贊助連結分別是誰的
>
> 程式裡設定頁的贊助連結指向**本繁中版維護者**
> ([Buy Me a Coffee](https://buymeacoffee.com/hsiung)),贊助的是繁體中文的
> 修正與維護,**不是** Awakened PoE Trade 本身的開發。
>
> **原作者的贊助入口沒有被移除**,在程式的「關於」頁與上面這一行都找得到。
> 核心功能是他寫的,請優先支持他。
>
> 上游程式內的贊助者名單(247 位)已一併移除 —— 那些人贊助的是原作者,
> 不是這份建置,留著會造成誤解。

| 專案 | 作者 | 貢獻 |
|---|---|---|
| [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) | [@SnosMe](https://github.com/SnosMe) | 本專案的全部基礎 |
| [poe.ninja](https://poe.ninja/) | [@rasmuskl](https://github.com/rasmuskl) | 經濟資料 |
| [PoE Wiki](https://www.poewiki.net/) | contributors | 遊戲資料 |
| [poeprices.info](https://www.poeprices.info/) | [@SlugPranker](https://github.com/SlugPranker) | 機器學習價格預測 |
| [RePoE](https://github.com/brather1ng/RePoE) | [@brather1ng](https://github.com/brather1ng) | 遊戲資料 |
| [PyPoE](https://github.com/OmegaK2/PyPoE) | [@OmegaK2](https://github.com/OmegaK2) | 遊戲資料 |
| [libuiohook](https://github.com/kwhat/libuiohook) | [@kwhat](https://github.com/kwhat) | 全域熱鍵 |

繁體中文的詞綴與物品名以國際服 GGPK 遊戲檔為第一真值,並與 RePoE、poedb.tw、
台服交易站 API 交叉比對。

## 授權

MIT。原作 Copyright (c) 2020 Alexander Drozdov,條文見 [LICENSE](./LICENSE);
本專案的修改同樣以 MIT 釋出。上游基準:3.29.102(commit `18a401e`)。
