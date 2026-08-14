use super::store::Store;

pub struct Server {
    store: Store,
}

impl Server {
    pub fn new() -> Self {
        Server { store: Store::open() }
    }

    pub fn serve(&self) -> String {
        self.store.get("/")
    }
}
