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
npm run gen-disc-variants            # 乾跑,只報告差異
npm run gen-disc-variants -- --write
npm run make-index-files             # ⚠ 改過 ndjson 後**必須**重建索引
npm run verify-datasets              # 檢查 en 與 cmn-Hant 的語言無關鍵是否對齊
```

`gen-disc-variants` 會打國際服與台服的交易站 API,用語言無關的 `type` 欄對接,
重新產生海圖區域與傭兵流派的 79 列變體。回應快取在 `.cache/`,新賽季重跑前先刪掉。

驗證方式:帶 `--write` 跑完後 `git diff` 應為空 —— 它會逐位元組重現已入庫的資料。

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
