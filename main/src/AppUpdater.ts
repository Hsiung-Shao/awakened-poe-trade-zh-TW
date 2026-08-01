import { autoUpdater } from 'electron-updater'
import type { ServerEvents } from './server'
import type { UpdateInfo } from '../../ipc/types'

export class AppUpdater {
  private _checkedAtStartup = false
  private _info: UpdateInfo = { state: 'initial' }

  public readonly noAutoUpdatesReason:
    Extract<UpdateInfo, { state: 'update-available' }>['noDownloadReason'] = null

  get info () { return this._info }
  set info (info: UpdateInfo) {
    this._info = info
    this.server.sendEventTo('broadcast', {
      name: 'MAIN->CLIENT::updater-state',
      payload: info
    })
  }

  /** `--no-updates` 時連檢查都不做(見下方 autoDownload 的說明)。 */
  private readonly updatesDisabled = process.argv.includes('--no-updates')

  constructor (
    private server: ServerEvents
  ) {
    setInterval(this.check, 16 * 60 * 60 * 1000)

    this.server.onEventAnyClient('CLIENT->MAIN::user-action', ({ action }) => {
      if (action === 'check-for-update') {
        this.check()
      } else if (action === 'download-update') {
        this.download()
      } else if (action === 'update-and-restart') {
        autoUpdater.quitAndInstall(false)
      }
    })

    /*
     * **永不自動下載,但使用者按下就可以下載安裝。**
     *
     * 上游偵測到更新就在背景自己下載、關閉時安裝,使用者全程不知情。本專案
     * 沒有 code signing 憑證(⚠ 上游其實也沒有,官方安裝檔一樣是 NotSigned),
     * 那樣等於「任何能寫入 Release 的人可以在所有使用者機器上執行任意程式」,
     * 而且完全沒有一個環節需要使用者同意。
     *
     * 所以這裡把「自動」拆成「一鍵」:autoDownload 恆為 false,改由 UI 的
     * `download-update` 動作觸發 `downloadUpdate()`。差別不在於能不能被攻擊
     * (被掉包的 Release 兩種都會中),而在於**程式不會自作主張抓東西執行**。
     *
     * 下載本身由 electron-updater 比對 `latest.yml` 裡的 sha512,
     * 檔案在傳輸中被改會被擋下。擋不住的是發布來源本身被攻陷。
     *
     * portable 與 macOS 沒有就地安裝的能力,維持上游的 `not-supported`
     * —— 那條 UI 分支會引導使用者去 Releases 頁自己下載。
     */
    autoUpdater.autoDownload = false
    this.noAutoUpdatesReason =
      this.updatesDisabled
        ? 'disabled-by-flag'
        : (process.env.PORTABLE_EXECUTABLE_DIR || process.platform === 'darwin')
            ? 'not-supported'
            : 'unsigned-build'

    autoUpdater.on('checking-for-update', () => {
      this.info = { state: 'checking-for-update' }
    })
    autoUpdater.on('update-available', (info: { version: string }) => {
      this.info = { state: 'update-available', version: info.version, noDownloadReason: this.noAutoUpdatesReason }
    })
    autoUpdater.on('update-not-available', () => {
      this.info = { state: 'update-not-available', checkedAt: Date.now() }
    })
    autoUpdater.on('error', () => {
      this.info = { state: 'error', checkedAt: Date.now() }
    })
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      this.info = { state: 'update-downloaded', version: info.version }
    })
    // on('download-progress') https://github.com/electron-userland/electron-builder/issues/2521
  }

  checkAtStartup () {
    if (!this._checkedAtStartup) {
      this._checkedAtStartup = true
      this.check()
    }
  }

  private check = async () => {
    if (this.updatesDisabled) return
    try {
      // 只抓 latest.yml 比版號。那是純資料、不執行,風險等同一般網頁請求;
      // 會下載並執行 exe 的那一步要等使用者按下 `download-update`。
      await autoUpdater.checkForUpdates()
    } catch {
      // handled by event
    }
  }

  /** 只由使用者的 `download-update` 動作觸發,絕不自動呼叫。 */
  private download = async () => {
    if (this._info.state !== 'update-available') return
    // 先把 noDownloadReason 清掉,UI 就會從「可從 GitHub 下載」切成「下載中…」。
    // 沿用上游既有的狀態與譯文,不必為此新增字串。
    this.info = { state: 'update-available', version: this._info.version, noDownloadReason: null }
    try {
      await autoUpdater.downloadUpdate()
    } catch {
      this.info = { state: 'error', checkedAt: Date.now() }
    }
  }
}
