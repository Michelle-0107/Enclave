"""Small management-confirmed exclusion squares in geographic coordinates."""

import math

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
