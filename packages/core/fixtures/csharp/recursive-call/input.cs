public class Fib
{
    public int At(int n)
    {
        if (n < 2)
        {
            return n;
        }
        return At(n - 1) + At(n - 2);
    }
}
