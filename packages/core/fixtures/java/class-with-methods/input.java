public class Greeter {
    private String name;

    public String greet() {
        return "hello " + name;
    }

    public String shout() {
        return greet().toUpperCase();
    }
}
