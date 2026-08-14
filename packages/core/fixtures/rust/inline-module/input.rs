pub mod config {
    pub struct Settings {
        pub debug: bool,
    }

    pub fn defaults() -> Settings {
        Settings { debug: false }
    }
}
