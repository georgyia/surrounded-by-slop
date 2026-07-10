import { provide } from "./provider";

export function consume(): number {
  return provide();
}
