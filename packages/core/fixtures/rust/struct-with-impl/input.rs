pub struct Server {
    port: u16,
}

impl Server {
    pub fn new(port: u16) -> Self {
        Server { port }
    }

    pub fn describe(&self) -> String {
        self.port.to_string()
    }
}
