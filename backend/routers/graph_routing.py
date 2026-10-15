from fastapi import APIRouter
from pydantic import BaseModel
from services.graph_routing_service import compute_path_by_coordinates

router = APIRouter(prefix="/api/routes", tags=["Routing"])

class LatLngRouteRequest(BaseModel):
    start_lng: float
    start_lat: float
    end_lng: float
    end_lat: float

@router.post("/compare")
def calculate_route(request: LatLngRouteRequest):
    """receive the latitude and longitude from the frontend MapLibre and calculate the route"""
    return compute_path_by_coordinates(
        request.start_lng, 
        request.start_lat, 
        request.end_lng, 
        request.end_lat
    )