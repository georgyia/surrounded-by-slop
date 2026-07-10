import { createDb } from "./services/db";
import { trim } from "./util/strings";

export function main(input: string): string {
  const db = createDb();
  db.connect();
  return trim(input);
}
