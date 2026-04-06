#!/usr/bin/env python3
"""
Multi-strategy validation harness for reform impact estimation.

Constructs target estimates from multiple independent strategies when
fiscal notes are unavailable. This is the "prepare.py" equivalent in the
autoresearch pattern — the immutable evaluation infrastructure that the
calibration agent cannot modify.

Strategies:
  1. Fiscal note (direct lookup from DB or fiscal-finder output)
  2. Revenue-base reasoning (state revenue / rate = taxable base)
  3. Back-of-envelope from provisions (delta * affected population * rate)
  4. Tax expenditure report scaling
  5. Similar bill scaling (cross-state or prior-session)

Usage:
    from validation_harness import build_target, HarnessResult

    result = build_target(
        reform_id="ga-hb168",
        state="ga",
        provisions=[...],
        reform_params={...},
        fiscal_data={"fiscal_note": {...}, "back_of_envelope": {...}},
    )
    print(result.target, result.confidence, result.tolerance)
"""

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median
from typing import Optional

from dotenv import load_dotenv

_script_dir = Path(__file__).parent
_env_path = _script_dir.parent / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)


# =============================================================================
# DATA: State income tax revenue (Census Bureau, FY2023, $ billions)
# Source: US Census Bureau Annual Survey of State Government Tax Collections
# Update annually from: https://www.census.gov/programs-surveys/stc.html
# =============================================================================

STATE_PIT_REVENUE = {
    "AL": 5.1e9, "AZ": 5.4e9, "AR": 4.1e9, "CA": 115.0e9, "CO": 12.8e9,
    "CT": 10.5e9, "DE": 1.5e9, "GA": 14.2e9, "HI": 2.6e9, "ID": 2.4e9,
    "IL": 22.0e9, "IN": 7.5e9, "IA": 4.7e9, "KS": 4.2e9, "KY": 5.8e9,
    "LA": 3.8e9, "ME": 2.1e9, "MD": 11.2e9, "MA": 18.0e9, "MI": 11.5e9,
    "MN": 13.5e9, "MS": 2.3e9, "MO": 7.8e9, "MT": 1.5e9, "NE": 2.8e9,
    "NJ": 17.5e9, "NM": 2.1e9, "NY": 63.0e9, "NC": 17.0e9, "ND": 0.5e9,
    "OH": 11.0e9, "OK": 3.8e9, "OR": 11.0e9, "PA": 16.0e9, "RI": 1.6e9,
    "SC": 5.8e9, "UT": 5.2e9, "VT": 1.0e9, "VA": 16.5e9, "WV": 2.2e9,
    "WI": 9.5e9, "DC": 3.2e9,
}

# States with no income tax — harness should not attempt revenue-base reasoning
NO_INCOME_TAX_STATES = {"AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"}


# =============================================================================
# RESULT TYPES
# =============================================================================

@dataclass
class StrategyEstimate:
    """One estimate from a single strategy."""
    name: str
    estimate: float  # Dollar amount (negative = revenue loss)
    confidence: str  # "high", "medium", "medium-low", "low"
    source: str  # URL or description of data source
    reasoning: str  # How the estimate was derived

    # Confidence weights for triangulation
    CONFIDENCE_WEIGHTS = {"high": 3.0, "medium": 2.0, "medium-low": 1.0, "low": 0.5}

    @property
    def weight(self) -> float:
        return self.CONFIDENCE_WEIGHTS.get(self.confidence, 1.0)


@dataclass
class HarnessResult:
    """Output of the validation harness."""
    target: float  # Target estimate (dollar amount)
    confidence: str  # Overall confidence: "high", "medium", "low", "very_low"
    tolerance: float  # Acceptable % difference (0.15 = 15%)
    strategies: list  # List of StrategyEstimate objects
    reasoning: str  # How target was derived
    auto_loop: bool  # Whether auto-calibration loop should run

    def to_dict(self) -> dict:
        return {
            "target": self.target,
            "confidence": self.confidence,
            "tolerance": self.tolerance,
            "auto_loop": self.auto_loop,
            "reasoning": self.reasoning,
            "strategies": [
                {
                    "name": s.name,
                    "estimate": s.estimate,
                    "confidence": s.confidence,
                    "source": s.source,
                    "reasoning": s.reasoning,
                }
                for s in self.strategies
            ],
        }

    def summary_table(self) -> str:
        """Human-readable summary for logs and PR bodies."""
        lines = [
            "Strategy          Estimate       Confidence  Source",
            "-" * 70,
        ]
        for s in self.strategies:
            est_str = f"${s.estimate / 1e6:,.1f}M" if abs(s.estimate) >= 1e6 else f"${s.estimate:,.0f}"
            lines.append(
                f"{s.name:<18}{est_str:<15}{s.confidence:<12}{s.source[:30]}"
            )
        lines.append("-" * 70)
        target_str = f"${self.target / 1e6:,.1f}M" if abs(self.target) >= 1e6 else f"${self.target:,.0f}"
        lines.append(f"Target: {target_str}  Confidence: {self.confidence}  Tolerance: +/-{self.tolerance:.0%}")
        lines.append(f"Auto-loop: {'yes' if self.auto_loop else 'no — human review needed'}")
        return "\n".join(lines)


# =============================================================================
# STRATEGY 1: FISCAL NOTE (from DB or fiscal-finder output)
# =============================================================================

def strategy_fiscal_note(fiscal_data: dict) -> Optional[StrategyEstimate]:
    """Extract fiscal note estimate if available.

    Args:
        fiscal_data: Output from fiscal-finder agent, or manual dict with:
            {"fiscal_note": {"estimate": -83600000, "source": "...", "url": "..."}}
    """
    fn = fiscal_data.get("fiscal_note")
    if not fn or fn is None:
        return None

    estimate = fn.get("estimate")
    if estimate is None:
        return None

    source = fn.get("url") or fn.get("source", "fiscal note")
    return StrategyEstimate(
        name="fiscal_note",
        estimate=float(estimate),
        confidence="high",
        source=source,
        reasoning=f"Official fiscal note from {fn.get('source', 'state fiscal office')}",
    )


# =============================================================================
# STRATEGY 2: REVENUE-BASE REASONING
# =============================================================================

def strategy_revenue_base(state: str, provisions: list) -> Optional[StrategyEstimate]:
    """Derive impact from state revenue and rate change.

    For rate changes: revenue * (rate_change / current_rate) = impact
    For bracket threshold changes: estimate affected income in bracket

    Args:
        state: Two-letter state code
        provisions: List of provision dicts from bill-researcher/param-mapper
    """
    state_upper = state.upper()
    if state_upper in NO_INCOME_TAX_STATES:
        return None

    revenue = STATE_PIT_REVENUE.get(state_upper)
    if not revenue:
        return None

    # Find rate change provisions
    total_impact = 0
    reasoning_parts = []

    for prov in provisions:
        # Look for rate changes
        current = prov.get("current_value") or prov.get("baseline")
        new = prov.get("new_value") or prov.get("reform")

        if current is None or new is None:
            continue

        # Parse numeric values
        current_val = _parse_numeric(current)
        new_val = _parse_numeric(new)
        if current_val is None or new_val is None:
            continue

        description = (prov.get("description") or prov.get("label") or "").lower()
        param_path = (prov.get("affected_parameter") or prov.get("parameter") or "").lower()

        # Rate change detection
        is_rate = (
            "rate" in description
            or "rate" in param_path
            or (0 < abs(current_val) < 1 and 0 < abs(new_val) < 1)
        )

        if is_rate and current_val > 0:
            # Rate change: revenue * (change / current_rate)
            rate_change = new_val - current_val
            pct_change = rate_change / current_val
            impact = revenue * pct_change
            total_impact += impact
            reasoning_parts.append(
                f"Rate {current_val:.4f} -> {new_val:.4f} "
                f"({rate_change:+.4f} = {pct_change:+.2%}): "
                f"${revenue/1e9:.1f}B * {pct_change:+.2%} = ${impact/1e6:,.1f}M"
            )

        # Dollar threshold / amount change (deductions, exemptions, credits)
        elif not is_rate and abs(current_val) >= 1 and abs(new_val) >= 1:
            # This is rougher — we estimate affected taxpayers from state population
            # and apply an average marginal rate
            is_credit = "credit" in description or "credit" in param_path
            if is_credit:
                # Credit: delta * estimated claimants
                # Very rough: assume 20% of households claim
                est_households = revenue / 2000  # rough proxy
                est_claimants = est_households * 0.2
                delta = new_val - current_val
                impact = delta * est_claimants
                total_impact += impact
                reasoning_parts.append(
                    f"Credit ${current_val:,.0f} -> ${new_val:,.0f}: "
                    f"~{est_claimants:,.0f} claimants * ${delta:,.0f} = ${impact/1e6:,.1f}M"
                )
            else:
                # Deduction/exemption: delta * avg marginal rate * affected filers
                # Assume ~5% avg marginal rate and 50% of filers affected
                est_filers = revenue / 3000  # rough proxy
                affected = est_filers * 0.5
                delta = new_val - current_val
                avg_marginal_rate = 0.05
                impact = delta * affected * avg_marginal_rate
                total_impact += impact
                reasoning_parts.append(
                    f"Deduction ${current_val:,.0f} -> ${new_val:,.0f}: "
                    f"~{affected:,.0f} filers * ${delta:,.0f} * {avg_marginal_rate:.1%} = ${impact/1e6:,.1f}M"
                )

    if not reasoning_parts:
        return None

    confidence = "high" if all("rate" in r.lower() for r in reasoning_parts) else "medium"

    return StrategyEstimate(
        name="revenue_base",
        estimate=total_impact,
        confidence=confidence,
        source="Census Bureau State Tax Collections",
        reasoning="; ".join(reasoning_parts),
    )


# =============================================================================
# STRATEGY 3: BACK-OF-ENVELOPE (from fiscal-finder output)
# =============================================================================

def strategy_back_of_envelope(fiscal_data: dict) -> Optional[StrategyEstimate]:
    """Use back-of-envelope calculation from fiscal-finder agent.

    Args:
        fiscal_data: Output from fiscal-finder agent with:
            {"back_of_envelope": {"result": -66800000, "calculation": "..."}}
    """
    boe = fiscal_data.get("back_of_envelope")
    if not boe:
        return None

    result = boe.get("result")
    if result is None:
        return None

    return StrategyEstimate(
        name="back_of_envelope",
        estimate=float(result),
        confidence="medium-low",
        source="manual calculation",
        reasoning=boe.get("calculation", "Back-of-envelope estimate"),
    )


# =============================================================================
# STRATEGY 4: TAX EXPENDITURE REPORT
# =============================================================================

def strategy_tax_expenditure(fiscal_data: dict) -> Optional[StrategyEstimate]:
    """Use tax expenditure report data for scaling.

    The fiscal-finder agent may include tax expenditure references in
    external_analyses. This strategy looks for them and scales appropriately.

    Args:
        fiscal_data: Output from fiscal-finder agent
    """
    analyses = fiscal_data.get("external_analyses", [])
    for analysis in analyses:
        source_lower = (analysis.get("source") or "").lower()
        notes_lower = (analysis.get("notes") or "").lower()

        if "tax expenditure" in source_lower or "tax expenditure" in notes_lower:
            estimate = analysis.get("estimate")
            if estimate is not None:
                return StrategyEstimate(
                    name="tax_expenditure",
                    estimate=float(estimate),
                    confidence="medium",
                    source=analysis.get("url") or analysis.get("source", "tax expenditure report"),
                    reasoning=f"From tax expenditure report: {analysis.get('notes', '')}",
                )
    return None


# =============================================================================
# STRATEGY 5: SIMILAR BILLS
# =============================================================================

def strategy_similar_bills(fiscal_data: dict) -> Optional[StrategyEstimate]:
    """Use similar/companion bill estimates, scaled if from different state.

    The fiscal-finder agent may include similar bill analyses.

    Args:
        fiscal_data: Output from fiscal-finder agent
    """
    analyses = fiscal_data.get("external_analyses", [])
    for analysis in analyses:
        source_lower = (analysis.get("source") or "").lower()
        notes_lower = (analysis.get("notes") or "").lower()

        is_similar = any(kw in source_lower or kw in notes_lower for kw in [
            "similar bill", "companion", "predecessor", "prior session", "analogous",
        ])

        if is_similar:
            estimate = analysis.get("estimate")
            if estimate is not None:
                return StrategyEstimate(
                    name="similar_bill",
                    estimate=float(estimate),
                    confidence="medium",
                    source=analysis.get("url") or analysis.get("source", "similar bill"),
                    reasoning=f"From similar bill: {analysis.get('notes', '')}",
                )
    return None


# =============================================================================
# STRATEGY 6: CONSENSUS RANGE (from fiscal-finder)
# =============================================================================

def strategy_consensus_range(fiscal_data: dict) -> Optional[StrategyEstimate]:
    """Use the fiscal-finder's own consensus range if computed.

    Args:
        fiscal_data: Output from fiscal-finder agent with:
            {"consensus_range": {"midpoint": -82500000, "low": -80000000, "high": -85000000}}
    """
    cr = fiscal_data.get("consensus_range")
    if not cr:
        return None

    midpoint = cr.get("midpoint")
    if midpoint is None:
        return None

    return StrategyEstimate(
        name="consensus_range",
        estimate=float(midpoint),
        confidence="medium",
        source="fiscal-finder consensus",
        reasoning=f"Consensus range: ${cr.get('low', 0)/1e6:.1f}M to ${cr.get('high', 0)/1e6:.1f}M",
    )


# =============================================================================
# TRIANGULATION
# =============================================================================

TOLERANCE_TABLE = {
    "high": 0.15,       # Fiscal note exists
    "medium": 0.25,     # Multiple strategies agree
    "low": 0.40,        # Weak agreement
    "very_low": 0.50,   # Single strategy or wide spread — flag for human
}


def load_corrections() -> dict:
    """Load harness correction factors from past calibrations.

    These are generated by `analyze_residuals.py --update-corrections` after
    multiple bills have been calibrated. They encode learned biases like
    "revenue-base reasoning overestimates by 9%" or "GA PE income base is
    20% higher than state projections."

    Returns:
        {
            "strategy_corrections": {"revenue_base": {"factor": 0.91, ...}},
            "state_bias_corrections": {"MD": {"avg_residual": -0.15, ...}},
        }
    """
    corrections_path = Path(__file__).parent.parent / "results" / "harness_corrections.json"
    if not corrections_path.exists():
        return {}
    try:
        with open(corrections_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def apply_corrections(strategies: list[StrategyEstimate], state: str) -> list[StrategyEstimate]:
    """Apply learned correction factors to strategy estimates.

    For each non-fiscal-note strategy, check if we have a correction factor
    from past calibrations (e.g., revenue-base consistently overestimates by 9%).
    If so, multiply the estimate by the correction factor.
    """
    corrections = load_corrections()
    strategy_corrections = corrections.get("strategy_corrections", {})

    if not strategy_corrections:
        return strategies

    corrected = []
    for s in strategies:
        if s.name == "fiscal_note":
            corrected.append(s)
            continue

        correction = strategy_corrections.get(s.name)
        if correction and correction.get("factor"):
            factor = correction["factor"]
            original = s.estimate
            adjusted = original * factor
            corrected.append(StrategyEstimate(
                name=s.name,
                estimate=adjusted,
                confidence=s.confidence,
                source=s.source,
                reasoning=f"{s.reasoning} [corrected ×{factor:.3f} from {original/1e6:,.1f}M]",
            ))
        else:
            corrected.append(s)

    return corrected


def triangulate(strategies: list[StrategyEstimate], state: str = "") -> HarnessResult:
    """Combine strategy estimates into a single target with confidence band.

    Rules:
    - If fiscal note exists, it anchors the target (other strategies are cross-checks)
    - Otherwise, use weighted median of available strategies
    - Confidence based on agreement spread and source quality
    - Tolerance band widens with lower confidence
    """
    if not strategies:
        return HarnessResult(
            target=0,
            confidence="very_low",
            tolerance=TOLERANCE_TABLE["very_low"],
            strategies=[],
            reasoning="No strategies produced estimates",
            auto_loop=False,
        )

    # If fiscal note exists, it anchors
    fiscal = next((s for s in strategies if s.name == "fiscal_note"), None)
    non_fiscal = [s for s in strategies if s.name != "fiscal_note"]

    if fiscal:
        target = fiscal.estimate

        if non_fiscal:
            # Cross-check: how close are other strategies?
            diffs = [abs(s.estimate - target) / abs(target) if target != 0 else 0 for s in non_fiscal]
            avg_diff = sum(diffs) / len(diffs)
            cross_check_note = f"Cross-check avg diff: {avg_diff:.0%}"
        else:
            cross_check_note = "No cross-checks available"

        return HarnessResult(
            target=target,
            confidence="high",
            tolerance=TOLERANCE_TABLE["high"],
            strategies=strategies,
            reasoning=f"Anchored on fiscal note ({fiscal.source}). {cross_check_note}",
            auto_loop=True,
        )

    # No fiscal note — triangulate from remaining strategies
    estimates = [s.estimate for s in strategies]
    weights = [s.weight for s in strategies]

    # Weighted median (approximate: use weighted average for simplicity)
    total_weight = sum(weights)
    target = sum(e * w for e, w in zip(estimates, weights)) / total_weight

    # Measure agreement: coefficient of variation
    if len(estimates) >= 2 and target != 0:
        spread = max(abs(e) for e in estimates) / min(abs(e) for e in estimates) if min(abs(e) for e in estimates) > 0 else float("inf")
    else:
        spread = float("inf")

    # Determine confidence from number of strategies and agreement
    if len(strategies) >= 3 and spread < 1.3:
        confidence = "medium"
        reasoning = f"{len(strategies)} strategies agree within {spread:.1f}x spread"
    elif len(strategies) >= 2 and spread < 2.0:
        confidence = "low"
        reasoning = f"{len(strategies)} strategies with {spread:.1f}x spread"
    elif len(strategies) >= 2 and spread >= 2.0:
        confidence = "very_low"
        reasoning = f"{len(strategies)} strategies but {spread:.1f}x spread — wide disagreement"
    elif len(strategies) == 1:
        # Single non-fiscal strategy
        s = strategies[0]
        if s.confidence in ("high", "medium"):
            confidence = "low"
        else:
            confidence = "very_low"
        reasoning = f"Single strategy ({s.name}, {s.confidence} confidence)"
    else:
        confidence = "very_low"
        reasoning = "Insufficient data"

    tolerance = TOLERANCE_TABLE[confidence]
    auto_loop = confidence != "very_low"

    return HarnessResult(
        target=target,
        confidence=confidence,
        tolerance=tolerance,
        strategies=strategies,
        reasoning=reasoning,
        auto_loop=auto_loop,
    )


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def build_target(
    reform_id: str,
    state: str,
    provisions: list,
    reform_params: dict,
    fiscal_data: Optional[dict] = None,
) -> HarnessResult:
    """Run all applicable strategies and triangulate into a target.

    This is the main entry point. Call this from auto_calibrate.py.

    Args:
        reform_id: Bill identifier (e.g., "ga-hb168")
        state: Two-letter state code
        provisions: List of provision dicts (from bill-researcher or reform_impacts.provisions)
        reform_params: The reform JSON (for context, not modified)
        fiscal_data: Output from fiscal-finder agent (optional but recommended).
            Expected shape:
            {
                "fiscal_note": {"estimate": -50000000, "source": "...", "url": "..."},
                "external_analyses": [...],
                "back_of_envelope": {"result": -45000000, "calculation": "..."},
                "consensus_range": {"low": ..., "high": ..., "midpoint": ...}
            }

    Returns:
        HarnessResult with target estimate, confidence, tolerance, and strategy breakdown
    """
    if fiscal_data is None:
        fiscal_data = {}

    strategies = []

    # Run all strategies, collect non-None results
    s1 = strategy_fiscal_note(fiscal_data)
    if s1:
        strategies.append(s1)

    s2 = strategy_revenue_base(state, provisions)
    if s2:
        strategies.append(s2)

    s3 = strategy_back_of_envelope(fiscal_data)
    if s3:
        strategies.append(s3)

    s4 = strategy_tax_expenditure(fiscal_data)
    if s4:
        strategies.append(s4)

    s5 = strategy_similar_bills(fiscal_data)
    if s5:
        strategies.append(s5)

    # Only use consensus_range if we don't have individual strategies
    # (it's a derivative, not independent)
    if len(strategies) < 2:
        s6 = strategy_consensus_range(fiscal_data)
        if s6:
            strategies.append(s6)

    # Apply learned correction factors from past calibrations
    strategies = apply_corrections(strategies, state)

    return triangulate(strategies, state=state)


# =============================================================================
# UTILITIES
# =============================================================================

def _parse_numeric(value) -> Optional[float]:
    """Parse a numeric value from various formats."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        # Remove $, commas, %, whitespace
        cleaned = re.sub(r"[$,%\s]", "", value)
        try:
            val = float(cleaned)
            # If original had %, convert to decimal
            if "%" in str(value):
                val = val / 100
            return val
        except ValueError:
            return None
    return None


def load_fiscal_data_from_db(reform_id: str) -> dict:
    """Load fiscal data from the validation_metadata table if available.

    Returns dict in the shape expected by build_target().
    """
    try:
        from supabase import create_client
    except ImportError:
        return {}

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        return {}

    supabase = create_client(url, key)

    result = supabase.table("validation_metadata").select("*").eq("id", reform_id).execute()
    if not result.data:
        return {}

    row = result.data[0]
    fiscal_data = {}

    if row.get("fiscal_note_estimate"):
        fiscal_data["fiscal_note"] = {
            "estimate": row["fiscal_note_estimate"],
            "source": row.get("fiscal_note_source", ""),
            "url": row.get("fiscal_note_url", ""),
        }

    if row.get("external_analyses"):
        fiscal_data["external_analyses"] = row["external_analyses"]

    if row.get("envelope_estimate"):
        fiscal_data["back_of_envelope"] = {
            "result": row["envelope_estimate"],
            "calculation": row.get("envelope_methodology", ""),
        }

    return fiscal_data


def load_provisions_from_db(reform_id: str) -> list:
    """Load provisions from reform_impacts table."""
    try:
        from supabase import create_client
    except ImportError:
        return []

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        return []

    supabase = create_client(url, key)

    result = supabase.table("reform_impacts").select("provisions").eq("id", reform_id).execute()
    if not result.data:
        return []

    provisions = result.data[0].get("provisions")
    if isinstance(provisions, str):
        try:
            provisions = json.loads(provisions)
        except json.JSONDecodeError:
            return []

    return provisions or []
