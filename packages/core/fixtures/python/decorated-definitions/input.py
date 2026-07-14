import functools

@functools.cache
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

class Api:
    @staticmethod
    def ping():
        return "ok"
