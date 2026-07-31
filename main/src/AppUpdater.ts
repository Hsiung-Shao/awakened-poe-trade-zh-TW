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
      } else if (action === 'update-and-restart') {
        autoUpdater.quitAndInstall(false)
      }
    })

    /*
     * **一律不自動下載安裝。**
     *
     * 上游只在 portable 版關閉 autoDownload;本專案一律關閉,因為這裡沒有
     * code signing 憑證。開著 autoDownload 等於:任何能寫入那個 GitHub Release
     * 的人,就能讓所有使用者的機器自動下載並執行一支未簽章的 exe。
     * 這是整條供應鏈風險最高的一環,而它換來的只是省下使用者按一次下載。
     *
     * 使用者看到的仍然是「有新版 x.y.z」+ 一顆開啟 Releases 頁的按鈕
     * (UI 走 `download_manually` 那條分支)。完整性靠 Release 附的
     * SHA256SUMS 與 GPG 簽章的 tag 保證,由使用者自行核對。
     *
     * 因為 autoDownload 恆為 false,上游 `--no-updates` 那個「只擋下載」的
     * 語意已經失效 —— 留著就變成一個什麼都不做的旗標。改成連檢查都跳過,
     * 這才符合它的名字。
     */
    autoUpdater.autoDownload = false
    this.noAutoUpdatesReason = this.updatesDisabled ? 'disabled-by-flag' : 'unsigned-build'

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
      // 會執行的那一步(下載並安裝 exe)已經由 autoDownload = false 關掉。
      await autoUpdater.checkForUpdates()
    } catch {
      // handled by event
    }
  }
}
