import asyncio
from asyncua import ua, Server

ENDPOINT = "opc.tcp://0.0.0.0:4840/ahu-opcua/"
NAMESPACE_URI = "urn:ahu:intelli:opcua"


TAG_DEFS = [
    # KPI rows
    ("ChilledWaterInletTemp_C", 7.2),
    ("ChilledWaterOutletTemp_C", 12.6),
    ("ChilledWaterFlowRate_kgps", 2.8),
    ("MixedAirTemp_C", 24.1),
    ("MixedAirPressure_Pa", 245.0),

    ("InletFilterDP_Pa", 148.0),
    ("DischargeAirTemp_C", 16.1),
    ("DischargeAirMassFlow_kgps", 1.9),
    ("CoolingDemand_TR", 400.0),
    ("FanSpeed_rpm", 910.0),

    # Bottom strip (exclude OverallEffectiveness & CurrentLoadDemand)
    ("CoilFoulingFactor", 50.0),
    ("OverallHeatTransferCoeff", 4.8),
    ("RunningUsefulHoursOfBelt_hr", 16.0),
    ("ExpectedLifeOfFilter_hr", 120.0),
    ("RunningHours_hr", 500.0),

    # Status
    ("AHUStatus", "ON"),
]

SERIES_TAG_DEFS = [
    ("CHW_Energy_Expected", 110.0),
    ("CHW_Energy_Current", 240.0),
    ("CoolingDemand_Btu", 120.0),
    ("CoolingDelivered_Btu", 240.0),
]


async def main():
    server = Server()
    await server.init()

    server.set_endpoint(ENDPOINT)
    server.set_server_name("Intelli AHU OPC UA Server (Dev)")

    # ✅ IMPORTANT: Force NoSecurity only (prevents client requesting Sign/Encrypt endpoints)
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])

    idx = await server.register_namespace(NAMESPACE_URI)
    objects = server.nodes.objects

    # Address space
    root = await objects.add_object(idx, "IntelliAHU")
    ahu1 = await root.add_object(idx, "AHU-0001")
    tags_folder = await ahu1.add_object(idx, "Tags")
    series_folder = await ahu1.add_object(idx, "Series")

    nodes = {}

    # Create writable variables
    for name, initial in TAG_DEFS:
        if isinstance(initial, str):
            var = await tags_folder.add_variable(
                idx, name, ua.Variant(initial, ua.VariantType.String)
            )
        else:
            var = await tags_folder.add_variable(idx, name, float(initial))

        await var.set_writable()
        nodes[name] = var

    for name, initial in SERIES_TAG_DEFS:
        var = await series_folder.add_variable(idx, name, float(initial))
        await var.set_writable()
        nodes[name] = var

    print("\n✅ OPC UA Server running (NoSecurity Dev Mode)")
    print(f"Endpoint: {ENDPOINT}")
    print("Browse: Objects -> IntelliAHU -> AHU-0001 -> Tags / Series")
    print("Manual write via opc_write_cli.py\n")

    # Optional: small “demo” updates so charts move (you can disable by setting DEMO=False)
    DEMO = True

    async def demo_updates():
        while True:
            # Discharge temp oscillation
            t = float(await nodes["DischargeAirTemp_C"].read_value())
            await nodes["DischargeAirTemp_C"].write_value(t + 0.05 if t < 18.0 else 16.1)

            # Filter DP ramp then reset
            dp = float(await nodes["InletFilterDP_Pa"].read_value())
            await nodes["InletFilterDP_Pa"].write_value(dp + 1.5 if dp < 190 else 140.0)

            # Fan speed small ramp then reset
            rpm = float(await nodes["FanSpeed_rpm"].read_value())
            await nodes["FanSpeed_rpm"].write_value(rpm + 10 if rpm < 980 else 900.0)

            # Series values update
            cur = float(await nodes["CHW_Energy_Current"].read_value())
            await nodes["CHW_Energy_Current"].write_value(cur + 5 if cur < 320 else 240.0)

            dem = float(await nodes["CoolingDemand_Btu"].read_value())
            await nodes["CoolingDemand_Btu"].write_value(dem + 2 if dem < 150 else 120.0)

            delv = float(await nodes["CoolingDelivered_Btu"].read_value())
            await nodes["CoolingDelivered_Btu"].write_value(delv + 6 if delv < 330 else 240.0)

            await asyncio.sleep(1)

    async with server:
        if DEMO:
            asyncio.create_task(demo_updates())
        while True:
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())
