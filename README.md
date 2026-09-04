# Codex HTTP Responses Bootstrap Compat

> **中文优先 / English included｜可复现的窄范围兼容层**：解决 Codex Desktop 经由中转站、聚合 API、反向代理或自建 HTTP Responses gateway 时，跨任务消息与 heartbeat 因无 `call_id` 的 `function_call_output` 被严格校验拒绝的问题。

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**搜索关键词：** Codex Desktop、Codex 中转站、CC Switch、sub2api、Responses HTTP、OpenAI Responses API、`function_call_output requires call_id`、`previous_response_id`、`Responses WebSocket v2`、`send_message_to_thread`、`create_thread`、`automation_update`、heartbeat、scheduled automation、multi-agent、Leader Worker、跨任务消息、HTTP 400、反向代理、聚合 API、gateway。

**English search terms:** Codex Desktop, third-party Responses provider, HTTP Responses gateway, function_call_output requires call_id, missing call_id, orphan function_call_output, previous_response_id, Responses WebSocket v2, poisoned thread, cross-thread message, delegation bootstrap, create_thread, send_message_to_thread, automation_update, heartbeat, scheduled automation, model gateway, reverse proxy.

**Documentation:** [中文接入、验证与回滚指南](docs/INTEGRATION_ZH-CN.md) · [English integration, validation, and rollback guide](docs/INTEGRATION_EN.md)

## 30 秒判断：你是否遇到这个问题？

你使用 Codex Desktop + 第三方 Responses 中转站/网关，并且：

- 普通手动对话正常；
- Leader 向 Worker 发消息或创建独立任务后，目标任务立即报 400；或 heartbeat 不能自然唤醒；
- 错误包含：

```text
function_call_output requires call_id on HTTP requests;
continuation via previous_response_id is only supported on Responses WebSocket v2
```

那么先阅读本仓库的 [中文操作与回滚指南](docs/INTEGRATION_ZH-CN.md) 或 [English integration guide](docs/INTEGRATION_EN.md)。不要先更换 Key、域名、模型、Authorization、登录状态，也不要清空 `.codex` 或历史聊天记录。

## 这是什么，不是什么

这是一个给 **中转站 / HTTP gateway 维护者和高级用户** 使用的参考实现。它在请求抵达严格的 HTTP Responses 工具输出校验之前，识别两类 Codex Desktop 客户端注入的 bootstrap，并将它们转回普通 user input。

它不是：

- OpenAI 官方修复或对所有 Codex 版本的保证；
- 将所有无 `call_id` 的工具输出放行的“万能补丁”；
- 替代中转站上游修复的长期理由；
- 修改、读取或上传你的 Key、Authorization、endpoint、`config.toml`、聊天记录的工具。

## 根因

标准 Responses 工具循环中，真实工具结果必须带上上一步模型 function call 的 `call_id`。这在 HTTP 请求带 `previous_response_id` 时同样成立，详见 [OpenAI Function Calling 文档](https://developers.openai.com/api/docs/guides/function-calling)。

但 Codex Desktop 会在下列启动场景直接注入输入，并非模型真正调用工具后的结果：

| 启动场景 | 典型形状 | 为什么没有合法 `call_id` |
|---|---|---|
| 跨任务委派 / 发消息 | `codex_app/create_thread` 或 `send_message_to_thread` + `<codex_delegation>` | 没有对应的上游模型 function call |
| heartbeat / 自动化启动 | `codex_app/automation_update` + heartbeat 或 scheduled bootstrap | 同样由客户端调度器注入 |

严格网关若把它们一律作为正常 `function_call_output` 验证，就会返回 400；失败输入可能留在线程历史中，导致之后的普通对话也持续失败。

## 安全模型：只转换已知 bootstrap，其他一律不动

`src/normalizer.mjs` 的拒绝优先规则是：

1. 顶层有 `previous_response_id`、真实 `function_call` 或 item reference：**不转换**；
2. 带真实非空 `call_id` 的输出：**不转换**；
3. 未知 name/namespace/output 的无 `call_id` 输出：**不转换**；
4. 只有完整、受限的 delegation / automation bootstrap：转换成原位 `user` message；
5. 输入顺序保持不变；第二次处理不再改变请求。

这比“伪造 call ID”或“统一把无 call ID 结果转 message”安全得多。

## 兼容矩阵：该转什么，绝不能转什么

| 请求内的输入 | 处理 | 原因 |
|---|---|---|
| 完整 `<codex_delegation>`，仅来自 `codex_app`/`codex_tui` 的 `create_thread` 或 `send_message_to_thread`，且无 `call_id` | 转为普通 user message | 这是客户端注入的委派启动载荷，不是模型工具结果 |
| 已识别的 `codex_app/automation_update` heartbeat 或 scheduled automation 启动载荷，且无 `call_id` | 转为普通 user message | 这是调度器注入的启动载荷，不是模型工具结果 |
| 带真实、非空 `call_id` 的 `function_call_output` | 原样转发 | 它必须继续和模型实际发出的 function call 配对 |
| 含 `previous_response_id`、真实 `function_call` 或 `item_reference` 的请求 | 原样转发 | 属于真正的 Responses continuation / tool-call 上下文 |
| 任何未知、不完整或格式异常的无 `call_id` 输出 | 原样转发并让网关拒绝 | 宁可暴露新形态，也不能悄悄破坏工具协议 |

完整字段条件、反例和验证顺序见 [中文接入、验证与回滚指南](docs/INTEGRATION_ZH-CN.md) 和 [English integration, validation, and rollback guide](docs/INTEGRATION_EN.md)。

## 快速开始（只在隔离环境）

```powershell
git clone https://github.com/<你的账号>/codex-http-responses-bootstrap-compat.git
cd codex-http-responses-bootstrap-compat
npm test

$env:CODEX_COMPAT_UPSTREAM_BASE_URL = 'https://<你现有的中转站基础地址>'
$env:CODEX_COMPAT_PORT = '18766'
node examples/http-bridge.mjs
```

然后让**独立、可丢弃的测试 app-server**把 `/v1/responses` 指向 `http://127.0.0.1:18766/v1`，保持现有的 provider、认证与登录机制不变。详细规则、验证矩阵和回滚步骤见 [中文指南](docs/INTEGRATION_ZH-CN.md) 和 [English guide](docs/INTEGRATION_EN.md)。

> 不要把 `18766` 直接替换到正在运行的生产客户端；先只在新建 disposable/ephemeral 空白任务中测试。

## 测试

```powershell
npm run check
npm test
```

当前回归覆盖：delegation bootstrap、两种 automation bootstrap、正常带 `call_id` 的工具结果、未知无 `call_id` 输出、continuation/tool-call 上下文和幂等性。维护者可将这些用例直接并入 gateway CI，防止“为修 heartbeat 而误伤真实 tool continuation”。

## 与已有问题和上游修复的关系

- [CC Switch #7025](https://github.com/farion1231/cc-switch/issues/7025)：Leader → Worker 消息触发持续 400 的用户复现报告；本仓库的说明将作为该 Issue 的导流目标。
- [sub2api #6402](https://github.com/Wei-Shaw/sub2api/issues/6402)：delegation bootstrap 无 `call_id` 的精确问题报告。
- [sub2api #6450](https://github.com/Wei-Shaw/sub2api/pull/6450)：automation bootstrap 的结构化规范化方案。

如果你的中转站是 sub2api 或有能力修改 gateway，优先采用/合并上游的窄范围修复；本仓库用于解释、回归和为尚未合并修复的中转层提供参考。

## English users and upstream reports

这不是只发生在中文中转站用户身上的问题。英文上游报告也描述了同一类协议边界：Codex 发出的、没有可用 `call_id` 的 `function_call_output`，会在严格的第三方 HTTP Responses upstream 被拒绝，尤其会影响任务委派、恢复、heartbeat 或 automation bootstrap。

- [openai/codex #42088](https://github.com/openai/codex/issues/42088)：unpaired `function_call_output` 被严格 upstream 拒绝。
- [openai/codex #42067](https://github.com/openai/codex/issues/42067)：第三方 Responses provider 上的跨任务发送/恢复缺少 `call_id`。
- [openai/codex #41690](https://github.com/openai/codex/issues/41690)：Codex Desktop automation bootstrap 与第三方 Responses provider 的兼容性问题。

这些 issue 不能证明所有中转站故障有相同根因；它们说明英文用户有相同的可检索症状与协议边界。英文读者可直接使用 [English integration, validation, and rollback guide](docs/INTEGRATION_EN.md)。本仓库是对上游修复的文档、测试与参考实现补充，不替代 native gateway 修复或 Responses WebSocket v2 支持。

## 贡献

欢迎提交新的**脱敏** bootstrap 形状、测试用例和文档改进。请不要提交真实 provider 域名、凭证、`config.toml`、聊天记录、截图中的个人信息或完整请求日志。详见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
