class TaskList:
    def __init__(self):
        self.items = []

    def add(self, title):
        self.items.append(title)
        return summarize(self.items)

def summarize(items):
    return len(items)
