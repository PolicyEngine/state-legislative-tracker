"""Tests for the state dataset sources and the district Congress tag in
compute_impacts.py. No network, Supabase or microsimulation. Run with:

    uv run --with numpy --with pyyaml --with python-dotenv --with pytest \
        pytest scripts/test_compute_impacts_datasets.py
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import compute_impacts as ci  # noqa: E402


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, op, payload=None):
        self.table, self.op, self.payload = table, op, payload

    def eq(self, column, value):
        return self

    def execute(self):
        if self.op == "upsert":
            self.table.upserts.append(self.payload)
            return _Result([self.payload])
        return _Result([self.table.existing] if self.table.existing else [])


class _Table:
    def __init__(self, existing):
        self.existing = existing
        self.upserts = []

    def select(self, columns):
        return _Query(self, "select")

    def upsert(self, record):
        return _Query(self, "upsert", record)


class FakeSupabase:
    def __init__(self, existing=None):
        self.reform_impacts = _Table(existing)

    def table(self, name):
        assert name == "reform_impacts"
        return self.reform_impacts


def _impacts(congress=120, districts=True):
    impacts = {
        "computedAt": "2026-11-12T00:00:00+00:00",
        "budgetaryImpact": {},
        "povertyImpact": {},
        "childPovertyImpact": {},
        "winnersLosers": {},
        "decileImpact": {},
    }
    if districts:
        impacts["districtImpacts"] = {"TX-1": {"avgBenefit": 10}}
        impacts["districtCongress"] = congress
    return impacts


@pytest.fixture(autouse=True)
def _no_env(monkeypatch):
    monkeypatch.delenv("TRACKER_STATE_DATASET", raising=False)
    monkeypatch.setattr(ci, "get_installed_version", lambda package: "9.9.9")


@pytest.fixture
def cd120_source(monkeypatch):
    monkeypatch.setitem(
        ci.STATE_DATASETS,
        "test-cd120",
        {
            "dataset_name": "test-data",
            "repo_id": "example/test-data",
            "filename": "states/{state}.h5",
            "revision": "abc123",
            "district_congress": 120,
            "dataset_version": "2026.12.1",
        },
    )


def test_default_source_is_the_119th_congress_us_data_files():
    source = ci.state_dataset_source()
    assert source["name"] == "us-data-cd119"
    assert source["district_congress"] == 119
    assert source["repo_id"] == "policyengine/policyengine-us-data"
    assert source["filename"].format(state="TX") == "states/TX.h5"
    assert ci.state_dataset_version(source) == "9.9.9"


def test_environment_variable_and_argument_choose_the_source(monkeypatch, cd120_source):
    monkeypatch.setenv("TRACKER_STATE_DATASET", "test-cd120")
    source = ci.state_dataset_source()
    assert source["district_congress"] == 120
    assert ci.state_dataset_version(source) == "2026.12.1"
    assert ci.state_dataset_source("us-data-cd119")["district_congress"] == 119


def test_unknown_source_is_an_error():
    with pytest.raises(ValueError, match="Unknown state dataset"):
        ci.state_dataset_source("no-such-dataset")


def test_district_congress_notes_need_district_results_and_a_tag():
    assert ci.district_congress_notes(_impacts(120)) == {"district_congress": 120}
    assert ci.district_congress_notes(_impacts(districts=False)) == {}
    untagged = _impacts()
    del untagged["districtCongress"]
    assert ci.district_congress_notes(untagged) == {}


def test_single_year_write_tags_the_congress_and_dataset():
    supabase = FakeSupabase()
    ci.write_to_supabase(
        supabase, "tx-test", _impacts(120), {"p": 1}, 2027,
        dataset={"name": "test-data", "version": "2026.12.1"},
    )
    record = supabase.reform_impacts.upserts[-1]
    assert record["model_notes"] == {"analysis_year": 2027, "district_congress": 120}
    assert record["dataset_name"] == "test-data"
    assert record["dataset_version"] == "2026.12.1"


def test_write_without_dataset_keeps_the_old_dataset_fields():
    supabase = FakeSupabase()
    ci.write_to_supabase(supabase, "tx-test", _impacts(119), {"p": 1}, 2026)
    record = supabase.reform_impacts.upserts[-1]
    assert record["dataset_name"] == "policyengine-us-data"
    assert record["dataset_version"] == "9.9.9"


def test_multi_year_write_tags_the_new_year_and_leaves_old_years_alone():
    existing = {
        "policyengine_us_version": "1.0.0",
        "reform_params": {"p": 1},
        "model_notes": {
            "analysis_year": 2026,
            "district_congress": 119,
            "impacts_by_year": {"2026": {"districtImpacts": {"TX-1": {}}}},
        },
    }
    supabase = FakeSupabase(existing)
    ci.write_to_supabase(supabase, "tx-test", _impacts(120), {"p": 1}, 2027, multi_year=True)
    notes = supabase.reform_impacts.upserts[-1]["model_notes"]
    assert notes["district_congress"] == 120
    assert notes["impacts_by_year"]["2027"]["districtCongress"] == 120
    assert "districtCongress" not in notes["impacts_by_year"]["2026"]


def test_multi_year_write_without_districts_drops_the_root_tag():
    existing = {
        "model_notes": {"analysis_year": 2026, "district_congress": 119, "impacts_by_year": {}},
    }
    supabase = FakeSupabase(existing)
    ci.write_to_supabase(
        supabase, "tx-test", _impacts(districts=False), {"p": 1}, 2027, multi_year=True
    )
    notes = supabase.reform_impacts.upserts[-1]["model_notes"]
    assert "district_congress" not in notes
    assert "districtCongress" not in notes["impacts_by_year"]["2027"]
