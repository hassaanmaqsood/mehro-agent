import { signConfirmationToken } from './confirm.js';

export function resolveMode(context = {}) {
  // 1. config.yaml — global default
  let mode = context.config?.security?.approvalMode || 'auto';

  // 2. MEHRO.md frontmatter — project-level override
  if (context.mehroFrontmatter?.security?.approvalMode) {
    mode = context.mehroFrontmatter.security.approvalMode;
  }

  // 3. CLI / TUI session flag — session-level override (--approval / /approval)
  if (context.sessionApprovalMode) {
    mode = context.sessionApprovalMode;
  }

  // 4. Per-tool rule override in rules (require-confirm forces review mode)
  if (context.requireConfirm) {
    mode = 'review';
  }

  return mode;
}

export async function gate(toolName, input, context = {}) {
  const mode = resolveMode(context);

  if (mode === 'allow-all') {
    return {
      approved: true,
      token: signConfirmationToken(toolName, { input }),
      input
    };
  }

  if (mode === 'auto' && !context.requireConfirm) {
    return {
      approved: true,
      token: signConfirmationToken(toolName, { input }),
      input
    };
  }

  // mode === 'review'
  if (typeof context.tuiConfirm === 'function') {
    const decision = await context.tuiConfirm({ tool: toolName, input });
    if (!decision || decision.action === 'no' || decision.action === 'reject') {
      return { approved: false, error: 'user_rejected', input };
    }
    const finalInput = decision.edited || decision.input || input;
    return {
      approved: true,
      token: signConfirmationToken(toolName, { input: finalInput }),
      input: finalInput
    };
  }

  // If no interactive confirm handler available in review mode
  return {
    approved: false,
    error: 'confirmation_required',
    input
  };
}

export default {
  resolveMode,
  gate
};
