# 安全接入、验证与回滚指南

本指南的目标是让中转站用户修复 `function_call_output requires call_id`，同时不伤害现有聊天、自动化或生产任务。

## 0. 先确认适用边界

适用特征：

- Codex Desktop 使用的是第三方 HTTP Responses 中转站、代理或 gateway；
- 普通聊天大体正常；
- 跨任务消息、任务创建、heartbeat 或 scheduled automation 在 HTTP 400 处失败；
- 错误文本包含 `function_call_output requires call_id`。

不适用或需要先另查的情况：认证 401/403、网络 DNS/TLS 失败、模型不可用、普通消息本身也无法发送、原生 WebSocket 已有独立错误。

## 1. 保护现场

不要做：

- 不重写 `config.toml`；
- 不替换 Key、Authorization、登录方式或 provider 域名；
- 不删除/reset `.codex`、聊天记录、automation memory；
- 不向 Commander、worker、历史线程发送“测试消息”；
- 不在线热替换正在承载生产流量的 bridge。

记录错误文本、客户端版本、网关版本和是否为 HTTP Responses；所有共享材料都先删除凭证和真实任务内容。

## 2. 在备用端口启动参考 bridge

桥接器不保存凭证；它原样转发请求头。将原有 upstream base URL 作为环境变量传入：

```powershell
$env:CODEX_COMPAT_UPSTREAM_BASE_URL = 'https://<现有网关地址>'
$env:CODEX_COMPAT_PORT = '18766'
node examples/http-bridge.mjs
```

检查：

```powershell
Invoke-RestMethod http://127.0.0.1:18766/health
```

预期返回含 `"ok": true` 和 `"narrow-bootstrap-only"` 的 JSON。不要在 shell history、Issue、截图或 commit 中保存环境变量的真实值。

## 3. 用独立临时任务验证

通过你现有的 Codex app-server 启动方式，把**仅实验会话**的 provider base URL 指向 bridge，例如：

```text
http://127.0.0.1:18766/v1
```

保留原 provider 的认证/header 机制。不同桌面版、CLI 包装器和中转站的会话级 override 语法不同；本仓库刻意不提供“覆盖所有安装方式”的复制粘贴命令，以免误改用户的全局配置。

测试任务必须是新建的 disposable/ephemeral 空白任务。依次验证：

1. 两轮普通文本对话；
2. 单次只读工具调用后继续回答；
3. 连续两次或更多工具调用后继续回答；
4. 创建临时任务并向它发送无副作用消息；
5. 如可安全调度，在独立 automation 测试任务上验证一次 heartbeat；
6. 检查 unknown missing-`call_id` 输出仍未被错误放行。

## 4. 通过后再切换

只有上述测试全部通过，才安排一次受控的客户端重启并接入正式 bridge。重启后：

1. 先观察自然 heartbeat；
2. 确认它能完成一次工具调用并生成正常响应；
3. 再观察正常跨任务协作；
4. 发现问题先恢复已验证的 bridge 文件/进程，不要连续改 endpoint/auth/config。

## 5. 回滚

若出现 `Reconnecting...`、502、普通对话失败或异常高频重试：

1. 停止**已确认属于实验**的 bridge/app-server 进程；
2. 恢复此前已验证的 bridge/wrapper 副本；
3. 完整退出并重新打开客户端一次；
4. 不改全局 provider、domain、Authorization、登录或聊天数据库；
5. 把新 bridge 留在备用端口继续复现，不要用生产线程调试。

## 为什么不建议伪造 `call_id`

`call_id` 是模型发起的一个具体 function call 与其结果之间的关联键。bootstrap 没有先前模型调用，造一个随机 ID 只会制造虚假的工具历史；放宽所有校验又会让真正损坏或恶意的工具输出进入会话。因此正确做法是识别已知客户端 bootstrap，并将它恢复为本来语义上的 user input。
