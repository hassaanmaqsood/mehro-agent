import openai from './openai.js';
import anthropic from './anthropic.js';
import ollama from './ollama.js';

const registry = new Map();

// Register built-in providers
registry.set('openai', openai);
registry.set('anthropic', anthropic);
registry.set('ollama', ollama);

export function registerProvider(name, providerInstance) {
  if (!providerInstance || typeof providerInstance.complete !== 'function') {
    throw new Error(`Provider for '${name}' must implement complete(messages, modelConfig)`);
  }
  registry.set(name, providerInstance);
}

export function loadProvider(name) {
  if (!name || !registry.has(name)) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return registry.get(name);
}

export function listProviders() {
  return Array.from(registry.keys());
}

export default {
  registerProvider,
  loadProvider,
  listProviders
};
