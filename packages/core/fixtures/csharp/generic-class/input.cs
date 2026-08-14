public class Box<T> where T : class
{
    private T _item;

    public T Get()
    {
        return _item;
    }
}
