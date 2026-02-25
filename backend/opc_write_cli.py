import argparse
from asyncua import Client, ua

ENDPOINT = "opc.tcp://localhost:4840/ahu-opcua/"
NAMESPACE_URI = "urn:ahu:intelli:opcua"

def nodeid_for(tag: str, folder: str) -> str:
    # We used string node ids implicitly by browse name, but easiest is to browse.
    # For simplicity, we will browse to find the tag node by name.
    return tag, folder

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Tag name, e.g. InletFilterDP_Pa")
    parser.add_argument("--value", required=True, help="Value to write (number or string)")
    parser.add_argument("--folder", default="Tags", choices=["Tags", "Series"])
    args = parser.parse_args()

    async with Client(url=ENDPOINT) as client:
        # Find: Objects -> IntelliAHU -> AHU-0001 -> (Tags/Series) -> tag
        objects = client.nodes.objects
        intelli = await objects.get_child(["2:IntelliAHU"])
        ahu = await intelli.get_child(["2:AHU-0001"])
        folder = await ahu.get_child([f"2:{args.folder}"])
        node = await folder.get_child([f"2:{args.tag}"])

        # Type handling
        try:
            num = float(args.value)
            await node.write_value(num)
            print(f"✅ Wrote {args.tag} = {num}")
        except ValueError:
            await node.write_value(ua.Variant(args.value, ua.VariantType.String))
            print(f"✅ Wrote {args.tag} = '{args.value}'")

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
