import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_og_image():
    W, H = 1200, 630
    # 1. Base image
    img = Image.new("RGBA", (W, H), (11, 15, 23, 255))
    
    # 2. Draw subtle gradient background
    bg_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(bg_overlay)
    for y in range(H):
        ratio = y / H
        r = int(11 * (1 - ratio) + 7 * ratio)
        g = int(15 * (1 - ratio) + 20 * ratio)
        b = int(23 * (1 - ratio) + 38 * ratio)
        bg_draw.line([(0, y), (W, y)], fill=(r, g, b, 255))
    img = Image.alpha_composite(img, bg_overlay)

    # 3. Ambient Glows
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    
    # Cyan/Sky glow top right
    gdraw.ellipse([850, -100, 1350, 400], fill=(2, 132, 199, 45))
    # Emerald glow bottom left
    gdraw.ellipse([-100, 300, 450, 800], fill=(16, 185, 129, 40))
    # Center subtle glow
    gdraw.ellipse([450, 150, 750, 450], fill=(56, 189, 248, 15))
    
    glow = glow.filter(ImageFilter.GaussianBlur(80))
    img = Image.alpha_composite(img, glow)

    # 4. Grid lines overlay
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid)
    grid_color = (255, 255, 255, 8)
    for x in range(0, W, 80):
        grid_draw.line([(x, 0), (x, H)], fill=grid_color)
    for y in range(0, H, 80):
        grid_draw.line([(0, y), (W, y)], fill=grid_color)
    img = Image.alpha_composite(img, grid)

    # Prepare Drawing context
    draw = ImageDraw.Draw(img)

    # Fonts
    font_dir = "C:/Windows/Fonts"
    f_title_main = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 44)
    f_brand = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 23)
    f_brand_sub = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 13)
    f_sub = ImageFont.truetype(f"{font_dir}/segoeui.ttf", 19)
    f_card_title = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 16)
    f_card_desc = ImageFont.truetype(f"{font_dir}/segoeui.ttf", 12)
    f_badge = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 13)
    f_footer = ImageFont.truetype(f"{font_dir}/segoeui.ttf", 14)
    f_footer_bold = ImageFont.truetype(f"{font_dir}/segoeuib.ttf", 13)

    # 5. Header: Logo & Branding
    logo_path = "logo.png"
    if os.path.exists(logo_path):
        logo = Image.open(logo_path).convert("RGBA")
        logo = logo.resize((60, 60), Image.Resampling.LANCZOS)
        img.paste(logo, (80, 50), logo)
    else:
        draw.rounded_rectangle([80, 50, 140, 110], radius=16, fill=(16, 185, 129, 255))

    draw.text((155, 52), "ZISWAF Smart Inflow Converter", font=f_brand, fill=(248, 250, 252))
    draw.text((156, 84), "LITE EDITION  ·  CLIENT-SIDE RECONCILIATION", font=f_brand_sub, fill=(56, 189, 248))

    # Top right status badge
    draw.rounded_rectangle([940, 60, 1120, 100], radius=20, fill=(19, 26, 38, 240), outline=(36, 48, 68), width=1)
    draw.ellipse([960, 76, 970, 86], fill=(16, 185, 129))
    draw.text((980, 71), "GitHub Pages Live", font=f_badge, fill=(232, 237, 246))

    # 6. Hero Title & Subtitle
    draw.text((80, 160), "Otomasi Mutasi Bank & Rekonsiliasi ZISWAF", font=f_title_main, fill=(255, 255, 255))
    draw.text((80, 222), "5-Layer Smart Routing Engine  ·  100% Client-Side Tanpa Database  ·  Ekspor Jurnal SIAK", font=f_sub, fill=(148, 163, 184))

    # 7. 4 Glass Cards
    cards_data = [
        ("5-Layer Classifier", ["Kode Ekor, Donatur Tetap,", "Keywords, & Outflow Filter"], (56, 189, 248), "#1"),
        ("Zero Server Backend", ["100% di browser lokal,", "privasi mutasi bank terjaga"], (52, 211, 153), "#2"),
        ("AI Semantic Matcher", ["Ollama Lokal, Gemini, OpenAI,", "atau OpenRouter opsional"], (167, 139, 250), "#3"),
        ("Format SIAK Ready", ["Ekspor Jurnal Excel / CSV", "dan Tautan Konfirmasi WA"], (251, 191, 36), "#4"),
    ]

    card_w = 246
    card_h = 175
    card_y = 295
    spacing = 18

    for i, (ctitle, cdesc_lines, accent_rgb, badge_txt) in enumerate(cards_data):
        cx = 80 + i * (card_w + spacing)
        
        # Card Background
        card_box = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(card_box)
        cdraw.rounded_rectangle([0, 0, card_w, card_h], radius=16, fill=(19, 26, 38, 225), outline=(36, 48, 68), width=1)
        
        # Mini accent icon pill
        cdraw.rounded_rectangle([18, 18, 56, 56], radius=10, fill=(accent_rgb[0], accent_rgb[1], accent_rgb[2], 35))
        cdraw.text((28, 24), badge_txt, font=f_card_title, fill=accent_rgb)

        # Card Title
        cdraw.text((18, 80), ctitle, font=f_card_title, fill=(248, 250, 252))
        
        # Card Description
        cdraw.text((18, 110), cdesc_lines[0], font=f_card_desc, fill=(139, 153, 176))
        cdraw.text((18, 130), cdesc_lines[1], font=f_card_desc, fill=(139, 153, 176))

        img = Image.alpha_composite(img, Image.new("RGBA", (W, H), (0, 0, 0, 0)))
        img.paste(card_box, (cx, card_y), card_box)

    # 8. Footer Bar
    footer_draw = ImageDraw.Draw(img)
    footer_draw.line([(80, 520), (1120, 520)], fill=(26, 35, 51), width=1)
    footer_draw.text((80, 555), "Data rekening dan keuangan 100% aman dan tidak pernah meninggalkan browser Anda", font=f_footer, fill=(100, 116, 139))
    
    # Right Tag
    footer_draw.rounded_rectangle([975, 545, 1120, 580], radius=6, fill=(30, 41, 59))
    footer_draw.text((998, 554), "ZISWAF TECH", font=f_footer_bold, fill=(56, 189, 248))

    # Save final PNG
    img.convert("RGB").save("og-image.png", "PNG", quality=95, optimize=True)
    print("Successfully generated og-image.png (1200x630)")

if __name__ == "__main__":
    create_og_image()
