from base64 import b64decode, b64encode
from html import escape
from io import BytesIO
from pathlib import Path
from threading import Lock

import pypdfium2
from PIL import Image
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Image as PdfImage
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = HexColor("#40020D")
LINE = HexColor("#E6CDD0")
MARGIN = 42
WIDTH = A4[0] - 2 * MARGIN
DEFAULT_LOGO = Path(__file__).resolve().parents[3] / "frontend" / "public" / "gather-dessert-invoice-logo.webp"
_preview_lock = Lock()
_body = ParagraphStyle("invoice-body", fontName="Helvetica", fontSize=10, leading=14, textColor=INK)
_small = ParagraphStyle("invoice-small", parent=_body, fontSize=8.5, leading=12)
_heading = ParagraphStyle("invoice-heading", parent=_body, fontName="Helvetica-Bold", spaceAfter=4, keepWithNext=True)
_brand = ParagraphStyle("invoice-brand", parent=_body, fontName="Times-Bold", fontSize=21, leading=23)
_title = ParagraphStyle("invoice-title", parent=_brand, alignment=TA_RIGHT)
_right = ParagraphStyle("invoice-right", parent=_body, alignment=TA_RIGHT)
_right_small = ParagraphStyle("invoice-right-small", parent=_small, alignment=TA_RIGHT)


def paragraph(text, style=_body):
    # ReportLab paragraphs interpret markup. Invoice fields are always plain text.
    return Paragraph(escape(str(text or "")).replace("\n", "<br/>"), style)


def money(minor):
    return f"{minor // 100:,}.{minor % 100:02}"


def table(data, widths, rules=(), *, repeat=0):
    layout = LongTable(data, colWidths=widths, repeatRows=repeat, splitInRow=1)
    layout.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        *rules,
    ]))
    return layout


def logo_flowable(logo):
    source = BytesIO(b64decode(logo["data"])) if logo else DEFAULT_LOGO
    if not logo and not source.is_file():
        return Spacer(1, 1)
    with Image.open(source) as original:
        image = original.convert("RGBA")
        image.thumbnail((220, 220))
        stream = BytesIO()
        image.save(stream, "PNG")
        stream.seek(0)
    scale = 53 / max(image.size)
    return PdfImage(stream, width=image.width * scale, height=image.height * scale, hAlign="LEFT")


def header(settings, data, accent):
    title = settings["title"]
    if data["kind"] == "extras":
        title += " · Extras"
    brand = [paragraph(settings["issuer"], _brand)]
    if settings["issuerDetails"]:
        brand.append(paragraph(settings["issuerDetails"], _small))
    return [
        table([[logo_flowable(settings["logo"]), brand, [
            paragraph(title, _title), paragraph(data["number"], _right),
            paragraph("Issued " + data["issued"], _right_small),
        ]]], [66, WIDTH - 226, 160], [("LINEBELOW", (0, 0), (-1, -1), 1.25, accent)]),
    ]


def billing(settings, data, _accent):
    billed_to = [paragraph(settings["billedTo"], _heading), paragraph(data["billedTo"])]
    if data.get("billingAddress"):
        billed_to.append(paragraph(data["billingAddress"], _small))
    venue = [
        paragraph(settings["venue"], _heading), paragraph(data["venue"]),
        paragraph("Event " + data["eventAt"], _small),
    ]
    if data.get("setupAt"):
        venue.append(paragraph("Setup ready " + data["setupAt"], _small))
    return [
        paragraph("Event reference " + data["eventNumber"], _small),
        table([[billed_to, venue]], [WIDTH / 2, WIDTH / 2], [
            ("LINEBEFORE", (1, 0), (1, 0), .5, LINE),
        ]),
    ]


def items(settings, data, accent):
    show_units = any("quantity" in line for line in data["lines"])
    keys = ("description", "quantity", "unitPrice", "amount") if show_units else ("description", "amount")
    headings = [paragraph(settings[key], _heading) for key in keys]
    body = []
    for item in data["lines"]:
        cells = [paragraph(item["description"])]
        if show_units:
            cells.extend([
                paragraph(item.get("quantity"), _right),
                paragraph(money(item["unitPriceMinor"]) if "unitPriceMinor" in item else "", _right),
            ])
        body.append(cells + [paragraph(money(item["amountMinor"]), _right)])
    tint = Color(*[.83 + .17 * channel for channel in (accent.red, accent.green, accent.blue)])
    rules = [("LINEBELOW", (0, 0), (-1, 0), .7, accent), ("LINEBELOW", (0, 1), (-1, -1), .5, LINE)]
    if settings["style"] != "plain":
        rules.append(("BACKGROUND", (0, 0), (-1, 0), tint))
    if settings["style"] == "striped":
        rules.append(("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, tint]))
    widths = [WIDTH - 239, 46, 85, 108] if show_units else [WIDTH - 120, 120]
    totals = [["Total", data["totalMinor"]]]
    if data["kind"] == "booking":
        totals.extend([["Deposit verified", data["depositMinor"]], ["Original balance", data["balanceMinor"]]])
    summary = [[paragraph(label, _right), paragraph("RM " + money(value), _right)] for label, value in totals]
    return [table([headings, *body], widths, rules, repeat=1), table(summary, [WIDTH - 125, 125])]


def payment(settings, data, _accent):
    detail = "DuitNow"
    if data.get("dueAt"):
        detail += " · Due at issue: " + data["dueAt"]
    if data.get("actualEndAt"):
        detail += "\nActual event end: " + data["actualEndAt"]
    if settings["instructions"]:
        detail += "\n" + settings["instructions"]
    return [paragraph(settings["heading"], _heading), paragraph(detail)]


def footer(settings, _data, _accent):
    return [paragraph(settings["text"], _small)] if settings["visible"] and settings["text"] else []


_sections = {"header": header, "billing": billing, "items": items, "payment": payment, "footer": footer}


def render_invoice(template, data):
    stream = BytesIO()
    document = SimpleDocTemplate(
        stream, pagesize=A4, title=data["number"], author=template["header"]["issuer"],
        leftMargin=MARGIN - 6, rightMargin=MARGIN - 6, topMargin=39, bottomMargin=46,
    )
    accent = HexColor(template["header"]["accent"])
    story = []
    for name in template["order"]:
        section = _sections[name](template[name], data, accent)
        if section:
            story.extend([*section, Spacer(1, 16)])
    if data.get("terms"):
        story.extend([paragraph("Booking terms", _heading), paragraph(data["terms"], _small)])

    def page_footer(canvas, doc):
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(INK)
        canvas.drawString(MARGIN, 27, data["number"])
        canvas.drawRightString(A4[0] - MARGIN, 27, f"Page {doc.page}")

    document.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
    return stream.getvalue()


def render_preview(pdf):
    # PDFium's native API requires serialized access across Python threads.
    with _preview_lock, pypdfium2.PdfDocument(pdf) as document:
        pages = []
        for index in range(len(document)):
            stream = BytesIO()
            page = document[index]
            try:
                bitmap = page.render(scale=1.45)
                try:
                    bitmap.to_pil().save(stream, "PNG")
                finally:
                    bitmap.close()
            finally:
                page.close()
            pages.append(b64encode(stream.getvalue()).decode("ascii"))
    return pages
