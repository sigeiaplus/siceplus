"""Confere o cartão IMPRESSO (SVG real, rasterizado) contra a geometria usada pelo leitor.
Mede: centro de cada bolinha, dos 4 marcadores, caixa do QR, tamanho real em 300 dpi."""
import json, sys
import numpy as np, cv2, cairosvg
nome = sys.argv[1] if len(sys.argv) > 1 else 'v5'
d = json.load(open(f'/tmp/omr/{nome}.json')); L = d['layout']; F = d['folha']
PPM = 20
cairosvg.svg2png(url=f'/tmp/omr/{nome}.svg', write_to='/tmp/omr/_g.png', output_width=int(F['largura']*PPM), output_height=int(F['altura']*PPM), background_color='white')
img = cv2.imread('/tmp/omr/_g.png', 0)
escuro = (img < 140).astype(np.uint8)

# 1) bolinhas: centróide do contorno impresso numa janela em torno do centro previsto
dev = []
for b in L['bolhas']:
    cx, cy, r = b['x']*PPM, b['y']*PPM, b['d']/2*PPM
    m = int(r + 0.9*PPM)
    x0, y0 = int(cx-m), int(cy-m)
    jan = escuro[y0:y0+2*m, x0:x0+2*m].copy()
    yy, xx = np.mgrid[0:jan.shape[0], 0:jan.shape[1]]
    dist = np.hypot(xx + x0 - cx, yy + y0 - cy)
    anel = jan * ((dist > r - 0.5*PPM) & (dist < r + 0.5*PPM))
    ys, xs = np.nonzero(anel)
    if len(xs) < 20: dev.append(99); continue
    dev.append(np.hypot(xs.mean()+x0-cx, ys.mean()+y0-cy)/PPM)
dev = np.array(dev)
print(f'bolinhas: {len(dev)} | desvio medio {dev.mean():.3f} mm | maximo {dev.max():.3f} mm | sem contorno: {(dev>=99).sum()}')

# 2) marcadores
for i, c in enumerate(L['marcadores']):
    s = 7; x0, y0 = int((c['x']-s)*PPM), int((c['y']-s)*PPM)
    jan = escuro[y0:y0+int(2*s*PPM), x0:x0+int(2*s*PPM)]
    n, lab, st, cen = cv2.connectedComponentsWithStats(jan)
    k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    mx, my = (cen[k][0]+x0)/PPM, (cen[k][1]+y0)/PPM
    lado = np.sqrt(st[k, cv2.CC_STAT_AREA])/PPM
    print(f'marcador {i}: centro medido ({mx:.2f},{my:.2f}) previsto ({c["x"]},{c["y"]}) lado {lado:.2f} mm')

# 3) caixa do QR
q = L['qr']
x0, y0, x1, y1 = [int(v*PPM) for v in (q['x']-3, q['y']-3, q['x']+q['lado']+3, q['y']+q['lado']+3)]
ys, xs = np.nonzero(escuro[y0:y1, x0:x1])
print(f'QR: caixa medida x {(xs.min()+x0)/PPM:.2f}..{(xs.max()+x0)/PPM:.2f}  y {(ys.min()+y0)/PPM:.2f}..{(ys.max()+y0)/PPM:.2f}  | prevista x {q["x"]}..{q["x"]+q["lado"]}  y {q["y"]}..{q["y"]+q["lado"]}')

# 4) estrutura da grade
cols = {}
for n in L['numeros']: cols.setdefault(n['col'], []).append(n['numero'])
print('colunas:', {c+1: (v[0], v[-1], len(v)) for c, v in sorted(cols.items())})
ys = sorted({round(b['y'], 3) for b in L['bolhas']})
print('linhas distintas (y):', len(ys), '| passo vertical', sorted({round(b-a, 3) for a, b in zip(ys, ys[1:])}))
por = {}
for b in L['bolhas']: por.setdefault(b['numero'], []).append(b)
passos = {round(v[i+1]['x']-v[i]['x'], 3) for v in por.values() for i in range(len(v)-1)}
print('passo horizontal entre alternativas:', passos, '| diametro', round(L['bolhas'][0]['d'], 2), 'mm | alternativas por questao:', {len(v) for v in por.values()})

# 5) tamanho real a 300 dpi (A4: 210 x 297 mm)
cairosvg.svg2png(url=f'/tmp/omr/{nome}.svg', write_to='/tmp/omr/_300.png', dpi=300, background_color='white')
im = cv2.imread('/tmp/omr/_300.png', 0)
print(f'300 dpi: imagem {im.shape[1]}x{im.shape[0]} px = {im.shape[1]/300*25.4:.1f} x {im.shape[0]/300*25.4:.1f} mm (esperado {F["largura"]} x {F["altura"]})')
mk = (im < 140).astype(np.uint8)[: int(14/25.4*300), : int(14/25.4*300)]
n, lab, st, cen = cv2.connectedComponentsWithStats(mk); k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
print(f'marcador sup-esq a 300 dpi: {st[k, cv2.CC_STAT_WIDTH]/300*25.4:.2f} x {st[k, cv2.CC_STAT_HEIGHT]/300*25.4:.2f} mm (esperado 7 x 7)')
