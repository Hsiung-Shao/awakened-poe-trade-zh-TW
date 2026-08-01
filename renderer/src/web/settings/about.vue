<template>
  <div class="p-2 flex flex-col h-full items-center">
    <div class="flex flex-col items-center p-2 mb-4">
      <img class="w-12 h-12" src="/images/TransferOrb.png">
      <p class="text-base">Awakened PoE Trade-zh-TW</p>
      <p class="">{{ t('app.version', [version]) }}</p>
      <div class="flex gap-2">
        <a class="border-b" :href="`${REPO_URL}/releases`" target="_blank">{{ t('app.release_notes') }}</a>
        <a class="border-b" :href="`${REPO_URL}/issues`" target="_blank">{{ t('app.report_bug') }}</a>
      </div>
    </div>
    <!--
      本版的版號與上游脫鉤(見 UPSTREAM_VERSION 的註解),所以必須把上游基準版本
      標出來,否則使用者無從得知這份建置對應官方的哪一版。
    -->
    <div class="text-center mb-4 text-gray-500">
      <p>Traditional Chinese build of
        <a class="border-b" :href="UPSTREAM_URL" target="_blank">Awakened PoE Trade</a>
        by SnosMe</p>
      <p>based on upstream {{ UPSTREAM_VERSION }}</p>
    </div>
    <div class="border border-gray-600 rounded p-2 whitespace-nowrap min-w-min w-72">
      <p>{{ info.str1 }}</p>
      <p>{{ info.str2 }}</p>
      <button v-if="info.action" @click="info.action"
        class="btn w-full mt-1">{{ info.actionText }}</button>
      <!--
        次要出口:想自己核對 SHA-256 再安裝的人可以走這裡。一旦更新變成一鍵,
        實務上不會有人主動去核對雜湊,至少要讓想核對的人找得到路。
      -->
      <a v-if="info.showManualLink" :href="`${REPO_URL}/releases`" target="_blank"
        class="block text-center border-b mt-2 text-gray-500">{{ t('updates.downloads_page') }}</a>
    </div>
    <!--
      上游這裡放的是作者本人的 Discord 帳號。留著會讓這個繁中版的問題回報
      直接寄到他信箱 —— 他沒有做這份建置,也無從處理。改指向本專案的 issue 區。

      下面兩個 Discord 是公開的社群伺服器(不是任何人的私人聯絡方式),
      對 PoE 玩家仍然有用,原樣保留。
    -->
    <div class="text-center mt-auto py-8">
      <p>Report an issue with this build at
        <br><a class="border-b" :href="`${REPO_URL}/issues`" target="_blank">{{ REPO_SLUG }}</a></p>
      <ul class="flex gap-4">
        <li><img class="rounded inline" src="/images/dc_tft.gif"> <a class="border-b" href="https://discord.gg/tftrove" target="_blank">The Forbidden Trove</a></li>
        <li><img class="rounded inline" src="/images/dc_reddit.png"> <a class="border-b" href="https://discord.gg/pathofexile" target="_blank">r/pathofexile</a></li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Host } from '@/web/background/IPC'
import { DateTime } from 'luxon'

const REPO_SLUG = 'Hsiung-Shao/awakened-poe-trade-zh-TW'
const REPO_URL = `https://github.com/${REPO_SLUG}`
const UPSTREAM_URL = 'https://github.com/SnosMe/awakened-poe-trade'

/**
 * 上游的基準版本。**同步上游時要一起更新。**
 *
 * 本專案的版號(main/package.json)只有 patch 段是自己的(900 起),
 * major.minor 必須跟著遊戲版本系列走 —— 那不是慣例而是硬性限制,
 * GGG 的 Cloudflare 會擋掉 major.minor 不符的 User-Agent。詳見
 * scripts/check-user-agent.mjs。
 *
 * 因為版號的 patch 段與上游不同,使用者無從得知這份建置對應官方哪一版,
 * 所以在 About 頁把上游基準標出來。
 */
const UPSTREAM_VERSION = '3.29.102 (18a401e)'

function checkForUpdates () {
  Host.sendEvent({
    name: 'CLIENT->MAIN::user-action',
    payload: { action: 'check-for-update' }
  })
}

/**
 * 開始下載更新。**只由使用者按下這顆按鈕觸發** —— 程式不會自己下載
 * (見 main/src/AppUpdater.ts 對 autoDownload 的說明)。
 */
function downloadUpdate () {
  Host.sendEvent({
    name: 'CLIENT->MAIN::user-action',
    payload: { action: 'download-update' }
  })
}

function openDownloadPage () {
  window.open(`${REPO_URL}/releases`)
}

function quitAndInstall () {
  Host.sendEvent({
    name: 'CLIENT->MAIN::user-action',
    payload: { action: 'update-and-restart' }
  })
}

function fmtTime (millis: number) {
  return DateTime.fromMillis(millis).toRelative({ style: 'long' }) ?? 'n/a'
}

export default defineComponent({
  name: 'settings.about',
  inheritAttrs: false,
  setup () {
    const { t } = useI18n()

    const info = computed(() => {
      const rawInfo = Host.updateInfo.value
      switch (rawInfo.state) {
        case 'initial':
          return { str1: t('updates.maybe_outdated'), str2: t('updates.never_checked'), action: checkForUpdates, actionText: t('updates.check_now') }
        case 'checking-for-update':
          return { str1: t('updates.checking'), str2: t('please_wait') }
        case 'update-not-available':
          return { str1: t('updates.latest'), str2: t('updates.last_checked', [fmtTime(rawInfo.checkedAt)]), action: checkForUpdates, actionText: t('updates.check_now') }
        case 'error':
          return { str1: t('updates.maybe_outdated'), str2: t('updates.error'), action: openDownloadPage, actionText: t('updates.downloads_page') }
        case 'update-downloaded':
          return { str1: t('updates.available', [rawInfo.version]), str2: t('updates.installed_on_exit'), action: quitAndInstall, actionText: t('updates.install_now') }
        case 'update-available': {
          const str1 = t('updates.available', [rawInfo.version])
          switch (rawInfo.noDownloadReason) {
            // 本專案的預設:不自動下載,但按一下就能下載安裝。
            // 旁邊另外給一條「自己去下載頁」的連結,讓想核對 SHA-256 的人有路走。
            case 'unsigned-build':
              return { str1, str2: t('updates.download_manually'), action: downloadUpdate, actionText: t('updates.install_now'), showManualLink: true }
            // portable / macOS 沒有就地安裝的能力,只能引導去下載頁。
            case 'not-supported':
              return { str1, str2: t('updates.download_manually'), action: openDownloadPage, actionText: t('updates.downloads_page') }
            // 使用者自己用 --no-updates 關掉的。
            case 'disabled-by-flag':
              return { str1, str2: t('updates.download_disabled'), action: openDownloadPage, actionText: t('updates.downloads_page') }
            // null = 已按下下載、正在進行中。
            default:
              return { str1, str2: t('updates.downloading') }
          }
        }
      }
    })

    return {
      t,
      info,
      version: Host.version,
      REPO_SLUG,
      REPO_URL,
      UPSTREAM_URL,
      UPSTREAM_VERSION
    }
  }
})
</script>
