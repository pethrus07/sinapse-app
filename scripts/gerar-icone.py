# Gera assets/sinapse.ico (icone do atalho da area de trabalho).
# Icone e ativo gerado, nao arquivo binario editado a mao: rodar de novo reproduz.
#
#   python scripts/gerar-icone.py
#
# Requer Pillow e a fonte de emoji do Windows (Segoe UI Emoji).
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "assets" / "sinapse.ico"
FONTE_EMOJI = Path("C:/Windows/Fonts/seguiemj.ttf")

FUNDO = (17, 20, 28, 255)      # --panel
BORDA = (44, 212, 192, 130)    # --accent, suavizado
EMOJI = "\U0001F9E0"           # cerebro
TAMANHOS = [16, 24, 32, 48, 64, 128, 256]


def desenhar(px: int) -> Image.Image:
    # 4x de supersampling: borda e emoji saem sem escada
    e = 4
    n = px * e
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    raio = int(n * 0.22)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=raio, fill=FUNDO)
    largura = max(1, int(n * 0.028))
    d.rounded_rectangle(
        [largura // 2, largura // 2, n - 1 - largura // 2, n - 1 - largura // 2],
        radius=raio, outline=BORDA, width=largura,
    )

    if FONTE_EMOJI.exists():
        # Segoe UI Emoji so aceita alguns corpos em bitmap colorido; 109 e o canonico
        fonte = ImageFont.truetype(str(FONTE_EMOJI), 109)
        camada = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
        ImageDraw.Draw(camada).text((80, 80), EMOJI, font=fonte, anchor="mm", embedded_color=True)
        alvo = int(n * 0.56)
        camada = camada.crop(camada.getbbox()).resize((alvo, alvo), Image.LANCZOS)
        img.alpha_composite(camada, ((n - alvo) // 2, (n - alvo) // 2))

    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    quadros = [desenhar(t) for t in TAMANHOS]
    quadros[-1].save(SAIDA, format="ICO", sizes=[(t, t) for t in TAMANHOS])
    print(f"[icone] {SAIDA} - {', '.join(str(t) for t in TAMANHOS)} px")


if __name__ == "__main__":
    main()
