import { publicApi } from "./barrel";

export function caller(): number {
  return publicApi();
}
