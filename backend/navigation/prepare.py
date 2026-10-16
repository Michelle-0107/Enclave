"""Build the bundled KL East pilot graph without Docker, cloud keys, or .env."""

import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT=Path(__file__).resolve().parent
RUNTIME=ROOT/'.runtime'
PACKAGES=RUNTIME/'packages'
ENGINE_VERSION='3.9.1'


def prepare():
    if sys.version_info<(3,12):
        raise RuntimeError('The optional local routing runtime needs Python 3.12 or newer')
    RUNTIME.mkdir(parents=True,exist_ok=True)
    if not (PACKAGES/'valhalla').is_dir():
        subprocess.run([sys.executable,'-m','pip','install','--only-binary=:all:','--disable-pip-version-check',
            '--no-input','--target',str(PACKAGES),'pyvalhalla=='+ENGINE_VERSION],check=True)
    sys.path.insert(0,str(PACKAGES))
    import valhalla
    if valhalla.__version__ != ENGINE_VERSION:
        raise RuntimeError('Routing package version differs from the reviewed runtime')
    source=ROOT/'data/kl-east.osm.pbf'
    metadata=json.loads((ROOT/'data/source.json').read_text(encoding='utf-8'))
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != metadata['pbf_sha256']:
        raise RuntimeError('Road snapshot checksum mismatch')
    graph=RUNTIME/('graph-'+digest[:12])
    tiles=graph/'tiles'
    tiles.mkdir(parents=True,exist_ok=True)
    config=valhalla.get_config(tile_dir=str(tiles),tile_extract='',verbose=False)
    config['mjolnir'].update(concurrency=2,include_pedestrian=True,
        admin=str(graph/'admins.sqlite'),timezone=str(graph/'timezones.sqlite'))
    config_path=graph/'valhalla.json'
    config_path.write_text(json.dumps(config,indent=2),encoding='utf-8')
    ready=graph/'ready.json'
    if not ready.exists():
        package=Path(valhalla.__file__).parent
        suffix='.exe' if os.name=='nt' else ''
        environment=dict(os.environ)
        if os.name=='nt':
            # The official Windows wheel vendors native DLLs in a sibling folder.
            environment['PATH']=str(package.parent/'pyvalhalla.libs')+os.pathsep+environment.get('PATH','')
        with (graph/'build.log').open('w',encoding='utf-8') as log:
            subprocess.run([str(package/'bin'/('valhalla_build_tiles'+suffix)),
                '-c',str(config_path),str(source)],check=True,env=environment,stdout=log,
                stderr=subprocess.STDOUT,timeout=240,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if not list(tiles.rglob('*.gph')):
            raise RuntimeError('No routing graph tiles were produced')
        ready.write_text(json.dumps({'pbf_sha256':digest,'engine_version':ENGINE_VERSION}),encoding='utf-8')
    pointer=RUNTIME/'engine.json.tmp'
    pointer.write_text(json.dumps({'config_path':str(config_path),'pbf_sha256':digest,
        'engine_version':ENGINE_VERSION},indent=2),encoding='utf-8')
    os.replace(pointer,RUNTIME/'engine.json')
    print('KL East local routing graph is ready. No .env or hosted database changes were made.')
    print('Start the private engine: python -B -m backend.navigation.engine')


if __name__=='__main__':
    prepare()
