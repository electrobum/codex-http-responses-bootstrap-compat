import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCodexBootstrapRequest } from '../src/normalizer.mjs';

const delegation = {
  type: 'function_call_output',
  namespace: 'codex_app',
  name: 'send_message_to_thread',
  output: '<codex_delegation><source_thread_id>thread-123</source_thread_id><input>Reply only TEST_OK.</input></codex_delegation>',
};

const heartbeat = {
  type: 'function_call_output',
  namespace: 'codex_app',
  name: 'automation_update',
  output: '<heartbeat><automation_id>daily-check</automation_id><current_time_iso>2026-09-01T00:00:00.000Z</current_time_iso><instructions>Perform one safe check.</instructions></heartbeat>',
};

const scheduled = {
  type: 'function_call_output',
  namespace: 'codex_app',
  name: 'automation_update',
  output: 'Automation: Scheduled project review\nAutomation ID: daily-check\nAutomation memory: $CODEX_HOME/automations/daily-check/memory.md\nLast run: never\n\nPerform one safe check.',
};

test('normalizes a delegation bootstrap without changing surrounding input order', () => {
  const result = normalizeCodexBootstrapRequest({ input: [{ type: 'message', role: 'user', content: 'before' }, delegation] });
  assert.equal(result.changed, true);
  assert.equal(result.delegationCount, 1);
  assert.equal(result.automationCount, 0);
  assert.equal(result.body.input[0].content, 'before');
  assert.deepEqual(result.body.input[1], {
    type: 'message', role: 'user', content: [{ type: 'input_text', text: delegation.output }],
  });
});

test('normalizes both observed automation bootstrap formats', () => {
  for (const item of [heartbeat, scheduled]) {
    const result = normalizeCodexBootstrapRequest({ input: [item] });
    assert.equal(result.changed, true);
    assert.equal(result.automationCount, 1);
    assert.equal(result.body.input[0].type, 'message');
    assert.equal(result.body.input[0].content[0].text, item.output);
  }
});

test('preserves a genuine tool result with call_id', () => {
  const original = { input: [{ ...delegation, call_id: 'call_real_123' }] };
  const result = normalizeCodexBootstrapRequest(original);
  assert.equal(result.changed, false);
  assert.equal(result.body, original);
});

test('rejects unknown missing-call-id function output', () => {
  const original = { input: [{ type: 'function_call_output', namespace: 'codex_app', name: 'unknown', output: 'opaque result' }] };
  const result = normalizeCodexBootstrapRequest(original);
  assert.equal(result.changed, false);
  assert.equal(result.body, original);
});

test('rejects continuation and real function-call contexts', () => {
  const continuation = { previous_response_id: 'resp_123', input: [delegation] };
  const toolContext = { input: [delegation, { type: 'function_call', call_id: 'call_123', name: 'real_tool', arguments: '{}' }] };
  assert.equal(normalizeCodexBootstrapRequest(continuation).changed, false);
  assert.equal(normalizeCodexBootstrapRequest(toolContext).changed, false);
});

test('is idempotent', () => {
  const first = normalizeCodexBootstrapRequest({ input: [delegation] });
  const second = normalizeCodexBootstrapRequest(first.body);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.body, first.body);
});
