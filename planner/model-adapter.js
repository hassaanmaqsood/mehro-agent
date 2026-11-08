import { loadProvider } from './providers/index.js';

export async function complete(messages, modelConfig = {}) {
  if (!modelConfig || !modelConfig.provider) {
    throw new Error('Missing model.provider in configuration');
  }
  const provider = loadProvider(modelConfig.provider);
  return provider.complete(messages, modelConfig);
}

export default { complete };
