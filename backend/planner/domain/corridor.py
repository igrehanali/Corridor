"""Regular lat/lon lattice covering a buffer around the candidate routes.

The heatmap is sampled on this lattice. Because it is a regular grid, the
frontend can draw it as one tiny raster image (one pixel per cell) and let the
GPU interpolate between cells; scrubbing the time slider only rewrites that
image instead of re-projecting hundreds of map features.

Cells are anchored to global multiples of ``step`` so overlapping requests
share cells and hit the weather cache.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from .geo import LatLon, cumulative_miles, resample

MILES_PER_DEG_LAT = 69.0
STEPS_DEG = (0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0)


@dataclass(frozen=True, slots=True)
class CorridorGrid:
    step: float
    ix0: int  # global lattice index of column 0 (west)
    iy0: int  # global lattice index of row 0 (south)
    nx: int
    ny: int
    cells: tuple[tuple[int, int], ...]  # (col, row) relative to ix0/iy0, row 0 = south

    def center(self, cell: tuple[int, int]) -> LatLon:
        col, row = cell
        return (round((self.iy0 + row) * self.step, 4), round((self.ix0 + col) * self.step, 4))

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """[west, south, east, north] of the raster, cell edges included."""
        h = self.step / 2
        return (
            round(self.ix0 * self.step - h, 4),
            round(self.iy0 * self.step - h, 4),
            round((self.ix0 + self.nx - 1) * self.step + h, 4),
            round((self.iy0 + self.ny - 1) * self.step + h, 4),
        )


def _cells_for(lines: Sequence[Sequence[LatLon]], step: float, buffer_mi: float) -> set[tuple[int, int]]:
    cells: set[tuple[int, int]] = set()
    sample_mi = max(2.0, step * MILES_PER_DEG_LAT / 2)
    ry = math.ceil(buffer_mi / (step * MILES_PER_DEG_LAT)) + 1
    for line in lines:
        cum = cumulative_miles(line)
        for lat, lon in resample(line, cum, sample_mi):
            mi_per_deg_lon = MILES_PER_DEG_LAT * max(0.05, math.cos(math.radians(lat)))
            rx = math.ceil(buffer_mi / (step * mi_per_deg_lon)) + 1
            cy, cx = round(lat / step), round(lon / step)
            for iy in range(cy - ry, cy + ry + 1):
                dy = (iy * step - lat) * MILES_PER_DEG_LAT
                if abs(dy) > buffer_mi:
                    continue
                for ix in range(cx - rx, cx + rx + 1):
                    if (ix, iy) in cells:
                        continue
                    dx = (ix * step - lon) * mi_per_deg_lon
                    if dx * dx + dy * dy <= buffer_mi * buffer_mi:
                        cells.add((ix, iy))
    return cells


def _fill_holes(cells: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Add lattice cells fully enclosed by the corridor (e.g. between two routes).

    Flood-fills the empty space from the bounding box border; any empty cell the
    flood cannot reach is a hole and becomes part of the corridor, so the
    heatmap reads as one continuous field instead of a ring with gaps.
    """
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
    outside: set[tuple[int, int]] = set()
    stack = [(x0, y0)]
    while stack:
        x, y = stack.pop()
        if (x, y) in outside or (x, y) in cells or not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        outside.add((x, y))
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    filled = set(cells)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if (x, y) not in outside:
                filled.add((x, y))
    return filled


def build_corridor_grid(
    lines: Sequence[Sequence[LatLon]], buffer_mi: float = 35.0, max_cells: int = 200
) -> CorridorGrid:
    """Finest lattice whose corridor fits within ``max_cells`` weather lookups."""
    cells: set[tuple[int, int]] = set()
    chosen = STEPS_DEG[-1]
    for step in STEPS_DEG:
        cells = _fill_holes(_cells_for(lines, step, buffer_mi))
        chosen = step
        if len(cells) <= max_cells:
            break
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    ix0, iy0 = min(xs), min(ys)
    rel = tuple(sorted(((x - ix0, y - iy0) for x, y in cells), key=lambda c: (c[1], c[0])))
    return CorridorGrid(
        step=chosen,
        ix0=ix0,
        iy0=iy0,
        nx=max(xs) - ix0 + 1,
        ny=max(ys) - iy0 + 1,
        cells=rel,
    )
