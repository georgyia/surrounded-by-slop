public enum Mode {
    ON,
    OFF;

    public boolean enabled() {
        return this == ON;
    }
}
