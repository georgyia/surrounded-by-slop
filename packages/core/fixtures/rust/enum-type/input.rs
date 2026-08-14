pub enum Mode {
    On,
    Off,
}

impl Mode {
    pub fn enabled(&self) -> bool {
        matches!(self, Mode::On)
    }
}
