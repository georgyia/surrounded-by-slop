from .models import Order
from ..billing.charges import charge
from ..catalog.stock import reserve

def place_order(request, items):
    order = Order(items)
    if not reserve(items):
        return error("out of stock")
    return charge(order.total())

def error(message):
    return {"error": message}
