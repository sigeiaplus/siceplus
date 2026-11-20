"""Fotos SINTÉTICAS do cartão (teste de desenvolvimento, não faz parte do app).
Renderiza o SVG real do cartão, marca as bolinhas e simula a foto (perspectiva, rotação,
luz irregular, ruído, desfoque, corte). Saída em /tmp/omr/fotos/<nome>.rgba + .json.
Isto NÃO substitui cartão impresso fotografado em aparelho de verdade."""
import json, math, os, sys
import numpy as np, cv2, cairosvg

PPM = 14  # pixels por mm ao renderizar o cartão
CARTAO = os.environ.get('CARTAO', 'v5')
N = int(os.environ.get('N', 50)); ALTS = int(os.environ.get('ALTS', 4))
OUT = ('/tmp/omr/fotos' if CARTAO == 'v5' else '/tmp/omr/fotos4') + ('' if (N, ALTS) == (50, 4) else f'-{N}q{ALTS}a')
os.makedirs(OUT, exist_ok=True)

def renderizar(nome):
    dados = json.load(open(f'/tmp/omr/{nome}.json'))
    f = dados['folha']
    w, h = int(f['largura'] * PPM), int(f['altura'] * PPM)
    cairosvg.svg2png(url=f'/tmp/omr/{nome}.svg', write_to=f'/tmp/omr/{nome}.png', output_width=w, output_height=h, background_color='white')
    img = cv2.imread(f'/tmp/omr/{nome}.png', cv2.IMREAD_COLOR)
    return img, dados['layout'], f

def marcar(img, layout, respostas, forca):
    """forca: tom de cinza da tinta (0 = preto). Cada resposta: 'A' ou 'AB' (dupla)."""
    rng = np.random.default_rng(11)
    for b in layout['bolhas']:
        r = respostas.get(b['numero'])
        if not r or b['alt'] not in r:
            continue
        tom = forca[b['numero']] if isinstance(forca, dict) else forca
        cx, cy = b['x'] * PPM + rng.normal(0, 0.12 * PPM), b['y'] * PPM + rng.normal(0, 0.12 * PPM)
        raio = b['d'] / 2 * PPM * rng.uniform(0.82, 0.98)
        cor = (tom + 25, tom + 8, tom)  # BGR: tinta levemente azulada
        cv2.ellipse(img, (int(cx), int(cy)), (int(raio), int(raio * rng.uniform(0.9, 1.0))), rng.uniform(0, 180), 0, 360, cor, -1, cv2.LINE_AA)
    return img

def gabarito(n, alts, brancas=(13, 27, 44), dupla=None):
    r = {}
    for i in range(1, n + 1):
        if i in brancas:
            continue
        r[i] = 'ABCDE'[(i * 7 + 3) % alts]
    if dupla:
        r[dupla] = 'ABCDE'[(dupla * 7 + 3) % alts] + 'ABCDE'[(dupla * 7 + 4) % alts]
    return r

def foto(cartao, W, H, frac=0.86, rot=0, tilt=(0, 0), shift=(0, 0), luz=0.0, sombra=False, ruido=4, borrao=0, fundo=(96, 100, 108), corte=None, semente=3):
    h, w = cartao.shape[:2]
    escala = min(W * frac / w, H * frac / h)
    cw, ch = w * escala, h * escala
    # cantos do cartão (TL, TR, BR, BL), perspectiva por inclinação: tilt = (horizontal, vertical)
    tx, ty = tilt
    pts = np.array([[-cw / 2 * (1 - ty), -ch / 2 * (1 - tx)], [cw / 2 * (1 - ty), -ch / 2 * (1 + tx)],
                    [cw / 2 * (1 + ty), ch / 2 * (1 + tx)], [-cw / 2 * (1 + ty), ch / 2 * (1 - tx)]], dtype=np.float64)
    a = math.radians(rot)
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    pts = pts @ R.T + np.array([W / 2 + shift[0] * W, H / 2 + shift[1] * H])
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, pts.astype(np.float32))
    rng = np.random.default_rng(semente)
    bg = np.empty((H, W, 3), np.float32); bg[:] = fundo
    bg += rng.normal(0, 2, (H, W, 1))
    warp = cv2.warpPerspective(cartao, M, (W, H), flags=cv2.INTER_AREA if escala < 1 else cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W, H), flags=cv2.INTER_LINEAR)
    m = (mask.astype(np.float32) / 255)[..., None]
    out = warp.astype(np.float32) * m + bg * (1 - m)
    if luz:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        g = 1 - luz * (xx / W * 0.7 + yy / H * 0.3)
        out *= g[..., None]
    if sombra:  # sombra de mão/borda cobrindo um canto
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = (xx - W * 0.05) ** 2 + (yy - H * 0.95) ** 2
        out *= (1 - 0.45 * np.exp(-d / (2 * (W * 0.28) ** 2)))[..., None]
    if borrao:
        out = cv2.GaussianBlur(out, (0, 0), borrao)
    out += rng.normal(0, ruido, out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    if corte:  # (x0,y0,x1,y1) em fração: o que ficar fora vira "fora da foto" (cartão cortado)
        x0, y0, x1, y1 = [int(v) for v in (corte[0] * W, corte[1] * H, corte[2] * W, corte[3] * H)]
        out = out[y0:y1, x0:x1]
    return out

def salvar(nome, img, meta):
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2RGBA)
    open(f'{OUT}/{nome}.rgba', 'wb').write(rgba.tobytes())
    meta.update(width=int(img.shape[1]), height=int(img.shape[0]))
    json.dump(meta, open(f'{OUT}/{nome}.json', 'w'))
    cv2.imwrite(f'{OUT}/{nome}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 85])

def main():
    n, alts = N, ALTS
    base, layout, folha = renderizar(CARTAO)
    retrato = CARTAO == 'v4'  # v4 é folha em pé: as fotos trocam largura/altura
    gab = gabarito(n, alts, brancas=tuple(b for b in (13, 27, 44) if b <= n), dupla=20 if n >= 20 else None)
    gab_sem_dupla = {k: v for k, v in gab.items() if len(v) == 1}
    cenarios = []
    def add(nome, respostas, forca, **kw):
        cartao = marcar(base.copy(), layout, respostas, forca)
        W, H = kw.pop('W', 3200), kw.pop('H', 2400)
        if retrato:
            W, H = H, W
        img = foto(cartao, W, H, **kw)
        salvar(nome, img, dict(nome=nome, respostas={str(k): v for k, v in respostas.items()}))

    forte = 30
    add('01-frontal-forte', gab_sem_dupla, forte)
    add('02-dupla-e-brancas', gab, forte, rot=1.5)
    add('03-marca-media', gab_sem_dupla, 120, rot=-2)
    add('04-marca-fraca', gab_sem_dupla, 175, rot=1)
    add('05-marca-muito-fraca', gab_sem_dupla, 210)
    add('06-inclinado-vertical', gab_sem_dupla, forte, tilt=(0.10, 0.0), rot=3)
    add('07-inclinado-horizontal', gab_sem_dupla, forte, tilt=(0.0, 0.10), rot=-4)
    add('08a-inclinado-moderado', gab_sem_dupla, forte, tilt=(0.12, 0.05), rot=4)
    add('08-inclinado-forte', gab_sem_dupla, forte, tilt=(0.16, 0.08), rot=5)
    add('09-giro-180', gab_sem_dupla, forte, rot=180)
    add('10-giro-90', gab_sem_dupla, forte, rot=90, W=2400, H=3200)
    add('11-giro-270', gab_sem_dupla, forte, rot=270 + 2, W=2400, H=3200)
    add('12-luz-irregular', gab_sem_dupla, forte, luz=0.45)
    add('13-sombra-canto', gab_sem_dupla, forte, sombra=True, luz=0.2)
    add('14-pouca-luz-ruido', gab_sem_dupla, 60, luz=0.55, ruido=9)
    add('15-desfocado', gab_sem_dupla, forte, borrao=3.0, rot=2)
    add('16-baixa-resolucao', gab_sem_dupla, forte, W=1280, H=960, rot=2)
    add('17-cartao-pequeno-no-quadro', gab_sem_dupla, forte, frac=0.55, shift=(0.1, -0.05), rot=-3)
    add('18-cortado', gab_sem_dupla, forte, frac=0.97, corte=(0.0, 0.0, 0.93, 1.0))
    add('19-em-branco', {}, forte)
    add('20-retrato-celular', gab_sem_dupla, forte, W=2400, H=3200, frac=0.9, rot=90 + 2)
    if retrato:
        print('fotos geradas em', OUT); return
    # cartão antigo (v4, 186x273) para comparar: precisa ser RECUSADO com mensagem de versão
    base4, layout4, _ = renderizar('v4')
    cart4 = marcar(base4.copy(), layout4, gab_sem_dupla, forte)
    img = foto(cart4, 2400, 3200, frac=0.95, rot=1)
    salvar('21-cartao-antigo-v4', img, dict(nome='21-cartao-antigo-v4', respostas={}))
    print('fotos geradas em', OUT)

main()
