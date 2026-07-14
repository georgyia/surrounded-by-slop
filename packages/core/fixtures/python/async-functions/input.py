import asyncio

async def fetch(url):
    await asyncio.sleep(0)
    return url

async def main():
    return await fetch("https://example.test")
