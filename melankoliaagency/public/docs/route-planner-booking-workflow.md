# Melankolia Route Planner — Booking Workflow Research Notes

Date: 2026-06-27

## Core research finding

A route planner should not imply that AI can simply “make a tour happen.” Real touring unfolds as a booking pipeline: initial routing idea → market list → anchor dates / holds → outreach → offers → negotiation → deal made → confirmed → advancing → show day → settlement.

Tour routing, booking, and advancing are related but distinct:

- **Routing** decides how dates/cities fit together in a workable sequence.
- **Booking** secures buyers, dates, venues, rates, holds, and confirmed deals.
- **Advancing** turns confirmed dates into operational show days: load-in, backline, hospitality, settlement, contacts, schedules, parking, merch, and local logistics.

The planner should treat every stop as a living booking/deal record, not just a map pin.

## Sources reviewed

- Eventric / MasterTour: emphasizes that routing is more than city order; real constraints include drive time, show spacing, recovery, costs, fatigue, and revisiting decisions as dates confirm.
- Ari’s Take advancing guide: confirms that advancing happens after confirmation and requires one final detail email/checklist before show day.
- ASCAP booking-your-own-tour guidance: recommends tracking held dates and city names while booking evolves.
- Toursmart product positioning: AI route generation, venue map, daily plans, export; opportunity is deeper genre-specific agency workflow and actual deal-state tracking.
- Search results on booking-agent workflow: holds are tied to routing decisions, deadlines, buyer history, radius/context, guarantees vs. door deals, and confirmation status.

## Product implications for Melankolia

### 1. Route generation should create a draft booking pipeline

Each generated stop should include:

- city / country / date
- candidate venue(s)
- booking status: prospect, contacted, hold, offer, negotiating, deal_made, confirmed, advanced, settled, passed
- deal status: not_started, offer_needed, offer_sent, countered, deal_made, contract_sent, confirmed, settled
- locked/confirmed flag
- target rate, offered rate, confirmed rate
- hold deadline
- contact status
- next action
- internal notes
- advancing notes

### 2. Established route options should be first-class inputs

The builder must allow already-established or partially established route pieces:

`City | Date | Venue | Deal | Status`

Examples:

- `Berlin | 2026-10-16 | Urban Spree | €800 guarantee | hold`
- `Amsterdam | 2026-10-18 | OCCII | 70/30 door after costs | offer`
- `Paris | 2026-10-22 | Petit Bain | €1000 guarantee | confirmed`

### 3. Venue Finder should be wrapped into stop-level research

For each stop, the planner should expose two venue actions:

- Fast AI venue suggestions for quick ideation.
- Grounded Venue Finder for verified venue data: capacity, booking method, website, email/form/Instagram, fit reason, confidence, and verification sources.

### 4. Stop detail is the operational center

The main route list should be clickable. Clicking a stop should show:

- venue info
- candidate venues
- rate target / offer / confirmed rate
- hold deadline
- booking/deal status
- locked confirmation state
- next action
- notes
- email generation
- deal advisor
- Venue Finder research

### 5. Save route should feed Advancing

Once a route has meaningful confirmed/deal-made stops, saving creates show records. Advancing then takes over for promoter sheets, approval, publishing to band app, and show-day logistics.

## Current implementation checkpoint

Implemented in `route-pipeline-v1`:

- `ai-tour.js` now uses fast Gemini route model with a JSON timeout guard so frontend no longer receives Netlify HTML timeout pages.
- Generated legs include booking/deal pipeline fields.
- Builder input renamed to “Established Holds / Confirmed Anchors.”
- Each route leg is clickable and opens Stop Detail.
- Stop Detail supports editable booking status, deal status, venue, hold deadline, target/offer/confirmed rates, locked flag, next action, and notes.
- Per-stop buttons include Details, Grounded Venue Finder, Fast Venues, Email, and Deal.
- Grounded Venue Finder calls the existing `geminiSearch` venue pipeline and attaches candidate venues to the stop.
