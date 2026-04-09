/**
 * Checks if a DAG has circular dependencies.
 * @param {Array} dag - The array of steps in the DAG.
 * @returns {Boolean} - Returns true if a circular dependency is found.
 */
function hasCircularDependency(dag) {
  const adj = {};
  const nodes = dag.map(node => node.id);

  // Build adjacency list
  dag.forEach(node => {
    adj[node.id] = node.dependencies || [];
  });

  const visited = new Set();
  const recStack = new Set();

  function isCyclic(v) {
    if (recStack.has(v)) return true;
    if (visited.has(v)) return false;

    visited.add(v);
    recStack.add(v);

    const neighbors = adj[v] || [];
    for (const neighbor of neighbors) {
      if (isCyclic(neighbor)) return true;
    }

    recStack.delete(v);
    return false;
  }

  for (const node of nodes) {
    if (isCyclic(node)) return true;
  }

  return false;
}

module.exports = {
  hasCircularDependency
};
