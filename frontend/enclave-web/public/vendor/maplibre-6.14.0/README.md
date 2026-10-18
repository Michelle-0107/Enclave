# MapLibre worker assets

Copied unchanged from the installed maplibre-gl 6.14.0 npm package.
MapLibre v6 needs an explicit worker URL when used with a bundler.
Both What-if maps configure this same-origin worker before creating a map.

When upgrading maplibre-gl, update this directory, both map worker URLs,
and the regression test version. Copy the worker, shared module and LICENSE.txt
from the new package together. Do not edit the vendored modules.
