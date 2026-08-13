# 安全说明

## 报告漏洞

发现安全问题请不要开公开 Issue，改用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)（仓库 Security 页签），或直接私信仓库所有者。

## 威胁模型

本程序会在本机监听三个端口，同一局域网内的任何设备都能访问：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| 41234 | UDP | 设备发现广播与组播 |
| 17890 | TCP | 文件传输（HTTP） |
| 17891 | TCP | 即时消息（WebSocket） |

设计上假设局域网**不可信**，因此有以下防护。

### 阻止网页伪装成客户端

浏览器可以向任意内网地址发起 WebSocket 连接，且不受同源策略限制。为此：

- WebSocket 握手拒绝任何携带 `Origin` 的连接（浏览器必带，Node 客户端不带）
- 握手要求自定义请求头 `x-lancomm-protocol`，浏览器的 WebSocket API 无法设置自定义头
- HTTP 服务不返回任何 CORS 响应头，即使网页发出请求也读不到响应

### 阻止未经同意的文件写入

- 默认只有被显式标记为「信任」的设备可以自动接收，其余会先弹出确认
- 上传只接受已确认的传输 ID，未确认的请求返回 404
- 上传的来源 IP 必须与发起该传输的设备 IP 一致
- 文件名会剥离路径分隔符、控制字符和前导点，无法穿越出下载目录
- 同名文件自动改名，不会覆盖已有文件
- 实际写入量超过声明大小会中断并删除半成品

### 阻止畸形报文导致崩溃

所有 UDP 与 WebSocket 报文在进入业务逻辑前都经过 `src/main/validate.ts` 校验字段类型和边界，文本长度、文件大小、预览图体积都有上限。

### 渲染进程隔离

- `contextIsolation: true`、`nodeIntegration: false`
- 渲染进程只能通过 `src/preload/index.ts` 暴露的固定接口访问系统能力
- 自定义协议 `lop2p://` 只允许读取下载目录内的文件，或出现在传输记录里的文件

## 已知限制

- **传输内容不加密**，走的是明文 HTTP。同一局域网内有能力抓包的人可以看到传输内容，不要用它传敏感资料。
- **设备身份不做密码学校验**。设备 ID 是本地生成的 UUID，理论上可被伪造，「信任设备」只能防误操作，不能防定向攻击。
- 接收方式设为「全部自动接收」时，上述确认机制会被绕过，仅建议在完全可信的网络下使用。
