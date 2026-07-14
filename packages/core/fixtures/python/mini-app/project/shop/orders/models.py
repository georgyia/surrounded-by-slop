class Order:
    def __init__(self, items):
        self.items = items

    def total(self):
        return sum(item.price for item in self.items)
