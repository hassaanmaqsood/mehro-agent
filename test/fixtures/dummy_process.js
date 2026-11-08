export default {
  id: 'test/dummy',
  version: '1.0.0',
  artifactType: 'process',
  sourceType: 'application/javascript',
  metadata: { name: 'Dummy', description: 'Test process' },
  source: async (input, state, cb) => {
    try {
      const greeting = `Hello, ${input.name || 'world'}!`;
      cb({ output: { result: greeting, error: null }, state });
    } catch (e) {
      cb({ output: { result: null, error: e.message }, state });
    }
  }
};
