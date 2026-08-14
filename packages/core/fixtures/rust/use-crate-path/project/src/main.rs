use crate::store::Store;

mod store;

fn main() {
    let _ = Store::open();
}
