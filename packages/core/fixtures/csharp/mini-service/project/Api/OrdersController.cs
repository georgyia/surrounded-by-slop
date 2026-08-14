using Shop.Store;

namespace Shop.Api;

public class OrdersController
{
    private readonly OrderRepository _repository;

    public OrdersController(OrderRepository repository)
    {
        _repository = repository;
    }

    public string Find(string id)
    {
        return Lookup(id);
    }

    private string Lookup(string id)
    {
        return _repository.ById(id);
    }
}
