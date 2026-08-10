# 開發

## 架構

兩個部分,**互相依賴,缺一個都跑不起來**:

- **renderer** —— Electron 容器內的 UI(Vue 3 + Vite)
- **main** —— Electron 主行程,負責熱鍵、視窗、overlay、CORS proxy

⚠ **沒有根 `package.json`,這不是 npm workspace。** `main/` 與 `renderer/` 是兩個
各自獨立的套件,所有指令都要在各自目錄下跑。

## 開發模式

```shell
cd renderer
npm install
npm run make-index-files
npm run dev

# 另開一個終端機
cd main
npm install
npm run dev
```

⚠ 在 VSCode 的整合終端機裡,環境變數 `ELECTRON_RUN_AS_NODE=1` 會被子行程繼承,
讓 `electron.exe` 退化成純 Node、不開視窗也不報錯。啟動前先清掉它。

⚠ **`npm run dev` 與 `npm run build` 不能混用。** `build/script.mjs` 靠 `--prod`
決定畫面從哪來:開發模式指向 Vite dev server(`VITE_DEV_SERVER_URL`),正式模式
改讀磁碟上的 `main/dist/index.html` —— 那個檔案只有 electron-builder 打包時才會放進去。
跑了 `npm run build` 之後再直接啟動 Electron,會得到
`ENOENT: no such file or directory, open '...\main\dist\index.html'`。
要回到開發模式就重跑 `npm run dev`。

## 建置與打包

```shell
cd renderer && npm run make-index-files && npm run build
cd ../main   && npm run build && npm run package
```

產物在 `main/dist/`。完整發布流程見 [docs/RELEASING.md](./docs/RELEASING.md)。

---

## 資料維護

```shell
cd renderer
npm run regen-data                   # 這一條就是全部。順序見下。
```

它依序做四件事,**順序是硬性的**:

```
gen-missing-items --write   補上游缺的物品(通貨/命運卡/接肢/地圖碎片/傳奇)
gen-disc-variants --write   補同名多變體(占卜寶珠區域、海圖區域、傭兵流派)
make-index-files            重建 byte-offset 索引
verify-datasets             檢查 en 與 cmn-Hant 的語言無關鍵是否對齊
```

要單獨乾跑看差異就 `npm run gen-missing-items` / `npm run gen-disc-variants`
(不帶 `--write`)。

改完資料還要跑一支**不在 `regen-data` 裡**的稽核(它要連網):

```shell
npm run audit-trade-names            # 加 --verbose 看逐筆
```

**解析成功不等於查得到。** 送給交易站的搜尋條件是資料列的 `name` 那一串,交易站清單
裡沒有它就回 0 筆,而畫面上只會看起來像「這東西沒人賣」。`fixtures` 測的是解析、
`verify-datasets` 測的是兩語系對齊,**兩者都看不到這一層**。

這支拿國際服與台服的 `/api/trade/data/items` 當權威清單逐列核對,再與
`scripts/KNOWN-TRADE-GAPS.json` 比對:新出現的缺口、或清單裡突然查得到的條目,
都會讓它以非零碼結束。目前登記在案的是 `en` 4 筆、`cmn-Hant` 19 筆,每一筆都寫了理由
(舊版底材、大逃殺模式遺留的 `*Royale` 底材、台服未上架…),全部是遊戲與交易站的現況,
不是可修的缺陷。

> ### ⚠ 為什麼不能只跑其中一支
>
> 兩支都會「先移除自己上一輪產生的列」,而**判準有重疊**:占卜寶珠的 100 列區域
> 變體是前者產生的基底列的變體,同時帶 `"src":"zh-tw-missing"` 與 `"tradeType"`。
> 只跑 `gen-missing-items` 會把它們掃掉而不重建 —— **淨損 100 列,零錯誤訊息**。
>
> 順序也不能對調。前者把重建的列接在**檔尾**,後者把變體插在**基底列的下一行**;
> 索引依 `namespace::refName` 去重、只留第一筆的位移,查表再往後走相鄰同名列。
> 基底與變體一旦不相鄰,變體就永遠查不到。
>
> ⚠ `verify-datasets` **抓不到這種錯**。它比的是兩個語系之間是否對齊,而兩邊被砍掉
> 的是同一批 —— 一致地錯,照樣 PASS。改完資料要比的是**列數與上一版的差異**:
>
> ```shell
> git show HEAD:renderer/public/data/cmn-Hant/items.ndjson | wc -l
> wc -l < renderer/public/data/cmn-Hant/items.ndjson
> ```

`gen-disc-variants` 會打國際服與台服的交易站 API,用語言無關的 `type` 欄對接,
重新產生占卜寶珠 / 海圖 / 傭兵的 394 列變體。回應快取在 `.cache/`,新賽季重跑前先刪掉。

`gen-missing-items` 只讀 `scripts/missing-items.json`,**不打任何 API**。那份對照表
怎麼來的、每一筆通過哪些驗證,見 [docs/MISSING-ITEMS.md](./docs/MISSING-ITEMS.md)。

驗證方式:跑完後 `git diff` 應為空 —— 它們會逐位元組重現已入庫的資料。

`ko` 與 `ru` 由上游社群維護,本專案原樣沿用,兩支腳本都不處理它們。

---

## ⚠ 遊戲改版時必做:更新版號

Electron 把版號寫進 User-Agent,而 **GGG 的 Cloudflare 用它擋過舊的第三方工具**。
卡的是 `major.minor` 必須等於**當前遊戲版本系列**:

| UA 版號 | 結果 |
|---|---|
| `3.29.0` / `3.29.101` / `3.29.900` | 200 |
| `3.0.0` / `0.1.0` | 403(太舊) |
| `3.30.0` | 403(**比現行還新也擋**) |

所以本專案用 `3.29.<我們的號>`,patch 從 **900** 起(避開上游的 1xx)。

**遊戲上 3.30 而版號還停在 `3.29.x`,所有使用者會在改版當天同時被硬擋**,
而且錯誤訊息完全不提版號 —— app 只會說「Failed to load leagues,可能要完成
CAPTCHA」,內建瀏覽器顯示 Cloudflare 的「Sorry, you have been blocked」。

```shell
cd main && npm run check-user-agent
```

用開發模式與打包後兩種 UA 實打 GGG API,被擋就非零退出。**改版後第一件事就是跑它。**

---

## 同步上游

```shell
git fetch upstream
git merge upstream/master
```

衝突只會出現在本專案改過的檔案。改完後務必:

1. `npm run verify-datasets`
2. `npm run check-user-agent`
3. 實機測試(一般稀有物 + 海圖 + 傭兵契約書各查一次,結果數要收斂)

⚠ 分支叫 `master` 不是 `main`,因為根目錄有個 `main/` 資料夾 —— 同名會讓
`git log main` 之類的指令回 `ambiguous argument`。上游應該也是為了這個。
