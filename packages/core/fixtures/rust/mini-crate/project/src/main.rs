use crate::web::Server;

mod store;
mod web;

fn main() {
    let server = Server::new();
    server.serve();
}
