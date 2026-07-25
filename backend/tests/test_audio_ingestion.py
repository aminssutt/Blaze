import json

import pytest

from backend.loaders.audio_ingestion import AudioIngestionService
from backend.streaming.bus import EventBus


def make_bus() -> EventBus:
    return EventBus("wildfire-demo-01")


def test_manifest_loads_five_items_in_scenario_order():
    items = AudioIngestionService().load_manifest()
    assert len(items) == 5
    timestamps = [i["scenario_timestamp"] for i in items]
    assert timestamps == sorted(timestamps)


@pytest.mark.asyncio
async def test_ingest_emits_five_audio_received_in_order():
    bus = make_bus()
    counts = await AudioIngestionService().ingest(bus, variant="radio", speed_factor=0)
    assert counts == {"emitted": 5, "errors": 0}
    events = [e for e in bus.history if e["event_type"] == "audio.received"]
    assert [e["payload"]["audio_id"] for e in events] == [
        "audio_01", "audio_02", "audio_03", "audio_04", "audio_05",
    ]
    assert all(e["payload"]["duration_seconds"] > 0 for e in events)


@pytest.mark.asyncio
async def test_clean_radio_switch_per_run():
    for variant in ("clean", "radio"):
        bus = make_bus()
        await AudioIngestionService().ingest(bus, variant=variant, speed_factor=0)
        for e in bus.history:
            assert e["payload"]["audio_variant"] == variant
            assert e["payload"]["audio_path"].endswith(f"_{variant}.wav")


@pytest.mark.asyncio
async def test_missing_file_emits_labeled_error_and_continues(tmp_path):
    manifest = AudioIngestionService().load_manifest()
    manifest[1]["clean_path"] = "data/audio/does_not_exist.wav"
    broken = tmp_path / "manifest.json"
    broken.write_text(json.dumps(manifest))

    bus = make_bus()
    counts = await AudioIngestionService(broken).ingest(bus, variant="clean", speed_factor=0)
    assert counts == {"emitted": 4, "errors": 1}
    errors = [e for e in bus.history if e["event_type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["payload"]["error_type"] == "audio_missing"
    assert errors[0]["payload"]["audio_id"] == "audio_02"
    # the remaining items were still emitted after the error
    received = [e["payload"]["audio_id"] for e in bus.history if e["event_type"] == "audio.received"]
    assert received == ["audio_01", "audio_03", "audio_04", "audio_05"]
