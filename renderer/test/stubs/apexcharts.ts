/**
 * 圖表函式庫的測試替身。
 *
 * 為什麼需要它:篩選器的 import 鏈是
 *   `create-presets` → `create-item-filters` → `trade/common` → `web/Config`
 *   → `overlay/widget-registry` → 全部 widget → `PriceTrend.vue` → `vue3-apexcharts`
 * 而 apexcharts 在**模組載入時**就讀 `window`,Node 環境沒有,整個測試檔在收集
 * 階段就掛掉、一個測試都跑不到。
 *
 * ⚠ 只替換這一個。不要改成在 setup 裡塞一個假的 `globalThis.window` —— 那會讓
 *   整份程式碼誤以為自己在瀏覽器裡,走到平常不會走的分支,測出來的行為就不是
 *   正式環境的行為了。這裡替掉的是一個**被測邏輯完全不會呼叫**的繪圖元件。
 *
 * ⚠ 也因此,這個替身不可以有任何行為。它一旦被真的呼叫到,代表被測範圍已經跨進
 *   了 UI 算繪,那時候該做的是把測試拉回來,不是把替身補得更像。
 */
const stub = {
  name: 'ApexChartsStub',
  render () {
    throw new Error('測試不該算繪圖表元件 —— 被測範圍跑進 UI 了')
  }
}

export default stub
