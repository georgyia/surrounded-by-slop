// Imports through the tsconfig `@/*` alias rather than a relative path: the
// workspace map has to resolve this to gamma.ts, not invent an "@/gamma"
// external package (#68).
import { gamma } from "@/gamma";

export function delta(): number {
  return gamma() - 1;
}
