import { app, Menu, Tray, nativeImage } from 'electron'

let tray: Tray | null = null

export function createTray(options: {
  iconPath?: string
  onShow: () => void
  onQuit: () => void
}): Tray | null {
  if (tray) return tray

  const image = options.iconPath
    ? nativeImage.createFromPath(options.iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(image)
  tray.setToolTip('局域网通信软件')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: options.onShow },
      { type: 'separator' },
      { label: '退出', click: options.onQuit }
    ])
  )
  tray.on('click', options.onShow)

  app.on('before-quit', () => {
    tray?.destroy()
    tray = null
  })

  return tray
}
