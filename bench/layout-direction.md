# Workspace layout-direction evaluation

Run `pnpm bench:layout-direction` to compare the same internal workspace graph
under ELK's `RIGHT` and `DOWN` orientations. The script reports proper routed
edge crossings and the layout bounding-box aspect ratio; it applies the same
external-node filtering and large-map folding as the extension.

Results on 2026-07-20:

| Graph | View | Direction | Nodes / edges | Crossings | Aspect ratio |
|---|---|---:|---:|---:|---:|
| This repository | modules | `RIGHT` | 110 / 287 | 501 | 1.21 |
| This repository | modules | `DOWN` | 110 / 287 | 501 | 12.73 |
| `examples/orders-app` | modules | `RIGHT` | 6 / 14 | 0 | 3.58 |
| `examples/orders-app` | modules | `DOWN` | 6 / 14 | 0 | 1.79 |

`DOWN` improves the small example's shape but severely worsens the larger map,
without reducing crossings in either case. The data therefore does not support
changing the global default or applying one workspace-only orientation. Keep
`RIGHT` as the default and keep the user's `slop.layoutDirection` override
authoritative; rerun this benchmark when more representative graphs are added.
