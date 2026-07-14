def parse(raw):
    return raw.strip()

def load(raw):
    text = parse(raw)
    return render(text)

def render(text):
    return text.upper()
