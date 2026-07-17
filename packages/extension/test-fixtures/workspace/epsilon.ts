// Imports a bare external package (react). On the single-file view that node is
// the point; on the workspace map it's a fan-in hub and hidden by default.
import { useState } from "react";
import { gamma } from "./gamma";

export function epsilon(): number {
  const [n] = useState(gamma());
  return n;
}
