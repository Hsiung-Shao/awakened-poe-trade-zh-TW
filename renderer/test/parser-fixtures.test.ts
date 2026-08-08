import * as fs from 'node:fs'
import * as path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { init, loadForLang } from '@/assets/data'
import {
  diffSnapshots,
  formatDiff,
  listFixtures,
  readExpected,
  runFixture,
  writeExpected,
  FIXTURES_DIR,
  UPDATE_MODE,
  type Fixture,
  type FixtureOutcome
} from './helpers/fixture-harness'

/**
 * 解析器的回歸網。
 *
 * 為什麼需要它:解析器每個賽季都得跟著 GGG 改措辭,而**改壞既有物品是靜默的** ——
 * 認不出來的詞綴會被收進 `unknownModifiers` 而不是拋錯,所以型別檢查、lint、
 * 建置全部照樣綠。唯一擋得住退步的方式是拿真實剪貼簿文字跑一遍、與人工核可過的
 * 快照逐欄比對。
 *
 * 更新快照:`UPDATE_FIXTURES=1 npm test`。
 * ⚠ **產生的快照必須人工 review 後才可 commit。** 盲目更新等於把回歸網拆掉 ——
 *   解析器壞掉時它會把錯誤的結果寫成「期望值」,測試從此永遠是綠的。
 *
 * ⚠ 兩個語系的資料集**不能同時載入**:`assets/data/index.ts` 用的是模組層級的
 *   `CLIENT_STRINGS` / `ITEM_BY_TRANSLATED` 等全域變數,載入第二個語系會蓋掉
 *   第一個。所以這裡在 beforeAll 裡逐一切換、跑完一個語系才換下一個。
 */

/** 這個專案出貨的語系。沒有樣本的不會被跳過而假裝通過,見下方 `describe`。 */
const LANGUAGES = ['cmn-Hant', 'en', 'ru', 'ko'] as const

function hasFixtures (language: string): boolean {
  const dir = path.join(FIXTURES_DIR, language)
  return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.txt'))
}

/**
 * 只對真的有樣本的語系建立測試。
 *
 * ⚠ **不是**「沒樣本就跳過」那種放水:少了樣本的語系會在下面被明確列出來,
 *   而且「至少要有一個語系有樣本」是硬斷言。原本的 corpus 有 en 樣本,
 *   隨舊專案(poe-price-check)一起遺失,這裡誠實反映現況而不是假裝測過。
 */
const COVERED = LANGUAGES.filter(hasFixtures)
const UNCOVERED = LANGUAGES.filter(l => !hasFixtures(l))

interface LanguageRun {
  fixtures: Fixture[]
  results: Array<{ fixture: Fixture, outcome: FixtureOutcome }>
}

const runs = new Map<string, LanguageRun>()

beforeAll(async () => {
  // `init` 會載入 en 的參照字典與掉落表,並驗證 `stat()` 宣告的每個 ref 都存在
  await init(COVERED[0] ?? 'en')
  for (const language of COVERED) {
    await loadForLang(language)
    const fixtures = await listFixtures(language)
    runs.set(language, {
      fixtures,
      results: fixtures.map(fixture => ({ fixture, outcome: runFixture(fixture) }))
    })
  }
}, 180_000)

describe('corpus 覆蓋範圍', () => {
  it('至少有一個語系有樣本', () => {
    // 全空的話下面每一項都會空轉通過 —— 那比沒有測試更危險
    expect(COVERED.length, '沒有任何語系有 fixture,回歸網等於不存在').toBeGreaterThan(0)
  })

  it('列出還沒有樣本的語系', () => {
    if (UNCOVERED.length > 0) {
      // eslint-disable-next-line no-console -- 這是給人看的待補清單,不是失敗判定
      console.log(
        `\n⚠ 這些語系目前沒有 fixture,解析器對它們的行為沒有回歸保護:\n  ` +
        UNCOVERED.join(', ') +
        `\n  (原本的 en 樣本隨已刪除的 poe-price-check 一起遺失)`)
    }
    expect(Array.isArray(UNCOVERED)).toBe(true)
  })
})

for (const language of COVERED) {
  describe(`parser fixtures:${language}`, () => {
    const run = (): LanguageRun => {
      const value = runs.get(language)
      if (value === undefined) throw new Error(`${language} 的 corpus 尚未載入`)
      return value
    }

    it('這個語系的 corpus 非空', () => {
      // COVERED 已經篩掉沒有樣本的語系,但目錄裡若只剩 .expected.json
      // (.txt 被誤刪)也會讓下面每一項空轉通過,所以這裡再擋一次
      expect(run().fixtures.length).toBeGreaterThan(0)
    })

    it('全部 fixture 都能解析', () => {
      const failed = run().results
        .filter(r => r.outcome.kind !== 'parsed')
        .map(r => `${r.fixture.name}: ${(r.outcome as { error: string }).error}`)

      expect(
        failed,
        failed.length === 0 ? '' : `以下 ${failed.length} 件解析失敗:\n  ` + failed.join('\n  ')
      ).toEqual([])
    })

    it('快照與 *.expected.json 相符', async () => {
      const mismatches: string[] = []

      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== 'parsed') continue

        if (UPDATE_MODE) {
          await writeExpected(fixture, outcome.snapshot)
          continue
        }

        const expectedSnapshot = await readExpected(fixture)
        if (expectedSnapshot === undefined) {
          mismatches.push(`${fixture.name}: 缺少快照(用 UPDATE_FIXTURES=1 產生後人工 review)`)
          continue
        }

        const diffs = diffSnapshots(expectedSnapshot, outcome.snapshot)
        if (diffs.length > 0) {
          mismatches.push(`${fixture.name}:${diffs.length} 處欄位不符\n${formatDiff(diffs)}`)
        }
      }

      if (UPDATE_MODE) return
      expect(mismatches, mismatches.join('\n\n')).toEqual([])
    })

    it('未知詞綴被收集而非導致解析失敗', () => {
      for (const { fixture, outcome } of run().results) {
        if (outcome.kind !== 'parsed') continue
        expect(
          Array.isArray(outcome.item.unknownModifiers),
          `${fixture.name} 的 unknownModifiers 不是陣列`
        ).toBe(true)
      }
    })
  })
}
