from ..settings import DEBUG

_stock = {}

def reserve(items):
    if DEBUG:
        return True
    return all(_stock.get(i.sku, 0) > 0 for i in items)
