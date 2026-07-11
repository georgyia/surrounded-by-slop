// A small, readable fixture the integration tests visualize.
export function alpha(): number {
  return beta() + 1;
}

function beta(): number {
  return 41;
}

export class Widget {
  render(): number {
    return alpha();
  }
}
