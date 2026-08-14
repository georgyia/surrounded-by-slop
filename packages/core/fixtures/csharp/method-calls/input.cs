public class Pipeline
{
    public void First()
    {
    }

    public void Second()
    {
        First();
    }

    public void Third()
    {
        Second();
        First();
    }
}
