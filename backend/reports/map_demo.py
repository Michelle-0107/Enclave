"""Map practice follows the same two-resident rule as the live API."""
from .community_demo import create_community_demo_app
create_map_demo_app=create_community_demo_app
if __name__=='__main__':
    import uvicorn
    uvicorn.run(create_community_demo_app(),host='127.0.0.1',port=8003)
