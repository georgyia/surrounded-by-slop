pub trait Handler {
    fn handle(&self, path: &str) -> bool;

    fn accepts(&self, path: &str) -> bool {
        self.handle(path)
    }
}
