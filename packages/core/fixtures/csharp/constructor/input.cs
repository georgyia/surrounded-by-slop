public class Server
{
    private readonly int _port;

    public Server(int port)
    {
        _port = port;
    }

    public Server() : this(8080)
    {
    }
}
