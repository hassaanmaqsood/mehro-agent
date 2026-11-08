export async function complete(messages, modelConfig = {}) {
  const apiKey = modelConfig.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key missing in config and OPENAI_API_KEY environment variable');
  }

  const baseUrl = modelConfig.baseUrl || 'https://api.openai.com/v1';
  const model = modelConfig.model || 'gpt-4o';
  const temperature = modelConfig.temperature ?? 0.2;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return choice?.message?.content || '';
}

export default { complete };
