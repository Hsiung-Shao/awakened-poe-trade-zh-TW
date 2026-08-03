<template>
<div>
  <!--
    上游在這裡放贊助者跑馬燈與獎台(資料來自 data/patrons.json)。整組移除:
    那 247 個名字是付錢給原作者 SnosMe 的人。這份繁中建置把贊助入口改指本版
    維護者之後,再留著那份名單等於暗示他們支持的是這個版本 —— 那是不實陳述,
    也是把第三人的姓名用在他們沒有同意的用途上。
    原作者的贊助入口保留在 About 頁與 README 的致謝,沒有被移除。
  -->
  <div :class="$style.window" class="grow layout-column">
    <AppTitleBar @close="cancel" :title="t('settings.title')" />
    <div class="flex grow min-h-0">
      <div class="pl-2 pt-2 bg-gray-900 flex flex-col gap-1" style="min-width: 10rem;">
        <template v-for="item of menuItems">
          <button v-if="item.type === 'menu-item'"
            @click="item.select" :class="[$style['menu-item'], { [$style['active']]: item.isSelected }]">{{ item.name }}</button>
          <div v-else
            class="border-b mx-2 border-gray-800" />
        </template>
        <button v-if="menuItems.length >= 4"
          :class="$style['quit-btn']" @click="quit">{{ t('app.quit') }}</button>
        <!--
          上游這裡是原作者的 Patreon。本繁中版改指本版維護者,但那只有在「贊助的是
          誰、為了什麼」講清楚時才誠實,所以三件事必須一起做:

          1. 標籤明說贊助對象是**這份繁中建置**,不是 Awakened PoE Trade 本身
          2. 不使用 Patreon 的標誌 —— MIT 授權的是著作權,**不含商標**
          3. 原作者的贊助入口移到 About 頁,與 MIT 授權聲明放在一起(沒有被拿掉)

          上游的 peepoLove 圖也一併移除:它原本裝飾的是原作者的募款,現在裝飾的是
          我們的,而那是 Pepe 衍生的 Twitch 表情,權利狀態不明確。
        -->
        <div class="text-gray-400 text-center mt-auto pr-3 pt-4 pb-12" style="max-width: fit-content; min-width: 100%;">
          {{ t('settings.support_build') }}<br>
          <a href="https://buymeacoffee.com/hsiung" class="inline-flex mt-1 border-b" target="_blank">Buy&nbsp;Me&nbsp;a&nbsp;Coffee</a>
        </div>
      </div>
      <div class="text-gray-100 grow layout-column bg-gray-900">
        <div class="grow overflow-y-auto bg-gray-800 rounded-tl">
          <component v-if="configClone"
            :is="selectedComponent" :config="configClone" :configWidget="configWidget" />
        </div>
        <div class="border-t bg-gray-900 border-gray-600 p-2 flex justify-end gap-x-2">
          <button @click="save" class="px-3 bg-gray-800 rounded">{{ t('Save') }}</button>
          <button @click="cancel" class="px-3">{{ t('Cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script lang="ts">
import { defineComponent, shallowRef, computed, Component, PropType, nextTick, inject, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppConfig, updateConfig, saveConfig, pushHostConfig, Config } from '@/web/Config'
import { Host } from '@/web/background/IPC'
import type { Widget, WidgetManager, WidgetSpec } from '@/web/overlay/interfaces'
import AppTitleBar from '@/web/ui/AppTitlebar.vue'
import SettingsHotkeys from './hotkeys.vue'
import SettingsChat from './chat.vue'
import SettingsGeneral from './general.vue'
import SettingsAbout from './about.vue'
import SettingsPricecheck from '../price-check/settings-price-check.vue'
import SettingsItemcheck from '../item-check/settings-item-check.vue'
import SettingsDebug from './debug.vue'
import SettingsMaps from '../map-check/settings-maps.vue'
import SettingsStashSearch from '../stash-search/stash-search-editor.vue'
import SettingsStopwatch from '../stopwatch/settings-stopwatch.vue'
import SettingsItemSearch from '../item-search/settings-item-search.vue'

function quit () {
  Host.sendEvent({
    name: 'CLIENT->MAIN::user-action',
    payload: { action: 'quit' }
  })
}

export default defineComponent({
  widget: {
    type: 'settings',
    instances: 'single',
    initInstance: () => {
      return {
        wmId: 0,
        wmType: 'settings',
        wmTitle: '{icon=fa-cog}',
        wmWants: 'hide',
        wmZorder: 'exclusive',
        wmFlags: ['invisible-on-blur', 'ignore-ui-visibility']
      }
    }
  } satisfies WidgetSpec,
  components: { AppTitleBar },
  props: {
    config: {
      type: Object as PropType<Widget>,
      required: true
    }
  },
  setup (props) {
    const wm = inject<WidgetManager>('wm')!
    const { t } = useI18n()

    nextTick(() => {
      props.config.wmWants = 'hide'
    })

    const selectedComponent = shallowRef<Component>(SettingsHotkeys)

    const configClone = shallowRef<Config | null>(null)
    watch(() => props.config.wmWants, (wmWants) => {
      if (wmWants === 'show') {
        configClone.value = reactive(JSON.parse(JSON.stringify(AppConfig())))
      } else {
        configClone.value = null
        if (selectedWmId.value != null) {
          selectedWmId.value = null
          selectedComponent.value = SettingsHotkeys
        }
      }
    })

    const selectedWmId = shallowRef<number | null>(null)
    const configWidget = computed(() => configClone.value?.widgets.find(w => w.wmId === selectedWmId.value))

    watch(() => props.config.wmFlags, (wmFlags) => {
      const flagStr = wmFlags.find(flag => flag.startsWith('settings::widget='))
      if (flagStr) {
        const _wmId = Number(flagStr.split('=')[1])
        const _widget = wm.widgets.value.find(w => w.wmId === _wmId)!
        selectedWmId.value = _wmId
        selectedComponent.value = menuByType(_widget.wmType)[0][0]
        wm.setFlag(props.config.wmId, flagStr, false)
      }
    }, { deep: true })

    const menuItems = computed(() => flatJoin(
      menuByType(configWidget.value?.wmType)
        .map(group => group.map(component => ({
          name: t(component.name!),
          select () { selectedComponent.value = component },
          isSelected: (selectedComponent.value === component),
          type: 'menu-item' as const
        }))),
      () => ({ type: 'separator' as const })
    ))

    return {
      t,
      save () {
        updateConfig(configClone.value!)
        saveConfig()
        pushHostConfig()

        wm.hide(props.config.wmId)
      },
      cancel () {
        wm.hide(props.config.wmId)
      },
      quit,
      menuItems,
      selectedComponent,
      configClone,
      configWidget
    }
  }
})

function menuByType (type?: string) {
  switch (type) {
    case 'stash-search':
      return [[SettingsStashSearch]]
    case 'timer':
      return [[SettingsStopwatch]]
    case 'item-check':
      return [[SettingsItemcheck, SettingsMaps]]
    case 'price-check':
      return [[SettingsPricecheck]]
    case 'item-search':
      return [[SettingsItemSearch]]
    default:
      return [
        [SettingsHotkeys, SettingsChat],
        [SettingsGeneral],
        [SettingsPricecheck, SettingsMaps, SettingsItemcheck],
        [SettingsDebug, SettingsAbout]
      ]
  }
}

function flatJoin<T, J> (arr: T[][], joinEl: () => J) {
  const out: Array<T | J> = []
  for (const nested of arr) {
    out.push(...nested)
    out.push(joinEl())
  }
  return out.slice(0, -1)
}
</script>

<style lang="postcss" module>
.window {
  position: absolute;
  top: 0; bottom: 0; left: 0; right: 0;
  margin: 0 auto;
  max-width: 50rem;
  max-height: 38rem;
  overflow: hidden;
  @apply bg-gray-800;
  @apply rounded-b;
  &:global {
    animation-name: slideInDown;
    animation-duration: 1s;
  }
}

.menu-item {
  text-align: left;
  @apply p-2;
  line-height: 1;
  @apply text-gray-600;
  @apply rounded-l;

  &:hover {
    @apply text-gray-100;
  }

  &.active {
    @apply text-gray-400;
    @apply bg-gray-800;
  }
}

.quit-btn {
  @apply text-gray-600;
  @apply border border-gray-800;
  @apply p-1 mt-2 mr-2 rounded;

  &:hover {
    @apply text-red-400;
    @apply border-red-400;
  }
}

/* 贊助者跑馬燈/獎台的樣式(.patronsHorizontal / .podium / .rating-*)已隨模板一起
   移除,見模板頂端的說明。 */
</style>
