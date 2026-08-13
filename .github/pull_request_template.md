## 改动内容

<!-- 说明这个 PR 解决了什么问题，以及为什么这样改 -->

## 自检

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npm run build` 通过
- [ ] 改动涉及网络层时，`node test/security-smoke.mjs` 通过
- [ ] 改动涉及双机交互时，已在两台真实设备上验证

## 协议兼容性

- [ ] 未改动 `WsEnvelope` 结构或传输流程
- [ ] 有改动，已同步升级 `PROTOCOL_VERSION`，并在下方说明新旧版本能否互通

## 安全影响

<!-- 若改动了 verifyClient、来源 IP 校验、文件名净化、报文校验或 lop2p:// 白名单，请在此说明理由 -->
