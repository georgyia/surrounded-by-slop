export class Explicit {
  constructor(public label: string) {}
}

export class Implicit {
  label = "implicit";
}

export function build(): Explicit[] {
  const first = new Explicit("one");
  const second = new Implicit();
  return [first, second as Explicit];
}
