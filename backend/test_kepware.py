import asyncio
from asyncua import Client

async def main():
    url = "opc.tcp://localhost:49320"
    client = Client(url)

    await client.connect()
    print("Connected to Kepware!")

    root = client.nodes.root
    print(await root.get_children())

    await client.disconnect()

asyncio.run(main())