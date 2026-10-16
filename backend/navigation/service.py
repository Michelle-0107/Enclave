"""Validate the pilot and normalize real engine maneuvers without inventing turns."""

from datetime import datetime,timezone
import math
from uuid import uuid4

from pydantic import ValidationError

from .config import EXTRACT_BBOX,MAX_SNAP_METERS,in_bounds
from .contracts import Maneuver,RouteGeometry,RouteResponse
from .provider import NavigationRejected,NavigationUnavailable,decode_polyline6
from .zones import point_in_zone,route_intersects_zone


def distance_meters(a,b):
    lon1,lat1,lon2,lat2=map(math.radians,(*a,*b))
    value=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6_371_008.8*2*math.asin(min(1,math.sqrt(value)))


def number(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
        raise ValueError('Invalid provider number')
    return value


def integer(value):
    if type(value) is not int:
        raise ValueError('Invalid provider index')
    return value


class NavigationService:
    def __init__(self,provider,obstacles=None,accessibility=None):
        self.provider=provider
        self.obstacles=obstacles
        self.accessibility=accessibility

    async def route(self,body,actor_id=None):
        self.validate_locations(body)
        snapshot=None
        if body.route_mode!='shortest':
            if self.obstacles is None or actor_id is None:
                raise NavigationUnavailable()
            snapshot=await self.obstacles.active(actor_id)
        return await self.route_with_snapshot(body,snapshot)

    @staticmethod
    def validate_locations(body):
        origin=(body.origin.longitude,body.origin.latitude)
        destination=(body.destination.longitude,body.destination.latitude)
        if not in_bounds(*origin) or not in_bounds(*destination):
            raise NavigationRejected(422,'Origin and destination must be inside the KL East pilot window')
        if distance_meters(origin,destination)<5:
            raise NavigationRejected(422,'Choose locations at least 5 meters apart')

    async def route_with_snapshot(self,body,snapshot=None):
        """Internal reuse with a trusted frozen snapshot; never exposed as request data."""
        self.validate_locations(body)
        origin=(body.origin.longitude,body.origin.latitude)
        destination=(body.destination.longitude,body.destination.latitude)
        boxes=[]
        if body.route_mode!='shortest':
            if snapshot is None:
                raise NavigationUnavailable()
            for item in snapshot.items:
                ring=item.exclusion_ring
                bounds=(ring[0][0],ring[0][1],ring[2][0],ring[2][1])
                if point_in_zone(origin,bounds) or point_in_zone(destination,bounds):
                    raise NavigationRejected(409,'Origin or destination is inside a community-reported damaged area; choose another point')
                boxes.append(bounds)
        if body.route_mode=='accessible':
            if self.accessibility is None: raise NavigationUnavailable()
            return self.accessibility.route(body,snapshot,boxes)
        polygons=[item.exclusion_ring for item in snapshot.items] if snapshot else []
        data=await self.provider.route(body,exclude_polygons=polygons)
        try:
            trip=data['trip']
            if (integer(trip['status']) != 0 or trip['units'] != 'kilometers' or trip['language'] != 'en-US'
                or len(trip['legs']) != 1):
                raise ValueError('Invalid directions response')
            leg=trip['legs'][0]
            coordinates=decode_polyline6(leg['shape'])
            if any(not in_bounds(*point,EXTRACT_BBOX) for point in coordinates):
                raise ValueError('Route outside data window')
            origin_snap=distance_meters(origin,coordinates[0])
            destination_snap=distance_meters(destination,coordinates[-1])
            if max(origin_snap,destination_snap)>MAX_SNAP_METERS:
                raise NavigationRejected(422,'A location is too far from a mapped walking path')
            if any(route_intersects_zone([origin,*coordinates,destination],bounds) for bounds in boxes):
                raise NavigationRejected(422,'No walking route avoiding all community-reported damaged areas is available')
            cumulative=[0.0]
            for a,b in zip(coordinates,coordinates[1:]):
                cumulative.append(cumulative[-1]+distance_meters(a,b))
            total_distance=number(leg['summary']['length'])*1000
            duration=number(leg['summary']['time'])
            if total_distance<=0 or abs(total_distance-cumulative[-1])>max(25,total_distance*0.15):
                raise ValueError('Inconsistent route distance')
            maneuvers=[]
            raw_steps=leg['maneuvers']
            if not isinstance(raw_steps,list) or not 2<=len(raw_steps)<=2000:
                raise ValueError('Missing directions')
            for index,step in enumerate(raw_steps):
                begin,end=integer(step['begin_shape_index']),integer(step['end_shape_index'])
                if (not 0<=begin<=end<len(coordinates) or
                    (index and begin != maneuvers[-1].end_shape_index)):
                    raise ValueError('Invalid maneuver order')
                instruction=step['instruction']
                spoken=step.get('verbal_pre_transition_instruction') or instruction
                maneuvers.append(Maneuver(index=index,type=integer(step['type']),instruction=instruction,
                    spoken_instruction=spoken,distance_meters=number(step['length'])*1000,
                    duration_seconds=number(step['time']),begin_shape_index=begin,end_shape_index=end,
                    distance_from_start_meters=cumulative[begin],coordinate=coordinates[begin]))
            if (maneuvers[0].begin_shape_index != 0 or maneuvers[-1].end_shape_index != len(coordinates)-1
                or maneuvers[0].type not in (1,2,3) or maneuvers[-1].type not in (4,5,6)
                or abs(sum(s.distance_meters for s in maneuvers)-total_distance)>max(10,total_distance*0.05)
                or abs(sum(s.duration_seconds for s in maneuvers)-duration)>max(5,duration*0.05)):
                raise ValueError('Incomplete maneuvers')
            return RouteResponse(route_id=uuid4(),generated_at=datetime.now(timezone.utc),route_mode=body.route_mode,
                geometry=RouteGeometry(coordinates=coordinates),distance_meters=total_distance,
                duration_seconds=duration,origin_snap_distance_meters=origin_snap,
                destination_snap_distance_meters=destination_snap,maneuvers=maneuvers,
                data_source=self.provider.settings.source,
                community_issue_avoidance=('applied' if boxes else 'no_active_obstacles') if snapshot else 'not_applied',
                obstacle_snapshot_at=snapshot.checked_at if snapshot else None,obstacle_count=len(boxes),warnings=[
                    ('Open road-facility issues reported by at least two distinct verified residents were checked; refresh when conditions change.'
                     if snapshot else 'Community issue reports have not been applied as route restrictions.'),
                    'Public map paths and access conditions have not been field verified.'],
                obstacle_source='community_reports' if snapshot else None)
        except NavigationRejected:
            raise
        except (ValueError,TypeError,KeyError,IndexError,OverflowError,ValidationError):
            raise NavigationUnavailable() from None
