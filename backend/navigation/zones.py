"""Small management-confirmed exclusion squares in geographic coordinates."""

import math
from collections import defaultdict

from .config import PILOT_BBOX, in_bounds

MAX_OBSTACLES = 100


def zone_bounds(latitude, longitude, half_width_meters):
    """half_width_meters is half the square's side, not a circular radius."""
    dy = half_width_meters / 111_195.08
    dx = dy / math.cos(math.radians(latitude))
    return longitude-dx, latitude-dy, longitude+dx, latitude+dy


def zone_ring(bounds):
    w, s, e, n = bounds
    return [(w,s),(e,s),(e,n),(w,n),(w,s)]


def valid_zone(latitude, longitude, half_width_meters):
    bounds = zone_bounds(latitude, longitude, half_width_meters)
    return in_bounds(bounds[0],bounds[1],PILOT_BBOX) and in_bounds(bounds[2],bounds[3],PILOT_BBOX)


def point_in_zone(point, bounds):
    w,s,e,n = bounds
    return w-1e-10 <= point[0] <= e+1e-10 and s-1e-10 <= point[1] <= n+1e-10


def segment_intersects_zone(a, b, bounds):
    """Closed rectangle clipping, including tangency and zero-length segments."""
    w,s,e,n = bounds
    w,s,e,n = w-1e-10,s-1e-10,e+1e-10,n+1e-10
    dx,dy = b[0]-a[0],b[1]-a[1]
    low,high = 0.0,1.0
    for p,q in ((-dx,a[0]-w),(dx,e-a[0]),(-dy,a[1]-s),(dy,n-a[1])):
        if abs(p) < 1e-15:
            if q < 0:
                return False
        else:
            ratio = q/p
            if p < 0:
                low = max(low,ratio)
            else:
                high = min(high,ratio)
            if low > high:
                return False
    return True


def route_intersects_zone(coordinates, bounds):
    return any(segment_intersects_zone(a,b,bounds) for a,b in zip(coordinates,coordinates[1:]))


class BoundsIndex:
    """Conservative candidate lookup; exact geometry checks still decide exclusion."""

    CELL_SIZE = 0.0005
    MAX_CELLS = 256

    def __init__(self, bounds):
        self.bounds = tuple(bounds)
        self.grid = defaultdict(set)
        self.large = set()
        for i, box in enumerate(self.bounds):
            cells = self._cells(box)
            if cells is None:
                self.large.add(i)
            else:
                for cell in cells:
                    self.grid[cell].add(i)

    @classmethod
    def _cells(cls, bounds):
        w, s, e, n = bounds
        west, south = math.floor((w-1e-10)/cls.CELL_SIZE), math.floor((s-1e-10)/cls.CELL_SIZE)
        east, north = math.floor((e+1e-10)/cls.CELL_SIZE), math.floor((n+1e-10)/cls.CELL_SIZE)
        if (east-west+1)*(north-south+1) > cls.MAX_CELLS:
            return None
        return ((x, y) for x in range(west, east+1) for y in range(south, north+1))

    def candidates(self, a, b):
        if not self.bounds:
            return ()
        w, s, e, n = min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])
        cells = self._cells((w, s, e, n))
        if cells is None:
            indices = range(len(self.bounds))
        else:
            indices = self.large.copy()
            for cell in cells:
                indices.update(self.grid.get(cell, ()))
            indices = sorted(indices)
        return (i for i in indices if self.bounds[i][0]-1e-10 <= e and self.bounds[i][2]+1e-10 >= w
                and self.bounds[i][1]-1e-10 <= n and self.bounds[i][3]+1e-10 >= s)

    def intersects(self, a, b):
        return any(segment_intersects_zone(a, b, self.bounds[i]) for i in self.candidates(a, b))
