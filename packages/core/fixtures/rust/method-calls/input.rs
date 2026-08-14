pub struct Chain;

impl Chain {
    fn first(&self) {
    }

    fn second(&self) {
        self.first();
    }

    fn third(&self) {
        self.second();
        self.first();
    }
}
