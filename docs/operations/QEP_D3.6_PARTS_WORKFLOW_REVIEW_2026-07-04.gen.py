#!/usr/bin/env python3
"""
Generator for the QEP D3.6 Parts Workflow Review packet (owner-facing, fillable).

Produces an on-brand, interactive (AcroForm) PDF that Norman + Juan/Bobby can fill
in and send back to release BLK-PARTS-WF-OWNER-REVIEW (Linear QEP-100 / D3.6).

Clone of the K3.1 Finance Decision Release generator so every owner-facing packet
matches the same house format.

Requires reportlab. In Codex Desktop, run with the bundled workspace Python if
system python does not have reportlab installed.

Brand system (from docs/Brand Guide QEP.pdf):
  Quality Orange #F28705 · Charcoal #1B1B1B · Work Black #000000 · Steel Gray #8E8B88
  Gear Silver #D5D3D0 · Support Gray #B6B5B4 · Clean White #FFFFFF · Gear Brown #2E2623
  Headlines: bold condensed all-caps  ·  Body: clean sans (Inter -> Helvetica fallback)
  Tagline: "Setting a New Standard in Heavy Equipment. It's in the Name."
"""

import math
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------- brand palette
ORANGE      = HexColor("#F28705")
CHARCOAL    = HexColor("#1B1B1B")
BLACK       = HexColor("#000000")
STEEL       = HexColor("#8E8B88")
SILVER      = HexColor("#D5D3D0")
SUPPORT     = HexColor("#B6B5B4")
WHITE       = HexColor("#FFFFFF")
BROWN       = HexColor("#2E2623")
INK         = HexColor("#1B1B1B")
FIELD_FILL  = HexColor("#F6F5F3")
FIELD_LINE  = HexColor("#B6B5B4")
LIGHT_PANEL = HexColor("#F0EEEB")

PAGE_W, PAGE_H = letter          # 612 x 792
MARGIN = 46
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_Y = 34

HEAD = "Helvetica-Bold"
BODY = "Helvetica"
BODYB = "Helvetica-Bold"
BODYO = "Helvetica-Oblique"

PREPARED = "July 4, 2026"

# ---------------------------------------------------------------- primitives
def cond_text(c, x, y, text, size, color, font=HEAD, scale=0.86, tracking=0.4,
              align="left"):
    """Draw condensed all-caps-ish headline text by horizontally scaling."""
    c.saveState()
    c.setFillColor(color)
    widths = [c.stringWidth(ch, font, size) * scale + tracking for ch in text]
    total = sum(widths)
    if align == "center":
        x = x - total / 2.0
    elif align == "right":
        x = x - total
    cx = x
    for ch, w in zip(text, widths):
        c.saveState()
        c.translate(cx, y)
        c.scale(scale, 1.0)
        c.setFont(font, size)
        c.drawString(0, 0, ch)
        c.restoreState()
        cx += w
    c.restoreState()
    return total

def cond_width(c, text, size, font=HEAD, scale=0.86, tracking=0.4):
    return sum(c.stringWidth(ch, font, size) * scale + tracking for ch in text)

def gear(c, cx, cy, r, teeth, color, alpha=1.0, hole=0.45):
    c.saveState()
    c.setFillAlpha(alpha)
    c.setFillColor(color)
    tooth_h = r * 0.28
    tw = r * 0.22
    for i in range(teeth):
        a = (2 * math.pi / teeth) * i
        c.saveState()
        c.translate(cx, cy)
        c.rotate(math.degrees(a))
        c.rect(-tw / 2, r - tooth_h * 0.2, tw, tooth_h, fill=1, stroke=0)
        c.restoreState()
    c.circle(cx, cy, r, fill=1, stroke=0)
    c.setFillColor(CHARCOAL)
    c.circle(cx, cy, r * hole, fill=1, stroke=0)
    c.restoreState()

def wrap(c, text, font, size, max_w):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c.stringWidth(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def para(c, x, y, text, font, size, color, max_w, leading=None):
    leading = leading or size + 3
    c.setFont(font, size)
    c.setFillColor(color)
    for ln in wrap(c, text, font, size, max_w):
        c.drawString(x, y, ln)
        y -= leading
    return y

def footer(c, page_no):
    c.saveState()
    c.setStrokeColor(ORANGE)
    c.setLineWidth(1.4)
    c.line(MARGIN, FOOTER_Y + 12, PAGE_W - MARGIN, FOOTER_Y + 12)
    c.setFont(BODYB, 7.2)
    c.setFillColor(STEEL)
    c.drawString(MARGIN, FOOTER_Y, "QUALITY EQUIPMENT & PARTS INC.")
    c.setFont(BODY, 7.2)
    c.setFillColor(SUPPORT)
    c.drawCentredString(PAGE_W / 2, FOOTER_Y,
                        "Setting a New Standard in Heavy Equipment.")
    c.setFont(BODY, 7.2)
    c.setFillColor(STEEL)
    c.drawRightString(PAGE_W - MARGIN, FOOTER_Y, f"Prepared by BlackRock AI  ·  {page_no}")
    c.restoreState()

def small_logo(c, x, y):
    """Compact Q-gear + wordmark lockup, drawn at (x,y) baseline-ish."""
    gear(c, x + 10, y + 4, 11, 12, SILVER, hole=0.5)
    gear(c, x + 19, y + 13, 6, 10, ORANGE, hole=0.5)
    cond_text(c, x + 26, y - 2, "QUALITY", 15, WHITE, tracking=0.2)
    c.setFont(BODYB, 6.6)
    c.setFillColor(ORANGE)
    c.drawString(x + 27, y - 10, "EQUIPMENT & PARTS  INC.")

# ---------------------------------------------------------------- content model
DECISIONS = [
    dict(
        n=1, title="THE PARTS WORKFLOW STAGES",
        why="Is the path we mapped the one you'd train a new counter person on?",
        hint="Our draft order: someone asks · look it up · quote · order · pick and "
             "receive · hand off or install · invoice · returns/cores · then watch for "
             "the next need. Move or rename anything that's off.",
        evidence="",
    ),
    dict(
        n=2, title="ONE PARTS PROCESS, OR TWO?",
        why="Should the front counter and the service shop share one parts process, or "
            "keep separate ones that talk to each other?",
        hint="Today they're separate. Tell us which you want — this one drives a lot of "
             "the rest.",
        evidence="",
    ),
    dict(
        n=3, title="ORDER STATUS STAGES",
        why="What are the real status steps a counter order, a special order, and a "
            "service parts request each move through?",
        hint="Start to finish, in the words your people actually use.",
        evidence="",
    ),
    dict(
        n=4, title="QUOTES & INVOICES",
        why="How do parts quotes become invoices, and who owns that?",
        hint="A parts quote on its own, or lines on a deal quote? Who invoices it — "
             "counter, parts manager, service writer, accounting? And do we invoice parts "
             "in the new system, or keep cutting them in IntelliDealer and mirror them?",
        evidence="One sample parts invoice",
    ),
    dict(
        n=5, title="AUTO-PRICING GUARDRAIL",
        why="For prices the system updates on its own from vendor files, what change "
            "should stop and wait for a manager's OK?",
        hint="A dollar amount or a percent. Baseline pricing is already locked (list "
             "price, 35% target, 25% floor, 5% counter cap). Norman: internal work-order "
             "price still needs controller sign-off.",
        evidence="",
    ),
    dict(
        n=6, title="VENDOR CONTACTS & LOGINS",
        why="Who owns vendor contact info and the vendor portal logins, and is the "
            "machine-down escalation list ready to use?",
        hint="Name the owner for contact data and for portal credentials. Flag any "
             "escalation contacts that are still rough.",
        evidence="Vendor contact / escalation list, if one exists",
    ),
    dict(
        n=7, title="CORES, RETURNS & EXCEPTIONS",
        why="How should cores, reman exchanges, returns, substitutions, and lost sales "
            "show up day-to-day?",
        hint="The system tracks core charges and returns underneath, but there's no "
             "screen yet — tell us how a counter person should see and handle each.",
        evidence="",
    ),
    dict(
        n=8, title="VOICE ORDERING",
        why="For a spoken machine-down order, should the system place it automatically, "
            "or always stop for a person to confirm?",
        hint="Your call on whether machine-down auto-submit is wanted at all.",
        evidence="",
    ),
    dict(
        n=9, title="SCREENS THAT MUST MATCH",
        why="Before staff switch, which IntelliDealer screens or reports have to look "
            "and work exactly the same?",
        hint="Best guesses: Parts Invoicing · Price Matrix · Purchase Orders. Tell us the "
             "real must-match list vs. reference-only.",
        evidence="",
    ),
    dict(
        n=10, title="WHAT THE CUSTOMER SEES",
        why="For customers ordering parts online, which order statuses and ETA should "
            "they see?",
        hint="And should a customer move their own order from draft to submitted, or does "
             "someone here do that?",
        evidence="",
    ),
]

EXPORTS = [
    "Full 22-brand OEM + portal list",
    "Secure path to hand over portal logins",
    "Current parts kit catalog (CSV, if one exists)",
    "Parts usage history export from IntelliDealer (seeds reorder levels)",
    "Vendor contact / escalation list (if one exists)",
    "Controller sign-off on internal pricing",
    "One sample parts invoice",
]

# ---------------------------------------------------------------- pages
def page_bg_dark(c):
    c.setFillColor(CHARCOAL)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

def cover(c):
    page_bg_dark(c)
    gear(c, PAGE_W - 70, PAGE_H - 90, 54, 16, BROWN, alpha=0.55, hole=0.5)
    gear(c, PAGE_W - 18, PAGE_H - 40, 30, 12, ORANGE, alpha=0.16, hole=0.5)
    gear(c, 44, 120, 60, 16, BROWN, alpha=0.45, hole=0.5)
    gear(c, 96, 150, 26, 12, ORANGE, alpha=0.12, hole=0.5)

    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 8, PAGE_W, 8, fill=1, stroke=0)

    gx, gy = MARGIN + 28, PAGE_H - 120
    gear(c, gx, gy, 34, 14, SILVER, hole=0.5)
    gear(c, gx + 26, gy + 30, 17, 12, ORANGE, hole=0.5)
    cond_text(c, gx + 52, gy - 12, "QUALITY", 44, WHITE, tracking=0.3)
    c.setFont(BODYB, 15)
    c.setFillColor(ORANGE)
    c.drawString(gx + 55, gy - 30, "EQUIPMENT & PARTS   INC.")

    y = PAGE_H - 250
    c.setFillColor(ORANGE)
    c.rect(MARGIN, y + 30, 46, 4, fill=1, stroke=0)
    c.setFont(BODYB, 11)
    c.setFillColor(SILVER)
    c.drawString(MARGIN, y + 12, "PARTS  ·  WORKFLOW  ·  OWNER REVIEW")

    cond_text(c, MARGIN, y - 34, "PARTS WORKFLOW", 52, WHITE, tracking=0.4)
    cond_text(c, MARGIN, y - 90, "REVIEW PACKET", 52, ORANGE, tracking=0.4)

    yy = y - 122
    yy = para(c, MARGIN, yy,
              "Ten decisions from Norman and Juan to sign off the parts workflow — the "
              "last thing gating D3.6. Everything here is how the counter and shop "
              "actually run, in plain terms — no software knowledge needed.",
              BODY, 11.5, SUPPORT, CONTENT_W - 40, leading=16)

    by = 208
    c.setFillColor(BLACK)
    c.roundRect(MARGIN, by, CONTENT_W, 74, 8, fill=1, stroke=0)
    c.setStrokeColor(ORANGE)
    c.setLineWidth(1.2)
    c.roundRect(MARGIN, by, CONTENT_W, 74, 8, fill=0, stroke=1)
    c.setFont(BODYB, 9)
    c.setFillColor(ORANGE)
    c.drawString(MARGIN + 16, by + 52, "WHAT THIS RELEASES")
    para(c, MARGIN + 16, by + 36,
         "One thing gates the parts workflow: owner review (BLK-PARTS-WF-OWNER-REVIEW). "
         "Skim the workflow write-up, then fill the answer boxes here — type in the PDF "
         "or print and write — and D3.6 can ship.",
         BODY, 9.5, SILVER, CONTENT_W - 32, leading=13)

    c.setFillColor(ORANGE)
    c.rect(0, 120, PAGE_W, 2, fill=1, stroke=0)
    c.setFont(BODYB, 9)
    c.setFillColor(WHITE)
    c.drawString(MARGIN, 96, "FOR:  Norman (Parts Manager)  ·  Juan / Bobby (Parts Counter)")
    c.setFont(BODY, 9)
    c.setFillColor(SUPPORT)
    c.drawString(MARGIN, 80, f"FROM:  BlackRock AI (Brian Lewis)        PREPARED:  {PREPARED}")
    c.setFont(BODY, 9)
    c.setFillColor(STEEL)
    c.drawString(MARGIN, 60, "qepusa.com   ·   Lake City, FL  ·  Ocala, FL")

    c.setFillColor(ORANGE)
    c.rect(0, 0, PAGE_W, 6, fill=1, stroke=0)
    c.showPage()

def context_page(c):
    page_bg_dark(c)
    c.setFillColor(BLACK)
    c.rect(0, PAGE_H - 96, PAGE_W, 96, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 100, PAGE_W, 4, fill=1, stroke=0)
    small_logo(c, MARGIN, PAGE_H - 54)
    cond_text(c, PAGE_W - MARGIN, PAGE_H - 60, "START HERE", 30, WHITE,
              tracking=0.4, align="right")

    y = PAGE_H - 128
    c.setFillColor(ORANGE)
    c.rect(MARGIN, y, 5, 18, fill=1, stroke=0)
    cond_text(c, MARGIN + 14, y + 3, "ALREADY DECIDED — PLEASE DON'T REOPEN", 17, WHITE)
    y -= 18
    box_h = 96
    c.setFillColor(BLACK)
    c.roundRect(MARGIN, y - box_h, CONTENT_W, box_h, 7, fill=1, stroke=0)
    c.setStrokeColor(HexColor("#3a3a3a"))
    c.roundRect(MARGIN, y - box_h, CONTENT_W, box_h, 7, fill=0, stroke=1)
    items = [
        ("Parts pricing is set from the last round —",
         "list price, 35% target margin, 25% floor, 5% counter discount, manager above that."),
        ("This packet reviews the workflow write-up,",
         "confirming how parts actually flow. It is not a re-vote on pricing."),
        ("The system is already built —",
         "we're checking it against the floor, not starting over."),
    ]
    iy = y - 16
    for a, b in items:
        c.setFillColor(ORANGE)
        c.circle(MARGIN + 18, iy + 1, 2.4, fill=1, stroke=0)
        c.setFont(BODYB, 9.5)
        c.setFillColor(WHITE)
        c.drawString(MARGIN + 28, iy - 1, a)
        c.setFont(BODY, 9.5)
        c.setFillColor(SUPPORT)
        c.drawString(MARGIN + 28, iy - 13, b)
        iy -= 28
    y -= box_h + 26

    c.setFillColor(ORANGE)
    c.rect(MARGIN, y, 5, 18, fill=1, stroke=0)
    cond_text(c, MARGIN + 14, y + 3, "HOW TO USE THIS PACKET", 17, WHITE)
    y -= 24
    steps = [
        "First, skim the parts workflow write-up Brian sent. Mark anything that doesn't "
        "match how the floor really runs.",
        "Then answer the ten decisions here in your own words. Rough answers are fine — "
        "\"I need to check\" or \"we don't do that\" are real answers.",
        "For each one, mark whether you can answer it now, or would rather settle it in a "
        "short working session with our team.",
        "You can type directly into the boxes in this PDF, or print it and write. Either "
        "way, send it back and D3.6 ships.",
    ]
    for i, s in enumerate(steps, 1):
        c.setFillColor(ORANGE)
        c.circle(MARGIN + 8, y - 2, 8.5, fill=1, stroke=0)
        c.setFont(BODYB, 9)
        c.setFillColor(BLACK)
        c.drawCentredString(MARGIN + 8, y - 5, str(i))
        ny = para(c, MARGIN + 26, y - 3, s, BODY, 9.6, SILVER, CONTENT_W - 30, leading=13)
        y = ny - 8

    y -= 2
    c.setStrokeColor(HexColor("#3a3a3a"))
    c.setLineWidth(1)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= 20
    c.setFont(BODYB, 9)
    c.setFillColor(ORANGE)
    c.drawString(MARGIN, y, "IN EACH DECISION:")
    c.setFont(BODY, 9)
    c.setFillColor(SUPPORT)
    c.drawString(MARGIN + 108, y,
                 "a plain-language question  ·  an answer box  ·  a quick "
                 "\"note now / working session\" choice.")

    footer(c, "02")
    c.showPage()

def content_header(c, title, page_no):
    c.setFillColor(WHITE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(CHARCOAL)
    c.rect(0, PAGE_H - 64, PAGE_W, 64, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 68, PAGE_W, 4, fill=1, stroke=0)
    gear(c, MARGIN + 8, PAGE_H - 32, 10, 12, SILVER, hole=0.5)
    gear(c, MARGIN + 15, PAGE_H - 24, 5.5, 10, ORANGE, hole=0.5)
    cond_text(c, MARGIN + 28, PAGE_H - 40, "PARTS WORKFLOW REVIEW", 15, WHITE)
    cond_text(c, PAGE_W - MARGIN, PAGE_H - 40, title, 15, ORANGE,
              tracking=0.3, align="right")
    footer(c, page_no)

def decision_card(c, d, top):
    """Draw one decision starting at y=top; return new y (bottom)."""
    x = MARGIN
    c.setFillColor(ORANGE)
    c.roundRect(x, top - 26, 30, 26, 5, fill=1, stroke=0)
    c.setFont(HEAD, 15)
    c.setFillColor(WHITE)
    c.drawCentredString(x + 15, top - 20, str(d["n"]))
    cond_text(c, x + 40, top - 20, d["title"], 15.5, INK, tracking=0.2)
    y = top - 40
    y = para(c, x + 40, y, d["why"], BODYB, 10, INK, CONTENT_W - 40, leading=13)
    y -= 2
    y = para(c, x + 40, y, d["hint"], BODY, 9, HexColor("#5f5f5c"),
             CONTENT_W - 40, leading=12)
    y -= 8

    fh = 104
    c.acroForm.textfield(
        name=f"answer_{d['n']}",
        tooltip=f"Your answer — decision {d['n']}",
        x=x, y=y - fh, width=CONTENT_W, height=fh,
        borderStyle="solid", borderWidth=1,
        borderColor=FIELD_LINE, fillColor=FIELD_FILL, textColor=INK,
        fontName=BODY, fontSize=10, fieldFlags="multiline", forceBorder=True,
    )
    c.setFont(BODYB, 7)
    c.setFillColor(ORANGE)
    c.drawString(x + 4, y - 11, "YOUR ANSWER")
    y -= fh + 8

    cb_y = y
    c.acroForm.checkbox(
        name=f"note_now_{d['n']}", tooltip="I can answer this now",
        x=x, y=cb_y - 12, size=12, checked=False,
        borderColor=FIELD_LINE, fillColor=WHITE, textColor=ORANGE,
        borderWidth=1, forceBorder=True,
    )
    c.setFont(BODY, 9)
    c.setFillColor(INK)
    c.drawString(x + 18, cb_y - 10, "I can answer this now")
    c.acroForm.checkbox(
        name=f"session_{d['n']}", tooltip="Better in a working session",
        x=x + 200, y=cb_y - 12, size=12, checked=False,
        borderColor=FIELD_LINE, fillColor=WHITE, textColor=ORANGE,
        borderWidth=1, forceBorder=True,
    )
    c.setFont(BODY, 9)
    c.setFillColor(INK)
    c.drawString(x + 218, cb_y - 10, "Better in a working session")
    y = cb_y - 20
    if d.get("evidence"):
        c.setFont(BODYO, 8.4)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x, y - 8, f"Helpful file to attach:  {d['evidence']}")
        y -= 18
    else:
        y -= 4
    c.setStrokeColor(HexColor("#e4e2de"))
    c.setLineWidth(1)
    c.line(x, y, PAGE_W - MARGIN, y)
    return y - 14

def decisions_pages(c):
    page_no = 3
    idx = 0
    while idx < len(DECISIONS):
        content_header(c, "YOUR DECISIONS", f"{page_no:02d}")
        y = PAGE_H - 92
        per = 0
        while idx < len(DECISIONS) and per < 2:
            y = decision_card(c, DECISIONS[idx], y)
            idx += 1
            per += 1
        c.showPage()
        page_no += 1
    return page_no

def exports_signoff_page(c, page_no):
    content_header(c, "DOCUMENTS & SIGN-OFF", f"{page_no:02d}")
    x = MARGIN
    y = PAGE_H - 92

    c.setFillColor(ORANGE)
    c.rect(x, y, 5, 18, fill=1, stroke=0)
    cond_text(c, x + 14, y + 3, "DOCUMENTS & INPUTS WE STILL NEED", 16, INK)
    y -= 16
    y = para(c, x + 14, y,
             "Attach what's handy now; for anything missing, just name who owns it. "
             "Tick the box when it's on the way.",
             BODY, 9, HexColor("#5f5f5c"), CONTENT_W - 20, leading=12)
    y -= 10

    row_h = 23
    for i, item in enumerate(EXPORTS):
        if i % 2 == 0:
            c.setFillColor(LIGHT_PANEL)
            c.rect(x, y - row_h + 6, CONTENT_W, row_h, fill=1, stroke=0)
        c.acroForm.checkbox(
            name=f"exp_{i}", tooltip=item,
            x=x + 6, y=y - 6, size=12, checked=False,
            borderColor=FIELD_LINE, fillColor=WHITE, textColor=ORANGE,
            borderWidth=1, forceBorder=True,
        )
        c.setFont(BODY, 9.6)
        c.setFillColor(INK)
        c.drawString(x + 26, y - 4, item)
        c.setFont(BODYB, 7)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x + 360, y - 4, "OWNER:")
        c.acroForm.textfield(
            name=f"exp_owner_{i}", tooltip=f"Who owns: {item}",
            x=x + 396, y=y - 8, width=CONTENT_W - 396 - 4, height=15,
            borderStyle="underlined", borderWidth=1,
            borderColor=FIELD_LINE, fillColor=WHITE, textColor=INK,
            fontName=BODY, fontSize=9, forceBorder=True,
        )
        y -= row_h

    y -= 14
    c.setFillColor(ORANGE)
    c.rect(x, y, 5, 18, fill=1, stroke=0)
    cond_text(c, x + 14, y + 3, "SIGN-OFF", 16, INK)
    y -= 30

    def sig(label, who, yy):
        c.setFont(BODYB, 9)
        c.setFillColor(INK)
        c.drawString(x, yy + 20, who)
        c.setFont(BODY, 8)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x, yy + 8, "reviewer")
        c.acroForm.textfield(
            name=f"sig_{label}", tooltip=f"{who} — name",
            x=x + 150, y=yy + 6, width=210, height=18,
            borderStyle="underlined", borderColor=FIELD_LINE, fillColor=WHITE,
            textColor=INK, fontName=BODY, fontSize=10, forceBorder=True,
        )
        c.acroForm.textfield(
            name=f"date_{label}", tooltip="Date",
            x=x + 378, y=yy + 6, width=CONTENT_W - 378, height=18,
            borderStyle="underlined", borderColor=FIELD_LINE, fillColor=WHITE,
            textColor=INK, fontName=BODY, fontSize=10, forceBorder=True,
        )
        c.setFont(BODY, 7)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x + 150, yy - 2, "signature / name")
        c.drawString(x + 378, yy - 2, "date")

    sig("manager", "Norman — Parts Manager", y)
    y -= 44
    sig("counter", "Juan / Bobby — Parts Counter", y)

    y -= 40
    c.setFillColor(CHARCOAL)
    c.roundRect(x, y - 34, CONTENT_W, 40, 6, fill=1, stroke=0)
    c.setFont(BODY, 8.4)
    c.setFillColor(SUPPORT)
    para(c, x + 12, y - 8,
         "Quality Equipment & Parts Inc. is a family-owned equipment dealership serving "
         "forestry, land clearing, construction, and material handling from Lake City "
         "and Ocala, Florida.  ·  qepusa.com",
         BODY, 8.4, SUPPORT, CONTENT_W - 24, leading=11)

    footer(c, f"{page_no:02d}")
    c.showPage()

def build(path):
    c = canvas.Canvas(path, pagesize=letter)
    c.setTitle("QEP Parts Workflow Review — D3.6 Owner Sign-Off")
    c.setAuthor("BlackRock AI (Brian Lewis)")
    c.setSubject("Owner decisions to release BLK-PARTS-WF-OWNER-REVIEW (QEP-100 / D3.6)")
    cover(c)
    context_page(c)
    next_no = decisions_pages(c)
    exports_signoff_page(c, next_no)
    c.save()

if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "QEP_D3.6_PARTS_WORKFLOW_REVIEW_2026-07-04.pdf"
    build(out)
    print("wrote", out)
