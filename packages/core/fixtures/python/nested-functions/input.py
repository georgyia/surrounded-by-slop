def outer(items):
    def key(item):
        return item.rank

    return sorted(items, key=key)
