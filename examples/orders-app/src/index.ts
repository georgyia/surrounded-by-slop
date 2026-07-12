import { type Order, OrderService } from "./orders";
import { money } from "./util/money";

const service = new OrderService();

const order: Order = {
  email: "buyer@example.com",
  card: "4242424242424242",
  items: [
    { sku: "widget", quantity: 2, price: money(9.99) },
    { sku: "gadget", quantity: 1, price: money(19.5) },
  ],
};

export function main(): void {
  const receipt = service.place(order);
  console.log(receipt);
}

main();
