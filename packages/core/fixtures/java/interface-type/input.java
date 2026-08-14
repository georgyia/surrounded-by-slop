public interface Handler {
    void handle(String path);

    default boolean accepts(String path) {
        return true;
    }
}
