import { format, type Money } from "./util/money";

export type PaymentResult =
  | { readonly ok: true; readonly receipt: string }
  | { readonly ok: false; readonly reason: string };

export function charge(card: string, amount: Money): PaymentResult {
  if (!isValidCard(card)) {
    return { ok: false, reason: "invalid card" };
  }
  return { ok: true, receipt: `charged ${format(amount)} to ${mask(card)}` };
}

function isValidCard(card: string): boolean {
  return /^[0-9]{16}$/.test(card);
}

function mask(card: string): string {
  return `••••${card.slice(-4)}`;
}
