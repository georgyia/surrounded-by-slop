import { inStock, reserve } from "./inventory";
import { notify } from "./notify";
import { charge } from "./payments";
import { add, type Money, money } from "./util/money";

export interface LineItem {
  readonly sku: string;
  readonly quantity: number;
  readonly price: Money;
}

export interface Order {
  readonly email: string;
  readonly card: string;
  readonly items: readonly LineItem[];
}

export class OrderService {
  place(order: Order): string {
    return this.placeOrderFinal2(order);
  }

  total(order: Order): Money {
    return order.items.reduce((sum, item) => add(sum, item.price), money(0));
  }

  // The function nobody dares delete.
  private placeOrderFinal2(order: Order): string {
    return this.placeOrderFinal(order);
  }

  private placeOrderFinal(order: Order): string {
    for (const item of order.items) {
      if (!inStock(item.sku) || !reserve(item.sku, item.quantity)) {
        return `out of stock: ${item.sku}`;
      }
    }
    const result = charge(order.card, this.total(order));
    if (!result.ok) {
      return `payment failed: ${result.reason}`;
    }
    notify(order.email, result.receipt);
    return result.receipt;
  }
}
