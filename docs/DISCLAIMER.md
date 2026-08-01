# 免責聲明與風險說明

**這不是形式文件。使用前請讀完。**

---

## 一、本專案與 GGG 無關,且未獲任何形式的許可

本專案與 Grinding Gear Games **無隸屬關係、未獲其認可、未獲其授權**。

GGG 對第三方工具的公開立場(2025 年官方論壇回覆原文):

> "Unfortunately, we cannot comment on the legality of third-party tools, as we
> aren't able to thoroughly and accurately check exactly how they work."
>
> "In general, **we do not encourage** the creation or use of third-party tools
> because they provide advantages for players that use them."
>
> "I'm afraid that we're **unable to guarantee if a tool is allowed or would
> remain allowed** in the future."
>
> "I would recommend **refraining from creating or using any programs that
> automates or does more than one action with a keystroke or mouse click**, as
> well as anything that interacts with the game client to provide an advantage
> over other players or provide information that isn't normally visible."
>
> —— [pathofexile.com/forum/view-thread/3734853](https://www.pathofexile.com/forum/view-thread/3734853)

也就是說:**現在沒事不代表以後沒事,而且從來沒有人保證過現在沒事。**

## 二、帳號風險由你自行承擔

**帳號被限制或停權的風險無法排除。**

任何人 —— 包括本專案 —— 都無法給你一個機率,因為判定權完全在 GGG,而他們明確
表示不對個別工具表態。看到有人給你數字,那個數字是編的。

作者不對任何帳號處置、財產損失或其他後果負責。**不接受這個前提就不要使用。**

---

## 三、本工具實際做什麼

| 會做 | 不會做 |
|---|---|
| 讀取剪貼簿 | 讀取遊戲記憶體 |
| 送出 `Ctrl + C` 複製游標下的物品 | 注入 DLL、hook 遊戲 process |
| overlay 疊加顯示 | 攔截或修改遊戲網路封包 |
| 讀取 `Client.txt` 與 `production_Config.ini` | 修改任何遊戲檔案 |
| 帶你的登入 cookie 查詢官方交易 API | 定時輪詢、自動掃描倉庫 |
| 遵守 `X-Rate-Limit-*` 並在額度滿時排隊 | 忽略 429 持續重試 |

沒有任何自動化遊玩行為 —— 不移動、不放技能、不撿物、沒有迴圈、沒有計時器。

## 四、⚠ 聊天指令是風險最高的功能,建議關掉

「聊天指令」會**把按鍵送進遊戲**:按一次熱鍵,程式合成 `Enter` → 貼上文字 →
`Enter`,在遊戲內送出一則訊息。上游的預設綁定:

| 熱鍵 | 指令 | 效果 |
|---|---|---|
| `F5` | `/hideout` | 傳送回藏身處 |
| `F9` | `/exit` | 離開目前區域 |

這在字面上就是 GGG 那句「**一個按鍵做超過一個動作**」所指的行為,也是整個工具裡
**唯一**會改變遊戲狀態的路徑 —— `Ctrl + C` 只是複製文字,不影響任何東西。

**想把風險降到最低:到「設定 → Chat」把這兩個熱鍵解除綁定。查價功能完全不需要它們。**

## 五、這是非官方的修改版,而且看得出來

本版的 User-Agent 版號是 `3.29.900`,不對應任何上游正式發行版。這代表本版使用者
在 GGG 眼中是一個**可辨識的獨立族群**。

這是刻意的:誠實標示「這不是官方建置」,比冒用上游版號好。但你應該知道這件事。

## 六、安裝檔沒有數位簽章

本專案沒有購買 code signing 憑證。⚠ **官方版也沒有** —— 這台機器上安裝的
官方 3.29.102 一樣是 `NotSigned`,上游的 electron-builder 設定裡沒有任何簽章項目。

防護只有:

- 每個 Release 附 `SHA256SUMS-<版本>.txt`
- 更新下載時由 electron-updater 比對 `latest.yml` 裡的 sha512
- 程式**不會自動下載安裝**更新,必須由你按下按鈕(上游是背景自動裝)

這些擋得住「檔案在傳輸途中被掉包」,**擋不住「發布來源本身被攻陷」**。
你最終是在信任本專案的 GitHub 帳號沒有被盜用。

⚠ 誠實地說:**更新變成一鍵之後,實務上不會有人真的去核對 SHA-256。**
安全性主要退回「維護者的 GitHub 帳號沒失守」這一條線。想要更高的保證,
就手動從 Releases 頁下載並自行核對雜湊 —— 按鈕下方的連結就是給這個用的。

---

## 對照:本版相對上游增加了多少風險

逐檔比對的結果 —— 與遊戲互動、速率限制、網路代理的程式碼**一行都沒改**:

```
main/src/shortcuts/     輸入模擬      0 行改動
RateLimiter.ts          速率限制      0 行改動
main/src/proxy.ts       網路請求      0 行改動
```

改動全部在:物品文字解析、資料檔、一個查詢欄位、介面字串、建置腳本。

**結論:本版的行為風險與現行的官方 Awakened PoE Trade 相同 —— 不多也不少。
但「與官方版相同」不等於「安全」,見上面第一、二節。**
