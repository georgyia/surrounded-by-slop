# orders-app — a tiny app to visualize

A deliberately over-engineered checkout flow, here so you have something small
to point the extension at.

## Try it

1. **Open this folder** on its own: File → Open Folder → `examples/orders-app`
   (opening the whole repo works too, but a small folder is the clearest demo).
2. Open [`src/orders.ts`](src/orders.ts) and press **`Cmd/Ctrl` + `Shift` + `V`**.
   You'll see the `OrderService` class, its methods, and the calls between them —
   including the `place → placeOrderFinal2 → placeOrderFinal` chain that nobody
   dares delete.
3. **Click any box** to jump straight to that function in the source.
4. Run **`Slop: Visualize Workspace`** from the command palette (`Cmd/Ctrl` +
   `Shift` + `P`) to see every module and how they depend on each other — spoiler:
   everything leans on `util/money`.
5. Try **`Slop: Export Diagram As…`** to save it as draw.io / Mermaid / SVG / JSON.

## What's in here

```
src/
  index.ts        entry point — builds an order and places it
  orders.ts       OrderService: the checkout the diagram is really about
  inventory.ts    stock lookups and reservations
  payments.ts     card validation and charging
  notify.ts       "sends" the receipt
  util/money.ts   the money helper everything depends on
```

Nothing here talks to the network or the disk — it's a toy. The point is the
shape, not the shipping.
