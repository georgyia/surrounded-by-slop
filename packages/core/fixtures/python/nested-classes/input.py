class Outer:
    class Inner:
        def ping(self):
            return "pong"

    def use(self):
        return Outer.Inner()
