use serde::Serialize;

pub fn encode<T: Serialize>(value: &T) -> String {
    String::new()
}
