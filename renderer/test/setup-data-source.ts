import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 讓 `assets/data/index.ts` 在 Node 底下也能載入資料集。
 *
 * 它是為瀏覽器寫的:`fetch(`${import.meta.env.BASE_URL}data/…`)`。測試環境的
 * `BASE_URL` 是 `/`,所以請求會長成 `/data/cmn-Hant/items.ndjson` —— 沒有 host,
 * Node 的 fetch 直接丟 `Failed to parse URL`。這裡把這類請求轉成讀檔。
 *
 * ⚠ 只攔 `/data/` 開頭的請求,其餘一律交還原本的 fetch。測試不該偷偷讓真正的
 *   網路請求變成假的 —— 那會讓「其實打了外部 API」這種缺陷躲過測試。
 */

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public')

const realFetch = globalThis.fetch

globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url)

  if (url.startsWith('/data/')) {
    const filePath = path.join(PUBLIC_DIR, url)
    if (!fs.existsSync(filePath)) {
      // 明確失敗。回一個空的 200 會讓解析器拿到空資料集,
      // 症狀是「所有物品都查不到」而不是「資料檔缺了」。
      throw new Error(`測試資料來源找不到檔案:${filePath}`)
    }
    const body = fs.readFileSync(filePath)
    return new Response(body, { status: 200 })
  }

  return realFetch(input, init)
} as typeof fetch
