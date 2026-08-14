public class Fib {
    public int at(int n) {
        if (n < 2) {
            return n;
        }
        return at(n - 1) + at(n - 2);
    }
}
