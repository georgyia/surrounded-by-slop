import java.util.List;

public class Box<T extends Comparable<T>> {
    private List<T> items;

    public T first() {
        return items.get(0);
    }
}
