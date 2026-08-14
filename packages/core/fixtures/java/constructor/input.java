public class Server {
    private final int port;

    public Server(int port) {
        this.port = port;
    }

    public Server() {
        this(8080);
    }
}
