import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync


class FakeCatalog:
    def refresh(self): pass
    def get(self, mid, diff):
        return {"title": "Test", "artist": "Artist", "level": 19}


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.base = {"music_id": 1, "diff_idx": 4, "score": 9900000, "clear_type": 2,
                     "received_at": "2026-10-01T12:00:00Z", "volforce": 999}

    def test_legacy_play_recomputes_vf_instead_of_using_old_chart_best(self):
        result = sync.play_record(self.base, FakeCatalog())
        self.assertEqual(result["play_vf"], .395)
        self.assertNotIn("profile_id", result)
        self.assertEqual(sync.play_record({**self.base, "clear_type": 1}, FakeCatalog())["play_vf"], .197)

    def test_partial_final_line_is_not_acknowledged_until_newline_arrives(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "log"
            one = json.dumps(self.base).encode() + b"\n"
            path.write_bytes(one + json.dumps(self.base).encode())
            records, cursor = sync.read_batch(path, {}, lambda r: r)
            self.assertEqual(len(records), 1)
            self.assertEqual(cursor["offset"], len(one))
            with path.open("ab") as stream: stream.write(b"\n")
            records, cursor = sync.read_batch(path, cursor, lambda r: r)
            self.assertEqual(len(records), 1)

    def test_failed_upload_keeps_cursor_for_retry_and_success_does_not_reupload(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tracker = root / "tracker"
            tracker.mkdir()
            (tracker / "score_log.txt").write_text(json.dumps(self.base) + "\n", encoding="utf-8")
            config = {"url": "https://test.example", "token": "a" * 64}
            with patch.object(sync, "ROOT", root), patch.object(sync, "upload", side_effect=RuntimeError("network")):
                with self.assertRaises(RuntimeError): sync.sync_once(config, tracker, FakeCatalog())
                self.assertFalse((root / ".local/sync-state.json").exists())
            with patch.object(sync, "ROOT", root), patch.object(sync, "upload") as upload:
                sync.sync_once(config, tracker, FakeCatalog())
                self.assertEqual(upload.call_args.args[2]["plays"][0]["score"], 9900000)
                upload.reset_mock()
                sync.sync_once(config, tracker, FakeCatalog())
                upload.assert_not_called()

    def test_joined_historical_json_records_are_recovered_across_batches(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "log"
            path.write_text(json.dumps({"a": 1}) + json.dumps({"a": 2}) + json.dumps({"a": 3}) + "\n", encoding="utf-8")
            cursor = {}
            for index in range(1, 4):
                records, cursor = sync.read_batch(path, cursor, lambda r: r, limit=1)
                self.assertEqual(records, [{"a": index}])
            records, cursor = sync.read_batch(path, cursor, lambda r: r)
            self.assertEqual(records, [])

    def test_timing_matches_early_positive_game_convention(self):
        record = {**self.base, "timing_histogram": [1, 0, 0, 1, 0, 0, 0], "judgments": {"near": 1}}
        self.assertEqual(sync.play_record(record, FakeCatalog())["timing"], 43.75)

    def test_current_appeal_updates_without_song_changes_and_uses_xml_texture_mapping(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow is needed for artwork checks")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tracker = root / "game/tracker"
            game = tracker.parent
            (tracker / "cache").mkdir(parents=True)
            (game / "data/others").mkdir(parents=True)
            artwork = game / "data/graphics/ap_card"
            artwork.mkdir(parents=True)
            (game / "data/others/appeal_card.xml").write_text(
                '<cards><card id="5535"><info><texture>ap_06_R0035</texture></info></card>'
                '<card id="2"><info><texture>another_card</texture></info></card></cards>', encoding="cp932")
            for texture, color in [("ap_06_R0035", "red"), ("another_card", "blue")]:
                image = Image.new("RGBA", (3, 3), (0, 0, 0, 0))
                image.putpixel((1, 1), (*Image.new("RGB", (1, 1), color).getpixel((0, 0)), 255))
                image.save(artwork / f"{texture}.png")
            cache = tracker / "cache/total_volforce.json"
            raw = {"source": "sv7_load_m", "chart_volforce": {}, "updated_at": self.base["received_at"],
                   "profile_id": "private", "player": {"appeal_id": 5535}}
            cache.write_text(json.dumps(raw), encoding="utf-8")
            catalog = sync.Catalog(tracker)
            with patch.object(sync, "ROOT", root):
                catalog.refresh()
                catalog.prepare_covers()
                first = catalog.appeal_card
                self.assertIsNotNone(first)
                restarted = sync.Catalog(tracker)
                restarted.refresh()
                with patch("PIL.Image.open", side_effect=AssertionError("Cached artwork was re-encoded")):
                    restarted.prepare_covers()
                self.assertEqual(restarted.appeal_card, first)
                with Image.open(root / ".local/covers" / f"{first}.webp") as image:
                    self.assertEqual(image.getpixel((0, 0))[3], 0)
                state, _ = sync.snapshot(tracker, catalog, "Test")
                self.assertEqual(state["appeal_card"], first)
                self.assertNotIn("private", json.dumps(state))
                self.assertNotIn("appeal_id", json.dumps(state))
                raw["player"]["appeal_id"] = 2
                cache.write_text(json.dumps(raw), encoding="utf-8")
                catalog.prepare_covers()
                self.assertNotEqual(catalog.appeal_card, first)
                raw["player"]["appeal_id"] = "../../invalid"
                cache.write_text(json.dumps(raw), encoding="utf-8")
                catalog.prepare_covers()
                self.assertIsNone(catalog.appeal_card)


if __name__ == "__main__": unittest.main()
