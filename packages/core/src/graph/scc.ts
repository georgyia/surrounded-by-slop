/**
 * Tarjan's strongly connected components over a generic adjacency map.
 * Used to mark import cycles; kept dependency-free and deterministic
 * (component order follows the input's iteration order).
 */
export function stronglyConnectedComponents(
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let nextIndex = 0;

  function strongConnect(vertex: string): void {
    index.set(vertex, nextIndex);
    lowLink.set(vertex, nextIndex);
    nextIndex += 1;
    stack.push(vertex);
    onStack.add(vertex);

    for (const neighbor of adjacency.get(vertex) ?? []) {
      if (!adjacency.has(neighbor)) {
        continue;
      }
      if (!index.has(neighbor)) {
        strongConnect(neighbor);
        lowLink.set(vertex, Math.min(lowLink.get(vertex) ?? 0, lowLink.get(neighbor) ?? 0));
      } else if (onStack.has(neighbor)) {
        lowLink.set(vertex, Math.min(lowLink.get(vertex) ?? 0, index.get(neighbor) ?? 0));
      }
    }

    if (lowLink.get(vertex) === index.get(vertex)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== vertex);
      components.push(component);
    }
  }

  for (const vertex of adjacency.keys()) {
    if (!index.has(vertex)) {
      strongConnect(vertex);
    }
  }
  return components;
}

/**
 * Vertices that sit inside a cycle: members of any multi-vertex component,
 * plus vertices with a self-edge.
 */
export function verticesInCycles(adjacency: ReadonlyMap<string, readonly string[]>): Set<string> {
  const cyclic = new Set<string>();
  for (const component of stronglyConnectedComponents(adjacency)) {
    if (component.length > 1) {
      for (const member of component) {
        cyclic.add(member);
      }
    }
  }
  for (const [vertex, neighbors] of adjacency) {
    if (neighbors.includes(vertex)) {
      cyclic.add(vertex);
    }
  }
  return cyclic;
}
