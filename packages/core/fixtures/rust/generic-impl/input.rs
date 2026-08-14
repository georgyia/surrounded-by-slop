pub struct Wrapper<T> {
    inner: T,
}

impl<T: Clone> Wrapper<T> {
    pub fn get(&self) -> T {
        self.inner.clone()
    }
}
