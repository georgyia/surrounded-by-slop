public class Factory
{
    public object Make()
    {
        return new Builder();
    }
}

public class Builder
{
}
