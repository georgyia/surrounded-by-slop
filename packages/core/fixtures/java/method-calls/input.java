public class Pipeline {
    public void first() {
    }

    public void second() {
        first();
    }

    public void third() {
        second();
        first();
    }
}
