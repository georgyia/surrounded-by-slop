export class Store {
  save(): boolean {
    return true;
  }
}

const store = new Store();

export function persist(): boolean {
  return store.save();
}
