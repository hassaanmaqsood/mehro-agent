export async function complete(messages, modelConfig = {}) {
  const host = modelConfig.host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const model = modelConfig.model || 'tinyllama:1.1b';
  const temperature = modelConfig.temperature ?? 0.2;

  // Use /api/chat endpoint
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature
      }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Ollama API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.message?.content || '';
}

export default { complete };
