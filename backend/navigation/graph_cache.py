"""Share a graph load across threads, including concurrent first requests.

functools.lru_cache alone permits several identical cold loads in parallel.
Graph construction/loading is memory-heavy; hold the lock through publishing
the cached graph, then let route searches use that immutable graph concurrently.
"""
from functools import lru_cache, wraps
from threading import RLock


def shared_graph_cache(maxsize=4):
    def decorate(load):
        cached = lru_cache(maxsize=maxsize)(load)
        lock = RLock()

        @wraps(load)
        def shared(*args, **kwargs):
            with lock:
                return cached(*args, **kwargs)

        def clear():
            with lock:
                cached.cache_clear()

        shared.cache_clear = clear
        shared.cache_info = cached.cache_info
        shared.cache_parameters = cached.cache_parameters
        return shared
    return decorate
