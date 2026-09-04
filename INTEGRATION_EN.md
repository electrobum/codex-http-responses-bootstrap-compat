# Safe Integration, Validation, and Rollback Guide (English)

This guide is for a narrow failure mode: **Codex Desktop** uses a third-party
HTTP Responses relay, reverse proxy, model gateway, or API aggregator; ordinary
chat works; but a cross-task message, `create_thread`, `send_message_to_thread`,
heartbeat, or scheduled automation is rejected with an HTTP 400 such as:

```text
function_call_output requires call_id on HTTP requests;
continuation via previous_response_id is only supported on Responses WebSocket v2
```

It is a reference for relay maintainers and advanced users. It does **not**
change credentials, provider endpoints, login state, or chat history.

## 0. Scope: confirm that this is the right problem

Typical signals:

- Codex Desktop is connected through a third-party HTTP Responses provider or
  gateway.
- Normal direct messages generally succeed.
- Cross-task delegation, task creation, heartbeat, or scheduled automation
  fails at a strict HTTP Responses validation boundary.
- The error mentions `function_call_output`, `call_id`,
  `previous_response_id`, or `Responses WebSocket v2`.

This guide is not a fix for `401`/`403` authentication errors, DNS or TLS
failures, a model that is unavailable, ordinary messages that always fail, or
an independent native WebSocket problem.

## 1. Preserve the working installation first

Before experimenting:

- Do **not** rewrite `config.toml`, replace an API key or Authorization header,
  change the provider domain, switch login mode, or reset `.codex`.
- Do **not** use a production Commander, worker, historical task, or existing
  automation as a test probe.
- Do **not** hot-replace a bridge that is carrying production conversations.
- Record only redacted evidence: the error text, client version, gateway
  version, and whether the connection uses HTTP Responses. Never publish a
  token, real endpoint, task content, or full request log.

The reference normalizer is deliberately not a universal “accept missing
`call_id`” patch. It protects the real Responses tool protocol by changing
only known client-injected bootstrap payloads.

## 2. What the normalizer changes—and what it refuses to change

In a normal Responses tool loop, a `function_call_output` must pair with the
model’s earlier function call by using its real nonempty `call_id`. Some Codex
Desktop startup flows instead inject text that semantically acts as new user
input. It has no earlier upstream model call and therefore cannot have a valid
model-issued `call_id`.

`src/normalizer.mjs` converts only both of the following **complete** shapes
to a user message in the original input position:

| Recognized bootstrap | Required restrictions |
| --- | --- |
| Delegation | `function_call_output` with a blank/missing `call_id`; namespace `codex_app` or `codex_tui`; name `create_thread` or `send_message_to_thread`; one complete `<codex_delegation>` containing a nonempty `source_thread_id` and `input` |
| Automation | `function_call_output` with a blank/missing `call_id`; namespace `codex_app`; name `automation_update`; one valid heartbeat envelope or the recognized scheduled-automation bootstrap text |

It intentionally leaves the whole request unchanged when any of these are
present:

- a real nonempty `call_id`;
- top-level `previous_response_id`;
- a `function_call` or `item_reference` in the request;
- an unknown, incomplete, malformed, or otherwise unrecognized missing-
  `call_id` function output.

This reject-first boundary matters. Fabricating a `call_id` creates false tool
history; converting every missing-ID output would silently weaken a gateway’s
tool-result validation. The compatibility bridge does neither.

## 3. Start the reference bridge on an isolated alternate port

The bridge passes existing request headers through and does not store
credentials. Supply your existing relay base URL only as a local environment
variable—never commit it or include it in an issue or screenshot.

```powershell
git clone https://github.com/electrobum/codex-http-responses-bootstrap-compat.git
cd codex-http-responses-bootstrap-compat
npm test

$env:CODEX_COMPAT_UPSTREAM_BASE_URL = 'https://<your-existing-relay-base-url>'
$env:CODEX_COMPAT_PORT = '18766'
node examples/http-bridge.mjs
```

Check the local listener:

```powershell
Invoke-RestMethod http://127.0.0.1:18766/health
```

Expected JSON includes `"ok": true` and
`"narrow-bootstrap-only"`. This bridge is a reference implementation. Keep it
on the alternate port; never substitute it directly for a currently active
production bridge without the disposable validation below.

## 4. Validate only with a disposable, empty task

Use the existing session-level app-server/provider override mechanism to point
**only an experimental Codex session** at `http://127.0.0.1:18766/v1`. Preserve
the existing provider and authentication/header behavior. Desktop versions,
CLI wrappers, and relay products differ, so this repository deliberately does
not give a global copy-paste configuration command.

Create a new empty disposable task and test in this order:

1. Complete two ordinary text turns.
2. Complete one harmless or read-only tool call and its follow-up response.
3. Complete two or more consecutive tool calls and their follow-up responses.
4. Create a disposable child task and send it a harmless message.
5. If it can be isolated safely, invoke one heartbeat or scheduled-automation
   bootstrap in a separate disposable automation test.
6. Confirm that an unknown missing-`call_id` output is still rejected rather
   than normalized.

Do not treat one successful direct chat as proof. The important checks are a
real tool continuation, repeated tool calls, delegation, and rejection of
unknown malformed inputs.

## 5. Controlled promotion and rollback

Promote the compatibility layer only after every disposable test passes. Make
one controlled client restart, then observe a natural heartbeat, one ordinary
tool continuation, and normal cross-task collaboration before relying on it.

If you see `Reconnecting...`, `502`, normal-chat failures, or rapid retries:

1. Stop only the **verified experimental** bridge or app-server process.
2. Restore the previously known-good experimental bridge/wrapper copy.
3. Exit and reopen the client once.
4. Keep provider URL, Authorization/login mechanism, and chat database
   unchanged.
5. Leave the experiment on its alternate port and reproduce there. Do not
   debug by sending more test messages to production tasks.

## 6. Relation to upstream fixes

This is a compatibility and regression-testing reference, not a replacement
for native client, relay, or WebSocket v2 support. If your relay has an
upstream narrow fix, prefer to review, test, and merge that fix. The goal is
to preserve strict validation for real tool continuations while handling only
known bootstrap payloads that cannot possess a real call ID.

English-language reports show that this protocol boundary is not limited to
Chinese-language relay users. They do not automatically prove that every
report has the same root cause, but they are useful search anchors:

- [openai/codex#42088](https://github.com/openai/codex/issues/42088) — strict
  upstream rejection of an unpaired `function_call_output`.
- [openai/codex#42067](https://github.com/openai/codex/issues/42067) — missing
  `call_id` during thread resume or cross-thread communication with third-party
  Responses providers.
- [openai/codex#41690](https://github.com/openai/codex/issues/41690) — Codex
  Desktop automation bootstrap rejected by a third-party Responses provider.

For canonical Responses tool-calling semantics, see the official OpenAI
[Function calling guide](https://developers.openai.com/api/docs/guides/function-calling).

## Security and support boundary

Contributions should contain only redacted, synthetic bootstrap payloads and
tests. Do not submit API keys, Bearer tokens, Authorization headers, actual
provider domains, `config.toml`, chat history, personal screenshots, or raw
production logs. See [SECURITY.md](../SECURITY.md).
