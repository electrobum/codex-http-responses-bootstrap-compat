/**
 * Codex bootstrap normalizer for strict HTTP Responses gateways.
 *
 * This module intentionally recognizes only client-injected bootstrap shapes
 * that cannot possess a real model function-call `call_id`. It does not relax
 * validation for normal tool results.
 */

const DELEGATION_NAMES = new Set(['create_thread', 'send_message_to_thread']);
const DELEGATION_NAMESPACES = new Set(['codex_app', 'codex_tui']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasBlankCallId(item) {
  return !nonEmptyString(item?.call_id);
}

function hasForbiddenContext(body) {
  if (nonEmptyString(body.previous_response_id)) return true;
  return body.input.some(item =>
    isPlainObject(item) &&
    (item.type === 'function_call' || item.type === 'item_reference')
  );
}

function hasSingleRoot(value, root) {
  const trimmed = value.trim();
  if (trimmed.includes('<!') || trimmed.includes('<?')) return false;
  const open = `<${root}>`;
  const close = `</${root}>`;
  return trimmed.startsWith(open) && trimmed.endsWith(close) &&
    trimmed.indexOf(open) === 0 && trimmed.indexOf(open, open.length) === -1 &&
    trimmed.lastIndexOf(close) === trimmed.length - close.length;
}

function xmlText(value, tag) {
  const expression = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const matches = [...value.matchAll(expression)];
  if (matches.length !== 1) return null;
  return matches[0][1];
}

function validDelegationEnvelope(output) {
  if (!nonEmptyString(output) || !hasSingleRoot(output, 'codex_delegation')) return false;
  const source = xmlText(output, 'source_thread_id');
  const input = xmlText(output, 'input');
  return Boolean(
    nonEmptyString(source) &&
    /^[A-Za-z0-9._:-]{1,256}$/.test(source.trim()) &&
    nonEmptyString(input)
  );
}

function validHeartbeatEnvelope(output) {
  if (!nonEmptyString(output) || !hasSingleRoot(output, 'heartbeat')) return false;
  const automationId = xmlText(output, 'automation_id');
  const timestamp = xmlText(output, 'current_time_iso');
  const instructions = xmlText(output, 'instructions');
  return Boolean(
    nonEmptyString(automationId) &&
    /^[A-Za-z0-9._-]{1,128}$/.test(automationId.trim()) &&
    nonEmptyString(timestamp) &&
    /^\d{4}-\d{2}-\d{2}T/.test(timestamp.trim()) &&
    Number.isFinite(Date.parse(timestamp.trim())) &&
    nonEmptyString(instructions)
  );
}

function validLastRun(value) {
  if (value === 'never') return true;
  const match = /^(.*) \((\d+)\)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(match[1]))) return false;
  return Date.parse(match[1]) === Number(match[2]);
}

function validScheduledAutomationText(output) {
  if (!nonEmptyString(output) || output.includes('\r') && !output.includes('\r\n')) return false;
  const lines = output.replaceAll('\r\n', '\n').split('\n');
  if (lines.length < 6 || !lines[0].startsWith('Automation: ')) return false;
  const automationId = lines[1].startsWith('Automation ID: ') ? lines[1].slice(15) : '';
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(automationId)) return false;
  if (lines[2] !== `Automation memory: $CODEX_HOME/automations/${automationId}/memory.md`) return false;
  if (!lines[3].startsWith('Last run: ') || !validLastRun(lines[3].slice(10))) return false;
  return lines[4] === '' && nonEmptyString(lines.slice(5).join('\n'));
}

function isDelegationBootstrap(item) {
  return isPlainObject(item) &&
    item.type === 'function_call_output' &&
    hasBlankCallId(item) &&
    DELEGATION_NAMESPACES.has(item.namespace) &&
    DELEGATION_NAMES.has(item.name) &&
    validDelegationEnvelope(item.output);
}

function isAutomationBootstrap(item) {
  return isPlainObject(item) &&
    item.type === 'function_call_output' &&
    hasBlankCallId(item) &&
    item.namespace === 'codex_app' &&
    item.name === 'automation_update' &&
    (validHeartbeatEnvelope(item.output) || validScheduledAutomationText(item.output));
}

function asUserMessage(item) {
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: item.output }],
  };
}

/**
 * Returns an unchanged body unless every function_call_output in the request is
 * a known bootstrap and the request has no continuation/tool-call context.
 */
export function normalizeCodexBootstrapRequest(body) {
  if (!isPlainObject(body) || !Array.isArray(body.input) || hasForbiddenContext(body)) {
    return { body, changed: false, delegationCount: 0, automationCount: 0 };
  }

  const functionOutputs = body.input.filter(item => isPlainObject(item) && item.type === 'function_call_output');
  if (functionOutputs.length === 0) {
    return { body, changed: false, delegationCount: 0, automationCount: 0 };
  }

  const delegationCount = functionOutputs.filter(isDelegationBootstrap).length;
  const automationCount = functionOutputs.filter(isAutomationBootstrap).length;
  if (delegationCount + automationCount !== functionOutputs.length) {
    return { body, changed: false, delegationCount: 0, automationCount: 0 };
  }

  const input = body.input.map(item =>
    isDelegationBootstrap(item) || isAutomationBootstrap(item) ? asUserMessage(item) : item
  );
  return {
    body: { ...body, input },
    changed: true,
    delegationCount,
    automationCount,
  };
}
