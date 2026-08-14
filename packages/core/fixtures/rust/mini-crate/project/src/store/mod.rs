pub struct Store;

impl Store {
    pub fn open() -> Self {
        Store
    }

    pub fn get(&self, key: &str) -> String {
        String::from(key)
    }
}
