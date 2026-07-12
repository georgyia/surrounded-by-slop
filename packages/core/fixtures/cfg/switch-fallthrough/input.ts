export function describe(k: "a" | "b" | "c"): string {
  let out = "";
  switch (k) {
    case "a":
      out += "a";
    case "b":
      out += "b";
      break;
    case "c":
      out += "c";
      break;
  }
  return out;
}
