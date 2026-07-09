export async function load(): Promise<unknown> {
  return import("./lazy");
}
