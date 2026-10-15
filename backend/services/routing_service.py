import os
import networkx as nx
from fastapi import HTTPException
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def create_community_graph_from_db() -> nx.Graph:
    """from Supabase dynamically load the community road network graph"""
    G = nx.Graph()
    
    nodes_res = supabase.table("community_nodes").select("*").execute()
    for row in nodes_res.data:
        G.add_node(
            row["node_id"], 
            lat=row["lat"], 
            lng=row["lng"], 
            name=row["name"]
        )

    edges_res = supabase.table("community_edges").select("*").execute()
    for row in edges_res.data:
        G.add_edge(
            row["u"], 
            row["v"], 
            weight=row["weight"], 
            edge_id=row["edge_id"]
        )
        
    return G

def find_nearest_node(G: nx.Graph, target_lat: float, target_lng: float) -> str:
    """auxiliary function: find the nearest node ID in the graph based on the latitude and longitude provided by the frontend"""
    nearest_node = None
    min_distance = float('inf')
    
    for node_id, data in G.nodes(data=True):
        node_lat = data["lat"]
        node_lng = data["lng"]
        
        # use simple Euclidean or Manhattan distance for estimation (sufficiently accurate if within the same small community)
        # or use the more accurate haversine formula to calculate the great-circle distance between two points
        distance = ((node_lat - target_lat) ** 2 + (node_lng - target_lng) ** 2) ** 0.5
        
        if distance < min_distance:
            min_distance = distance
            nearest_node = node_id
            
    return nearest_node

def compute_path_by_coordinates(start_lng: float, start_lat: float, end_lng: float, end_lat: float):
    """receive the latitude and longitude from the frontend, automatically match the nearest intersection, and use NetworkX to calculate the route"""
    G = create_community_graph_from_db()
    
    # 1. automatically map the latitude and longitude from the frontend to the nearest node in the graph
    start_node = find_nearest_node(G, start_lat, start_lng)
    end_node = find_nearest_node(G, end_lat, end_lng)
    
    if not start_node or not end_node:
        raise HTTPException(status_code=404, detail="无法在路网中匹配到对应的起点或终点位置")

    # 2. from Supabase get the current active obstacles
    obstacles_res = supabase.table("maintenance_tickets") \
        .select("edge_id, blocked") \
        .eq("status", "approved") \
        .execute()
    
    active_obstacles = obstacles_res.data if obstacles_res.data else []
    
    # 3. dynamically adjust the edges of the graph (avoiding obstacles)
    for u, v, data in list(G.edges(data=True)):
        edge_id = data.get("edge_id")
        for obs in active_obstacles:
            if obs.get("edge_id") == edge_id:
                if obs.get("blocked", True):
                    G.remove_edge(u, v)
                else:
                    data["weight"] *= 3 

    # 4. use NetworkX to calculate the shortest path
    try:
        path_nodes = nx.shortest_path(G, source=start_node, target=end_node, weight="weight")
        path_length = nx.shortest_path_length(G, source=start_node, target=end_node, weight="weight")
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=400, detail="Current temporary obstacles prevent the calculation of a feasible route")

    # 5. convert to the latitude and longitude coordinates needed by the frontend MapLibre
    coordinates = []
    for node_id in path_nodes:
        node_data = G.nodes[node_id]
        coordinates.append([node_data["lng"], node_data["lat"]])

    return {
        "success": True,
        "start_matched_node": start_node,
        "end_matched_node": end_node,
        "total_distance_meters": path_length,
        "coordinates": coordinates  # for frontend MapLibre rendering
    }