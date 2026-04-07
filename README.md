# ASW Helo Hunt

A small standalone browser game where you fly an ASW helicopter, deploy active sonobuoys, and build a firing-quality submarine datum from overlapping range returns.

The default mission is tuned as a training hunt rather than a brutal sim sandbox, so the box is compact enough and the buoy geometry forgiving enough to let you learn the triangulation loop.

## Run

Open `index.html` in a browser.

## Controls

- `W` / `S`: speed up or slow down
- `A` / `D`: turn left or right
- `Space`: drop a buoy
- `Enter`: declare the current contact solution
- `R`: restart the hunt

## Gameplay notes

- Buoys only appear on the sonar/PPI display when your helicopter is close enough to datalink with them.
- Each buoy pings automatically and, if the submarine is inside its active basket, generates a noisy range ring.
- Two recent returns can produce a rough estimate. Three or more with good geometry tighten the solution.
- Declaring the contact succeeds only if your estimated datum is close enough to the submarine's actual position.
