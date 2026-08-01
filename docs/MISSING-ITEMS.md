# 上游資料庫缺的物品:對照表怎麼來的

上游 APT 的 `items.ndjson` 缺了一批交易站其實搜得到的物品。查價時的症狀是
**Unknown Item** 或「解析物品時發生錯誤」。這**不是繁體中文的問題** ——
英文版一樣查不到。

補進去的東西放在 [`scripts/missing-items.json`](../scripts/missing-items.json),
由 [`scripts/gen-missing-items.mjs`](../scripts/gen-missing-items.mjs) 寫進資料檔。

| 分類 | 筆數 |
|---|---:|
| 通貨 | 173 |
| 命運卡 | 11 |
| 接肢(Graft) | 17 |
| **傳奇物品** | **202** |

---

## 為什麼只收這幾類

APT 查資料庫的方式**依物品類別而異**,所以「上游沒有這個名字」不一定等於「壞掉」。

```
Parser.ts:findInDatabase
  命運卡        → ITEM_BY_TRANSLATED('DIVINATION_CARD', 物品名)
  技能寶石      → ITEM_BY_TRANSLATED('GEM',             物品名)
  傳奇          → ITEM_BY_TRANSLATED('UNIQUE',          物品名)   ← 依名字
  其餘          → ITEM_BY_TRANSLATED('ITEM',            基底名)   ← 依基底
```

- **通貨 / 命運卡 / 接肢 / 傳奇是依名字查的** —— 名字不在資料庫就是查不到,必收。
- 一般的防具 / 武器 / 飾品是**依基底類型**查的。名稱比對會顯示這些分類「覆蓋率
  只有五成」,但那是設計如此,不是缺漏。光靠名稱比對分不出「真的缺」與「設計不同」,
  所以**不收**。

傳奇是後來才發現的:它明明走「依名字」那條路,卻缺了 202 個,連 Voidheart、
Timetwist、Frostferno 這種老東西都沒有。

---

## 每一筆通過了什麼驗證

### 通貨 / 命運卡 / 接肢

1. 國際服交易 API 有這個英文名(交易站真的搜得到)
2. 上游的 `en/items.ndjson` 沒有它(確實是缺漏,不是我們誤判)
3. GGPK 遊戲檔(第一真值)查得到英文 → 繁中
4. 台服交易 API 也認得那個繁中名(第三方獨立證人)

繁中名若已被現有資料佔用一律剔除 —— 撞名會讓查表拿到錯的物品。

### 傳奇物品

三個獨立證人,**至少兩個相符且無人反對**才收:

| | 來源 | 對接鍵 |
|---|---|---|
| A | GGPK `words.Text2`(第一真值) | 英文原字 |
| B | poedb.tw `/tw/api/Trade`,`type == 'Unique'` | 它自己語言無關的 `us` 欄 |
| C | 台服交易 API | 「英文底材所對應的繁中底材」底下必須掛著這個繁中名 |

**判準本身先回測過。** 「傳奇名在 `words.Text2`」與「poedb 的 `us` 欄可直接對接」
這兩條,拿上游**已經收了的 1254 筆傳奇**回測:

```
A 對 1254 筆:1254/1254 相符
B 對 1254 筆:poedb 全部收錄,0 筆不符
```

結果:

| 證人組合 | 筆數 |
|---|---:|
| GGPK + poedb | 201 |
| 國際服 + 台服交易站(底材強制配對) | 1 |

⚠ B 必須用 poedb 自己的 `type` 欄分流。**同一個英文名在 poedb 常有多筆** ——
`Wildfire` 同時是技能寶石「地獄火群」與傳奇珠寶「燐火」,取第一筆會拿到錯的。

### 有保留的 7 筆(記在表的 `note` 欄)

- **台服交易站未上架**(6 筆):`Broadstroke`、`Cragfall`、`Demigod's Presence`、
  `Demigod's Stride`、`Demigod's Touch`、`The Wellhook`。GGPK 與 poedb 都給出同一個
  繁中名,但台服交易站沒有這些條目。繁中名仍然正確(解析用得到),只是在台服搜不到
  —— 那是台服本來就沒有,不是我們的問題。
- **比 GGPK / poedb 快照都新**(1 筆):`The Draugur's Lantern` / 屍鬼提燈。
  兩份離線快照都還沒有這個名字。它靠的是**語言無關的底材強制配對**:
  `Ancient Spirit Shield` ↔ `遠古魔盾` 底下,兩服各自恰好只剩一個未歸屬的傳奇。

`note` 欄不是裝飾,是**下次重跑時該優先複查的清單**。

---

## 怎麼重新產生這份表

⚠ **產生對照表的 GGPK 管線只在維護者本機,不在這個 repo 裡。**
repo 裡有的是**產物**(`missing-items.json`)與**把產物寫進資料檔的腳本**。

重跑需要:

1. **國際服交易 API** `https://www.pathofexile.com/api/trade/data/items`
   —— 英文名清單與底材。帶一般瀏覽器 UA 即可,403 是缺 UA 不是要登入。
2. **台服交易 API** `https://pathofexile.tw/api/trade/data/items`
   —— 注意 canonical host 是 `pathofexile.tw`,`www.` 會 301。
3. **poedb.tw** `https://poedb.tw/{us,tw}/api/Trade` —— 回傳 `{type, us, lang}`,
   `us` 是語言無關的鍵。
4. **GGPK 繁中對照**(維護者本機的 SQLite 版本化快照)。

判定「上游有沒有」時:

> ⚠ 基準必須是**上游原始資料**(`git show 18a401e:renderer/public/data/en/items.ndjson`),
> **不是工作目錄裡那份** —— 否則第二次產生時會把已經補上的物品當成「上游本來就有」
> 而從表裡刪掉。這個坑實際踩過一次,表從 184 筆縮成 17 筆。

寫回資料檔:

```shell
cd renderer && npm run regen-data
```

⚠ 順序是硬性的,原因見 [DEVELOPING.md 的資料維護章節](../DEVELOPING.md)。

---

## 上游哪天自己補上了怎麼辦

`gen-missing-items.mjs` 會偵測並提示。它產生的每一列都帶 `"src":"zh-tw-missing"`,
每次執行先把帶標記的列清掉再重放;若某個 `refName` 在**沒有標記的列**裡已經出現,
就讓上游那筆勝出(上游的通常還有 icon 與 tradeTag),並印出可以從表裡移除的清單。

比對帶 `namespace`,不只比 `refName`。同一個英文名在不同 namespace 是不同東西
(`Wildfire` 是 GEM 也是 UNIQUE),不分 namespace 的話上游補上其中一個,
我們的另一個就會被誤判成「已有」而悄悄消失。
