export async function complete(messages, modelConfig = {}) {
  const apiKey = modelConfig.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Anthropic API key missing in config and ANTHROPIC_API_KEY environment variable');
  }

  const baseUrl = modelConfig.baseUrl || 'https://api.anthropic.com/v1';
  const model = modelConfig.model || 'claude-sonnet-4-6';
  const temperature = modelConfig.temperature ?? 0.2;
  const maxTokens = modelConfig.maxTokens || 4096;

  // Extract system message if present
  let systemPrompt = '';
  const filteredMessages = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + m.content;
    } else {
      filteredMessages.push(m);
    }
  }

  const payload = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: filteredMessages
  };
  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text || '';
}

export default { complete };
