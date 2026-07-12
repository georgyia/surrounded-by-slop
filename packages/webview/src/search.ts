/**
 * Pure search-and-filter logic for the diagram (SBS-063), kept out of `main.ts`
 * so the matching can be unit-tested without a DOM. The webview only toggles
 * CSS classes on already-rendered nodes with these decisions — no re-layout —
 * which is what keeps filtering fast on thousands of nodes.
 */

export interface FilterableNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** The node's source path (or qualified name for synthetic nodes). */
  readonly path: string;
}

export interface FilterState {
  readonly query: string;
  /** Node kinds the user has switched off. */
  readonly disabledKinds: ReadonlySet<string>;
  /** Top-level path segments the user has switched off. */
  readonly disabledPaths: ReadonlySet<string>;
}

export const EMPTY_FILTER: FilterState = {
  query: "",
  disabledKinds: new Set(),
  disabledPaths: new Set(),
};

/** Case-insensitive subsequence match: every char of `query`, in order. */
export function fuzzyMatch(text: string, query: string): boolean {
  if (query === "") {
    return true;
  }
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index === needle.length) {
        return true;
      }
    }
  }
  return false;
}

/** The leading path segment a node groups under (its top-level folder or file). */
export function topSegment(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

/** Whether any filter is active — when false the diagram renders untouched. */
export function isFiltering(state: FilterState): boolean {
  return state.query !== "" || state.disabledKinds.size > 0 || state.disabledPaths.size > 0;
}

/** Whether `node` survives the current filter (matches the query and no chip hides it). */
export function nodePasses(node: FilterableNode, state: FilterState): boolean {
  if (state.disabledKinds.has(node.kind)) {
    return false;
  }
  if (state.disabledPaths.has(topSegment(node.path))) {
    return false;
  }
  return fuzzyMatch(node.label, state.query) || fuzzyMatch(node.path, state.query);
}

/** The ids that survive the filter — used to highlight matches and dim the rest. */
export function matchingIds(nodes: readonly FilterableNode[], state: FilterState): string[] {
  return nodes.filter((node) => nodePasses(node, state)).map((node) => node.id);
}
