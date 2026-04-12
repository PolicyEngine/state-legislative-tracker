# Unified Bill Tracker Direction

## Goal

Move from a `2026 state legislative session tracker` to a broader `tax and transfer bill tracker` that:

- keeps `state` browsing as the main user experience for state legislation
- adds `federal` as a first-class destination instead of a special case
- supports multiple sessions instead of centering the product on one year
- keeps the existing scoring, encoding, and microsimulation workflow

## What Is Coupled Today

### Product framing

- [README.md](/Users/pavelmakarchuk/state-research-tracker/README.md) originally framed the app as a state legislative tracker
- [src/App.jsx](/Users/pavelmakarchuk/state-research-tracker/src/App.jsx) was hard-coded around `2026 State Legislative Tracker` and state-session language

### Routing

- [src/App.jsx](/Users/pavelmakarchuk/state-research-tracker/src/App.jsx) originally only understood:
  - `/`
  - `/:state`
  - `/:state/:billId`
- that makes `state` the only valid top-level destination

### Static state/session backbone

- [src/data/states.js](/Users/pavelmakarchuk/state-research-tracker/src/data/states.js) still carries important display metadata
- the problem is not that it exists; the problem is when it doubles as the application structure

### Content model

- [src/components/StatePanel.jsx](/Users/pavelmakarchuk/state-research-tracker/src/components/StatePanel.jsx) is correctly state-first, but federal content only appears as an attachment to states
- [src/context/DataContext.jsx](/Users/pavelmakarchuk/state-research-tracker/src/context/DataContext.jsx) still treats federal research as a special-case fake-state model

### Pipeline assumptions

- [scripts/openstates_monitor.py](/Users/pavelmakarchuk/state-research-tracker/scripts/openstates_monitor.py) and [scripts/refresh_bill_status.py](/Users/pavelmakarchuk/state-research-tracker/scripts/refresh_bill_status.py) are state/OpenStates-specific
- federal ingestion will need a second source, but it should plug into the same downstream bill pipeline

## Product Direction

The right structure is:

- state-first UX
- federal as a peer surface
- jurisdiction-first data model underneath

That means:

- the homepage still starts with states
- the map remains useful for state legislation
- federal gets its own page and navigation affordance
- sessions remain visible and useful, but they stop being the product backbone

## Recommended UI Shape

### Keep these

- homepage map and state search
- state pages as the primary state workflow
- state bill detail pages

### Add these

- `/federal` as a first-class route
- a federal page using the same research and bill pipeline concepts
- search and breadcrumbs that understand both state and federal destinations

### Add later if it proves useful

- shared bill detail routes independent of state/federal
- session views such as `2026 session` or `119th Congress`
- a generic bill index across jurisdictions

## Data Model Direction

The schema should move toward explicit jurisdiction fields.

For `processed_bills` and `research`, prefer:

- `jurisdiction_type`
- `jurisdiction_code`
- `jurisdiction_name`
- `session_name`

Keep `session` and `year` separate:

- `session_name` is the primary legislative unit
- `activity_year` is a secondary filter derived from bill and research dates
- `effective_year` or `tax_year` should remain separate policy metadata

Keep `state` temporarily for compatibility if needed, but stop relying on:

- `state = "all"` as the main federal representation
- `relevant_states` as the main way to model federal content

`relevant_states` is still useful, but as targeting metadata rather than the core federal identity.

## Refactor Sequence

### Phase 1

- update product copy
- add a federal destination in the UI
- keep state pages and the map intact

### Phase 2

- introduce jurisdiction-aware schema fields
- backfill state rows
- define a federal ingestion source abstraction

### Phase 3

- reduce [src/data/states.js](/Users/pavelmakarchuk/state-research-tracker/src/data/states.js) to display metadata
- move session and jurisdiction truth into data-driven structures

### Phase 4

- add shared bill/session views if user behavior shows they are valuable

## Prototype On This Branch

This branch now reflects the first architectural step:

- [src/App.jsx](/Users/pavelmakarchuk/state-research-tracker/src/App.jsx) supports a first-class `/federal` route
- [src/components/FederalPanel.jsx](/Users/pavelmakarchuk/state-research-tracker/src/components/FederalPanel.jsx) provides a federal workspace
- [src/components/StateSearchCombobox.jsx](/Users/pavelmakarchuk/state-research-tracker/src/components/StateSearchCombobox.jsx) can navigate to either a state or federal
- [src/context/DataContext.jsx](/Users/pavelmakarchuk/state-research-tracker/src/context/DataContext.jsx) now exposes federal bill/research helpers alongside state helpers

This is the right test. It changes the product structure without discarding the state-centric workflow that users actually want.
