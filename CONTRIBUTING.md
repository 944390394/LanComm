# 参与贡献

欢迎提交 Issue 和 Pull Request。

## 本地开发

```bash
npm install
npm run dev
```

首次运行时 Windows 防火墙会弹窗，选择「允许专用网络访问」，否则设备发现和文件传输都会失败。

国内网络下载 Electron 可能很慢，可以先设置镜像：

```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm config set registry https://registry.npmmirror.com
```

## 本地打包的一个前提

`npm run dist` 需要 electron-builder 解压 winCodeSign 工具包，其中含有 macOS 的符号链接。Windows 上创建符号链接需要权限，否则解压会失败并中断打包。解决办法二选一：

- 打开系统设置里的**开发者模式**（推荐，一次性设置）
- 用管理员身份运行终端

只想快速验证构建、不在意安装包图标的话，可以跳过这一步：

```bash
npm run build
npx electron-builder --win --publish never -c.win.signAndEditExecutable=false
```

注意这样打出来的 exe 不会嵌入应用图标和版本信息，**不能用于发布**。正式产物由 GitHub Actions 在打 tag 时构建。

## 提交前自检

```bash
npm run typecheck
npm run lint
npm run build
```

三条都要通过。CI 会跑同样的检查。

## 手动验证

自动化测试目前只覆盖网络层。改动了发现、消息或传输逻辑，请先启动应用再跑：

```bash
node test/security-smoke.mjs   # 防护是否生效（CORS、Origin、协议头、畸形报文）
node test/transfer-e2e.mjs     # 端到端收文件，需先把接收方式设为「全部自动接收」
node test/confirm-gate.mjs     # 陌生设备必须经确认才能上传
```

涉及双机交互的改动（发现、重连、送达状态），请在两台真实设备上验证一遍再提 PR。

## 代码约定

- TypeScript 严格模式，不要用 `any`
- 主进程只放系统能力，渲染进程只做展示与交互，两者之间走 `src/preload/index.ts` 里的 IPC 接口
- 协议相关的类型和常量集中在 `src/shared/types.ts`
- 注释只写代码本身表达不了的约束或原因，不要复述代码在做什么
- 提交信息说明「为什么改」，而不只是「改了什么」

## 不要随意改动的地方

`package.json` 的 `name` 字段决定 Electron 的 `userData` 目录位置（`%APPDATA%\lop2p`），改动会让所有已安装用户丢失设备 ID、信任列表和聊天记录。项目对外名称统一用 `productName`（局域网通信软件）和可执行文件名（`LanComm`）表达，`name` 保持不变。

## 协议兼容性

`src/shared/types.ts` 里的 `PROTOCOL_VERSION` 控制握手校验。改动 `WsEnvelope` 的结构、字段语义或传输流程时，需要同步升版本号，并在 PR 里说明新旧版本能否互通。

## 安全相关

这个程序会在局域网上开放端口。涉及以下位置的改动请在 PR 里单独说明理由：

- `src/main/hub.ts` 的 `verifyClient`（阻止浏览器伪装成客户端）
- `src/main/transfer.ts` 的来源 IP 校验与文件名净化
- `src/main/validate.ts` 的报文校验
- `src/main/index.ts` 里 `lop2p://` 协议的路径白名单

发现安全问题请不要直接开公开 Issue，见 [SECURITY.md](SECURITY.md)。
