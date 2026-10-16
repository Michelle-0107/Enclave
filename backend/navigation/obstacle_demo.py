"""Compatibility launcher for the two-resident sandbox; management is not a gate."""
from ..reports.community_demo import create_community_demo_app
create_obstacle_demo_app=create_community_demo_app
if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_community_demo_app(),host='127.0.0.1',port=8006)
