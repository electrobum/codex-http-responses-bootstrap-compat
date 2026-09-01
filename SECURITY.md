# 安全边界 / Security policy

本仓库处理的是协议形状，不需要也不应收集任何用户凭证或任务内容。

## 绝不提交

- API key、Bearer token、Authorization 值、Cookie；
- provider endpoint、账户信息、IP 地址；
- `config.toml`、本地聊天数据库、自动化 memory、完整 request/response 日志；
- 真实项目路径、任务 ID、客户数据或对话内容。

`examples/http-bridge.mjs` 仅记录规范化事件计数，不记录请求正文。接入方仍应检查自己 gateway 的 access log、reverse proxy log 和 shell history 是否可能泄露 Authorization header。

## 安全原则

1. 只规范化被完整结构验证的 Codex bootstrap；
2. 带真实 `call_id` 的工具结果绝不改写；
3. 未识别的无 `call_id` 工具结果绝不放行；
4. 不伪造 `call_id`；
5. 先用备用端口和 disposable 测试任务验证，再切换生产流量。

请通过 GitHub Security Advisory 或私下联系维护者报告会导致凭证泄露、越权消息注入或错误放行的安全问题。
