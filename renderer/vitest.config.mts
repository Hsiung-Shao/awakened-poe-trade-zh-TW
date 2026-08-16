import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import * as path from 'node:path'

/**
 * Parser 與篩選器層的回歸測試設定。
 *
 * 這套測試存在的理由:解析器每個賽季都要跟著 GGG 的措辭改,而「改壞既有物品」
 * 是靜默的 —— 未知詞綴會被收集進 `unknownModifiers` 而不是拋錯,所以型別檢查、
 * lint、建置全都看不到退步。唯一能擋下來的方式是拿真實剪貼簿文字跑一遍、
 * 與人工核可過的快照逐欄比對。
 *
 * ⚠ 為什麼需要 alias 與 fetch mock:`assets/data/index.ts` 是為瀏覽器寫的,
 *   資料靠 `fetch(`${import.meta.env.BASE_URL}data/…`)` 與動態
 *   `import(`${BASE_URL}data/<lang>/client_strings.js`)` 取得。`BASE_URL` 在
 *   測試環境是 `/`,所以兩者都會變成 `/data/…` 這種根路徑 —— Node 解不開。
 *   alias 負責動態 import,setup 裡的 fetch mock 負責其餘的資料檔。
 *
 * ⚠ 為什麼要掛 vue plugin 與 `@ipc` alias:篩選器層的測試會 import
 *   `pathofexile-trade.ts`,而它的 import 鏈一路連到 `.vue` 單檔元件與
 *   `@ipc/types`。沒有這兩項,測試會在**收集階段**就掛掉(「invalid JS syntax」),
 *   一個測試都不會跑。設定與 `vite.config.mts` 保持一致 —— 兩份漂開的話,
 *   測試通過就不再代表建置會過。
 */
export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    })
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      { find: '@ipc', replacement: path.resolve(__dirname, '../ipc') },
      // 動態 import 的 `/data/<lang>/client_strings.js` 走這裡
      { find: /^\/data\//, replacement: path.resolve(__dirname, 'public/data') + '/' },
      // apexcharts 在模組載入時就讀 `window`,Node 沒有。理由與界線見替身檔的註解。
      { find: /^vue3-apexcharts$/, replacement: path.resolve(__dirname, 'test/stubs/apexcharts.ts') },
      { find: /^apexcharts$/, replacement: path.resolve(__dirname, 'test/stubs/apexcharts.ts') }
    ]
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup-data-source.ts'],
    // 兩個語系的資料集不能同時載入(parser 用 module 層級的 CLIENT_STRINGS
    // 等全域變數),所以測試檔內逐一切換語系,不靠平行化。
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000
  }
})
