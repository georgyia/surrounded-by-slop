pub struct Echo;

pub trait Speak {
    fn say(&self) -> String;
}

impl Speak for Echo {
    fn say(&self) -> String {
        String::new()
    }
}
