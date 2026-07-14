class Pipeline:
    def run(self, data):
        cleaned = self.clean(data)
        return self.publish(cleaned)

    def clean(self, data):
        return data.strip()

    def publish(self, data):
        return len(data)
