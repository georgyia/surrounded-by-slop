export interface Money {
  readonly cents: number;
}

export function money(dollars: number): Money {
  return { cents: Math.round(dollars * 100) };
}

export function add(a: Money, b: Money): Money {
  return { cents: a.cents + b.cents };
}

export function format(value: Money): string {
  return `$${(value.cents / 100).toFixed(2)}`;
}
