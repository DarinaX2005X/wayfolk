"""Bakes the chosen KayKit models (CC0) into one compact GLB with vertex colours.

KayKit paints every model with one gradient atlas. Sampling that atlas at each vertex
gives the same look without textures, so the whole world can share one material and be
merged into a few draw calls. Writes public/assets/world/kit.glb and src/world/kit-bounds.ts.

  python -I tests/world/tools/bake-kit.py <assets-src folder>
"""
import json, struct, sys, os
import numpy as np
from PIL import Image

SRC = sys.argv[1]
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_GLB = os.path.join(ROOT, 'public', 'assets', 'world', 'kit.glb')
OUT_TS = os.path.join(ROOT, 'src', 'world', 'kit-bounds.ts')

PACKS = {
  'med': 'KayKit-Medieval-Hexagon-Pack-1.0/KayKit-Medieval-Hexagon-Pack-1.0-main/addons/kaykit_medieval_hexagon_pack/Assets/gltf',
  'fur': 'KayKit-Furniture-Bits-1.0/KayKit-Furniture-Bits-1.0-main/addons/kaykit_furniture_bits/Assets/gltf',
  'res': 'KayKit-Restaurant-Bits-1.0/KayKit-Restaurant-Bits-1.0-main/addons/kaykit_restaurant_bits/Assets/gltf',
  'hal': 'KayKit-Halloween-Bits-1.0/KayKit-Halloween-Bits-1.0-main/addons/kaykit_halloween_bits/Assets/gltf',
}

PIECES = {
  # nature
  'tree-round-a': ('med', 'decoration/nature/tree_single_A'),
  'tree-round-b': ('med', 'decoration/nature/tree_single_B'),
  'trees-a-small': ('med', 'decoration/nature/trees_A_small'),
  'trees-a-medium': ('med', 'decoration/nature/trees_A_medium'),
  'trees-b-small': ('med', 'decoration/nature/trees_B_small'),
  'trees-b-medium': ('med', 'decoration/nature/trees_B_medium'),
  'trees-b-large': ('med', 'decoration/nature/trees_B_large'),
  'rock-a': ('med', 'decoration/nature/rock_single_A'),
  'rock-b': ('med', 'decoration/nature/rock_single_B'),
  'rock-c': ('med', 'decoration/nature/rock_single_C'),
  'rock-d': ('med', 'decoration/nature/rock_single_D'),
  'rock-e': ('med', 'decoration/nature/rock_single_E'),
  'hill-a': ('med', 'decoration/nature/hill_single_A'),
  'hill-b': ('med', 'decoration/nature/hill_single_B'),
  'hills-trees-a': ('med', 'decoration/nature/hills_A_trees'),
  'hills-trees-b': ('med', 'decoration/nature/hills_B_trees'),
  'mountain-a': ('med', 'decoration/nature/mountain_A_grass_trees'),
  'mountain-b': ('med', 'decoration/nature/mountain_B_grass_trees'),
  'cloud-big': ('med', 'decoration/nature/cloud_big'),
  'cloud-small': ('med', 'decoration/nature/cloud_small'),
  'waterlily': ('med', 'decoration/nature/waterlily_A'),
  'waterplant': ('med', 'decoration/nature/waterplant_A'),
  'pine-yellow-large': ('hal', 'tree_pine_yellow_large'),
  'pine-yellow-medium': ('hal', 'tree_pine_yellow_medium'),
  'pine-orange-large': ('hal', 'tree_pine_orange_large'),
  'pine-orange-medium': ('hal', 'tree_pine_orange_medium'),
  'pine-orange-small': ('hal', 'tree_pine_orange_small'),
  # village, for islands on the horizon
  'bld-home-a': ('med', 'buildings/yellow/building_home_A_yellow'),
  'bld-home-b': ('med', 'buildings/yellow/building_home_B_yellow'),
  'bld-windmill': ('med', 'buildings/yellow/building_windmill_yellow'),
  'bld-tower': ('med', 'buildings/yellow/building_tower_A_yellow'),
  'bld-church': ('med', 'buildings/yellow/building_church_yellow'),
  'bld-tavern': ('med', 'buildings/yellow/building_tavern_yellow'),
  'bld-well': ('med', 'buildings/yellow/building_well_yellow'),
  'bld-market': ('med', 'buildings/yellow/building_market_yellow'),
  'bld-watermill': ('med', 'buildings/yellow/building_watermill_yellow'),
  'bridge': ('med', 'buildings/neutral/building_bridge_A'),
  'fence-wood': ('med', 'buildings/neutral/fence_wood_straight'),
  # props
  'barrel': ('med', 'decoration/props/barrel'),
  'bucket-water': ('med', 'decoration/props/bucket_water'),
  'bucket': ('med', 'decoration/props/bucket_empty'),
  'crate-big': ('med', 'decoration/props/crate_A_big'),
  'crate-small': ('med', 'decoration/props/crate_A_small'),
  'crate-open': ('med', 'decoration/props/crate_open'),
  'sack': ('med', 'decoration/props/sack'),
  'wheelbarrow': ('med', 'decoration/props/wheelbarrow'),
  'ladder': ('med', 'decoration/props/ladder'),
  'lumber': ('med', 'decoration/props/resource_lumber'),
  'stones': ('med', 'decoration/props/resource_stone'),
  'flag-yellow': ('med', 'decoration/props/flag_yellow'),
  'flag-red': ('med', 'decoration/props/flag_red'),
  'flag-blue': ('med', 'decoration/props/flag_blue'),
  'tent': ('med', 'decoration/props/tent'),
  'books': ('fur', 'book_set'),
  'book': ('fur', 'book_single'),
  'lamp-standing': ('fur', 'lamp_standing'),
  'lamp-table': ('fur', 'lamp_table'),
  'cactus': ('fur', 'cactus_small_A'),
  'chair': ('fur', 'chair_A_wood'),
  'stool': ('fur', 'chair_stool_wood'),
  'table-small': ('fur', 'table_small'),
  'table-low': ('fur', 'table_low'),
  'armchair': ('fur', 'armchair_pillows'),
  'rug': ('fur', 'rug_oval_A'),
  'rug-stripes': ('fur', 'rug_rectangle_stripes_A'),
  'frame-standing': ('fur', 'pictureframe_standing_A'),
  'shelf': ('fur', 'shelf_B_small_decorated'),
  'pillow': ('fur', 'pillow_A'),
  'crate-tomatoes': ('res', 'crate_tomatoes'),
  'crate-carrots': ('res', 'crate_carrots'),
  'crate-buns': ('res', 'crate_buns'),
  'crate-lettuce': ('res', 'crate_lettuce'),
  'jar-a': ('res', 'jar_A_small'),
  'jar-b': ('res', 'jar_B_medium'),
  'pot': ('res', 'pot_A'),
  'stew-pot': ('res', 'stew_pot'),
  'bowl': ('res', 'bowl'),
  'table-round': ('res', 'table_round_A_small_decorated'),
  'lantern': ('hal', 'lantern_standing'),
  'lantern-hanging': ('hal', 'lantern_hanging'),
  'post-lantern': ('hal', 'post_lantern'),
  'candle': ('hal', 'candle_triple'),
  'bench': ('hal', 'bench'),
  'fence': ('hal', 'fence'),
  'fence-gate': ('hal', 'fence_gate'),
  'fence-pillar': ('hal', 'fence_pillar'),
  'pumpkin': ('hal', 'pumpkin_orange'),
  'pumpkin-small': ('hal', 'pumpkin_yellow_small'),
  'arch': ('hal', 'arch'),
  'post': ('hal', 'post'),
  'stepping-stones': ('hal', 'path_A'),
  'plaque': ('hal', 'plaque'),
}

NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}

_img_cache = {}


def srgb_to_linear(c):
  return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def read_accessor(g, bins, idx):
  a = g['accessors'][idx]
  bv = g['bufferViews'][a['bufferView']]
  buf = bins[bv['buffer']]
  n = NCOMP[a['type']]
  dt = DT[a['componentType']]
  off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
  stride = bv.get('byteStride', 0)
  item = np.dtype(dt).itemsize * n
  if stride and stride != item:
    raw = np.frombuffer(buf, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)[:, :item]
    arr = np.frombuffer(raw.tobytes(), dtype=dt).reshape(a['count'], n)
  else:
    arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
  arr = arr.astype(np.float64)
  if a.get('normalized'):
    if dt == np.uint8: arr /= 255
    elif dt == np.uint16: arr /= 65535
    elif dt == np.int8: arr = np.maximum(arr / 127, -1)
    elif dt == np.int16: arr = np.maximum(arr / 32767, -1)
  return arr


def node_matrix(n):
  if 'matrix' in n:
    return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
  t = np.array(n.get('translation', [0, 0, 0]))
  q = n.get('rotation', [0, 0, 0, 1])
  s = np.array(n.get('scale', [1, 1, 1]))
  x, y, z, w = q
  r = np.array([
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ])
  m = np.eye(4)
  m[:3, :3] = r * s
  m[:3, 3] = t
  return m


def load_piece(pack, rel):
  path = os.path.join(SRC, PACKS[pack], rel + '.gltf')
  folder = os.path.dirname(path)
  g = json.load(open(path))
  bins = [open(os.path.join(folder, b['uri']), 'rb').read() for b in g['buffers']]
  pos_all, nor_all, col_all, idx_all = [], [], [], []
  base = 0

  def visit(ni, parent):
    nonlocal base
    n = g['nodes'][ni]
    m = parent @ node_matrix(n)
    if 'mesh' in n:
      for prim in g['meshes'][n['mesh']]['primitives']:
        at = prim['attributes']
        p = read_accessor(g, bins, at['POSITION'])
        nr = read_accessor(g, bins, at['NORMAL']) if 'NORMAL' in at else np.zeros_like(p)
        mat = g['materials'][prim['material']] if 'material' in prim else {}
        pbr = mat.get('pbrMetallicRoughness', {})
        if 'TEXCOORD_0' in at and 'baseColorTexture' in pbr:
          uv = read_accessor(g, bins, at['TEXCOORD_0'])
          tex = g['textures'][pbr['baseColorTexture']['index']]
          img_uri = g['images'][tex['source']]['uri']
          ip = os.path.normpath(os.path.join(folder, img_uri))
          if not os.path.exists(ip):
            cand = [os.path.join(folder, '..', 'textures', os.path.basename(img_uri)),
                    os.path.join(folder, '..', 'texture', os.path.basename(img_uri))]
            ip = next(c for c in cand if os.path.exists(c))
          if ip not in _img_cache:
            _img_cache[ip] = np.asarray(Image.open(ip).convert('RGB'), dtype=np.float64) / 255
          img = _img_cache[ip]
          h, w, _ = img.shape
          px = np.clip((np.mod(uv[:, 0], 1) * w).astype(int), 0, w - 1)
          py = np.clip((np.mod(uv[:, 1], 1) * h).astype(int), 0, h - 1)
          c = img[py, px]
        else:
          f = pbr.get('baseColorFactor', [0.8, 0.8, 0.8, 1])
          c = np.tile(np.array(f[:3]) ** (1 / 2.2), (len(p), 1))
        ph = np.c_[p, np.ones(len(p))] @ m.T
        nm = nr @ np.linalg.inv(m[:3, :3])
        nm /= np.maximum(np.linalg.norm(nm, axis=1, keepdims=True), 1e-9)
        idx = read_accessor(g, bins, prim['indices']).astype(np.int64).ravel() if 'indices' in prim else np.arange(len(p))
        pos_all.append(ph[:, :3]); nor_all.append(nm); col_all.append(c); idx_all.append(idx + base)
        base += len(p)
    for ch in n.get('children', []):
      visit(ch, m)

  scene = g['scenes'][g.get('scene', 0)]
  for ni in scene['nodes']:
    visit(ni, np.eye(4))
  return np.vstack(pos_all), np.vstack(nor_all), np.vstack(col_all), np.concatenate(idx_all)


def main():
  blob = bytearray()
  views, accessors, meshes, nodes = [], [], [], []
  bounds = {}
  tris_total = 0

  def add_view(data, target, stride=None):
    while len(blob) % 4: blob.append(0)
    off = len(blob)
    blob.extend(data)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}
    if stride: v['byteStride'] = stride
    views.append(v)
    return len(views) - 1

  for pid, (pack, rel) in PIECES.items():
    p, n, c, idx = load_piece(pack, rel)
    lin = srgb_to_linear(c)
    pv = add_view(p.astype(np.float32).tobytes(), 34962)
    accessors.append({'bufferView': pv, 'componentType': 5126, 'count': len(p), 'type': 'VEC3',
                      'min': p.min(0).tolist(), 'max': p.max(0).tolist()})
    pa = len(accessors) - 1
    nq = np.clip(np.round(n * 127), -127, 127).astype(np.int8)
    nq4 = np.c_[nq, np.zeros(len(nq), dtype=np.int8)].astype(np.int8)
    nv = add_view(nq4.tobytes(), 34962, 4)
    accessors.append({'bufferView': nv, 'componentType': 5120, 'normalized': True, 'count': len(p), 'type': 'VEC3'})
    na = len(accessors) - 1
    cq = np.clip(np.round(lin * 65535), 0, 65535).astype(np.uint16)
    cq4 = np.c_[cq, np.full(len(cq), 65535, dtype=np.uint16)].astype(np.uint16)
    cv = add_view(cq4.tobytes(), 34962, 8)
    accessors.append({'bufferView': cv, 'componentType': 5123, 'normalized': True, 'count': len(p), 'type': 'VEC4'})
    ca = len(accessors) - 1
    if len(p) < 65536:
      iv = add_view(idx.astype(np.uint16).tobytes(), 34963); ct = 5123
    else:
      iv = add_view(idx.astype(np.uint32).tobytes(), 34963); ct = 5125
    accessors.append({'bufferView': iv, 'componentType': ct, 'count': len(idx), 'type': 'SCALAR'})
    ia = len(accessors) - 1
    meshes.append({'name': pid, 'primitives': [{'attributes': {'POSITION': pa, 'NORMAL': na, 'COLOR_0': ca}, 'indices': ia}]})
    nodes.append({'name': pid, 'mesh': len(meshes) - 1})
    mn, mx = p.min(0), p.max(0)
    bounds[pid] = [round(float(v), 3) for v in [*mn, *mx]]
    tris = len(idx) // 3
    tris_total += tris
    print(f'{pid:22s} tris {tris:6d}  size {mx[0]-mn[0]:.2f} x {mx[1]-mn[1]:.2f} x {mx[2]-mn[2]:.2f}  y0 {mn[1]:.2f}')

  while len(blob) % 4: blob.append(0)
  gltf = {
    'asset': {'version': '2.0', 'generator': 'wayfolk bake-kit (KayKit CC0, vertex colours)'},
    'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
    'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
    'nodes': nodes, 'meshes': meshes, 'accessors': accessors, 'bufferViews': views,
    'buffers': [{'byteLength': len(blob)}],
  }
  js = json.dumps(gltf, separators=(',', ':')).encode()
  while len(js) % 4: js += b' '
  total = 12 + 8 + len(js) + 8 + len(blob)
  with open(OUT_GLB, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
  with open(OUT_TS, 'w', newline='\n') as f:
    f.write('// Generated by tests/world/tools/bake-kit.py from KayKit (CC0). Do not edit by hand.\n')
    f.write('// Bounds of each kit piece in its own units: [minX, minY, minZ, maxX, maxY, maxZ].\n')
    f.write('export const KIT_BOUNDS: Record<string, readonly [number, number, number, number, number, number]> = {\n')
    for k, v in bounds.items():
      f.write(f"  '{k}': [{', '.join(str(x) for x in v)}],\n")
    f.write('};\n')
  print('pieces', len(PIECES), 'tris', tris_total, 'bytes', total)


main()
