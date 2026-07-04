#!/usr/bin/env python3
"""
Generator for the QEP K3.1 Finance Decision Release packet (owner-facing, fillable).

Produces an on-brand, interactive (AcroForm) PDF that Ryan + Tina can fill in and
send back to release BLK-FIN-MIGRATION-PATH (Linear QEP-223 / K3.1).

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
    # measure at scaled width
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
    # hole
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
        n=1, title="SHARED COST ALLOCATION",
        why="How should company-wide costs (paid once for the whole business) be "
            "divided among the branches?",
        hint="Pick a basis: branch sales/revenue · headcount · transaction volume · "
             "fixed percentages · other. Note the split if you already use one.",
        evidence="P&L / balance sheet, or your current allocation schedule",
    ),
    dict(
        n=2, title="EQUIPMENT DEPRECIATION",
        why="How do you want depreciation figured and posted for equipment you own, "
            "including the rental fleet?",
        hint="Method and schedule (e.g., straight-line, tax book), how often it posts, "
             "and which department carries the expense.",
        evidence="Per-unit depreciation schedule",
    ),
    dict(
        n=3, title="FLOOR-PLAN / LENDER TERMS  +  IBS",
        why="Your floor-plan (inventory financing) terms for each lender, and how the "
            "Interstate Billing Service (IBS) arrangement is treated.",
        hint="Lenders: Wells Fargo · Bank of Oklahoma · Northpoint Financial · "
             "Incredible Bank · US Bank · Mitsubishi Finance. For IBS, is it "
             "floor-plan, factoring, or rental-receivable assignment?",
        evidence="Floor-plan curtailment schedules / lender terms; an IBS sample or agreement",
    ),
    dict(
        n=4, title="CPA ADJUSTMENTS",
        why="When your CPA sends quarter-end or year-end adjustments, where should "
            "those entries post in the new system?",
        hint="Current period, or back to the original (source) period? Who approves a "
             "reopen if one is needed?",
        evidence="A CPA adjustment example or a quarter-end package",
    ),
    dict(
        n=5, title="OPEN SERVICE WORK ORDERS AT CUTOVER",
        why="When we switch over, how should unfinished (open) service work orders "
            "carry into the new system?",
        hint="Finish all open ones in IntelliDealer · move all to QEP OS · or split by "
             "status. Please also confirm the planned cutover date.",
        evidence="Open work-order list + WIP (work-in-progress) report at planning date",
    ),
    dict(
        n=6, title="INVOICE NUMBERING & STARTING NUMBERS",
        why="What invoice-number format and starting numbers should each "
            "branch/department use, so new numbers never overlap old ones?",
        hint="You mentioned 5 digits. Confirm the width and give a starting number for "
             "each branch/department prefix.",
        evidence="Current invoice number ranges by branch/department",
    ),
    dict(
        n=7, title="MATCHING CUSTOMERS & VENDORS",
        why="How should we match customer and vendor records between the old and new "
            "systems so nothing duplicates?",
        hint="Key on the IntelliDealer account number? Keep it as a permanent "
             "cross-reference, or use it as the main ID? How to handle missing or "
             "duplicate numbers.",
        evidence="Customer master export + vendor master export",
    ),
    dict(
        n=8, title="FINANCE CHARGES & COLLECTIONS",
        why="How do you calculate and post finance charges on past-due accounts, and "
            "what is your reminder / collection (dunning) process?",
        hint="Principal only or compounding · monthly rate · lawful cap · statement day "
             "· reminder timing · when an account goes on auto-hold.",
        evidence="Current AR aging; a statement or finance-charge sample if one exists",
    ),
    dict(
        n=9, title="BANK ACCOUNTS & QUICKBOOKS OUTPUT",
        why="List your bank accounts, and tell us exactly what QuickBooks Desktop must "
            "still produce once the new system is your main books.",
        hint="Bank accounts (and whether cash is tracked separately by branch). What QB "
             "still outputs (check register, CPA export) and the exact QB Desktop version.",
        evidence="Chart of accounts; a sample QuickBooks output (check register / CPA export)",
    ),
    dict(
        n=10, title="DEPOSITS & RENTAL SECURITY DEPOSITS",
        why="How should customer deposits and rental security deposits be tracked and "
            "reconciled each month?",
        hint="Which liability accounts they sit in, whether they reconcile at monthly "
             "balance, and how a deposit is applied or refunded.",
        evidence="Deposit / rental-deposit reconciliation report; deposit liability accounts",
    ),
]

EXPORTS = [
    "Current chart of accounts",
    "Recent P&L + balance sheet",
    "AR aging",
    "AP aging",
    "Customer master export",
    "Vendor master export",
    "Floor-plan schedules + lender terms",
    "CPA adjustment example / quarter-end package",
    "Open work orders + WIP report",
    "Current invoice numbers by branch / department",
    "QuickBooks Desktop version + a sample output",
    "Deposit / rental-deposit reconciliation report",
    "One sample parts invoice",
]

# ---------------------------------------------------------------- pages
def page_bg_dark(c):
    c.setFillColor(CHARCOAL)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

def cover(c):
    page_bg_dark(c)
    # subtle hex/gear motif
    gear(c, PAGE_W - 70, PAGE_H - 90, 54, 16, BROWN, alpha=0.55, hole=0.5)
    gear(c, PAGE_W - 18, PAGE_H - 40, 30, 12, ORANGE, alpha=0.16, hole=0.5)
    gear(c, 44, 120, 60, 16, BROWN, alpha=0.45, hole=0.5)
    gear(c, 96, 150, 26, 12, ORANGE, alpha=0.12, hole=0.5)

    # top orange rule
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 8, PAGE_W, 8, fill=1, stroke=0)

    # logo lockup
    gx, gy = MARGIN + 28, PAGE_H - 120
    gear(c, gx, gy, 34, 14, SILVER, hole=0.5)
    gear(c, gx + 26, gy + 30, 17, 12, ORANGE, hole=0.5)
    cond_text(c, gx + 52, gy - 12, "QUALITY", 44, WHITE, tracking=0.3)
    c.setFont(BODYB, 15)
    c.setFillColor(ORANGE)
    c.drawString(gx + 55, gy - 30, "EQUIPMENT & PARTS   INC.")

    # eyebrow
    y = PAGE_H - 250
    c.setFillColor(ORANGE)
    c.rect(MARGIN, y + 30, 46, 4, fill=1, stroke=0)
    c.setFont(BODYB, 11)
    c.setFillColor(SILVER)
    c.drawString(MARGIN, y + 12, "FINANCE  ·  SYSTEM CUTOVER  ·  OWNER DECISIONS")

    # title
    cond_text(c, MARGIN, y - 34, "FINANCE DECISION", 52, WHITE, tracking=0.4)
    cond_text(c, MARGIN, y - 90, "RELEASE PACKET", 52, ORANGE, tracking=0.4)

    # deck
    yy = y - 122
    yy = para(c, MARGIN,
              yy,
              "Ten decisions from Ryan and Tina to clear the last hold on QEP's "
              "new accounting system. Everything here is a business decision only "
              "the owners can make — no software knowledge needed.",
              BODY, 11.5, SUPPORT, CONTENT_W - 40, leading=16)

    # one-blocker chip
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
         "One item is holding up finance: the migration path (BLK-FIN-MIGRATION-PATH). "
         "Fill the answer boxes in this packet — type directly in the PDF or print and "
         "write — and finance moves.",
         BODY, 9.5, SILVER, CONTENT_W - 32, leading=13)

    # prepared-for band
    c.setFillColor(ORANGE)
    c.rect(0, 120, PAGE_W, 2, fill=1, stroke=0)
    c.setFont(BODYB, 9)
    c.setFillColor(WHITE)
    c.drawString(MARGIN, 96, "FOR:  Ryan McKenzie (Owner)  ·  Tina McKenzie (VP & Controller)")
    c.setFont(BODY, 9)
    c.setFillColor(SUPPORT)
    c.drawString(MARGIN, 80, f"FROM:  BlackRock AI (Brian Lewis)        PREPARED:  {PREPARED}")
    c.setFont(BODY, 9)
    c.setFillColor(STEEL)
    c.drawString(MARGIN, 60, "qepusa.com   ·   Lake City, FL  ·  Ocala, FL")

    # bottom orange wedge
    c.setFillColor(ORANGE)
    c.rect(0, 0, PAGE_W, 6, fill=1, stroke=0)
    c.showPage()

def context_page(c):
    page_bg_dark(c)
    # header band
    c.setFillColor(BLACK)
    c.rect(0, PAGE_H - 96, PAGE_W, 96, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 100, PAGE_W, 4, fill=1, stroke=0)
    small_logo(c, MARGIN, PAGE_H - 54)
    cond_text(c, PAGE_W - MARGIN, PAGE_H - 60, "START HERE", 30, WHITE,
              tracking=0.4, align="right")

    # ALREADY DECIDED panel
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
        ("The new system (QEP OS) becomes QEP's main books",
         "going forward — for money owed to you, money you owe, and reporting."),
        ("IntelliDealer stays the day-to-day system during the switch,",
         "until each piece is moved over. Nothing gets dropped."),
        ("QuickBooks Desktop shrinks to paying vendors, the cash/check",
         "register, and CPA reporting. It is no longer the main ledger."),
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

    # HOW THIS WORKS
    c.setFillColor(ORANGE)
    c.rect(MARGIN, y, 5, 18, fill=1, stroke=0)
    cond_text(c, MARGIN + 14, y + 3, "HOW TO USE THIS PACKET", 17, WHITE)
    y -= 24
    steps = [
        "Answer in your own words. Rough answers are fine — \"I need to check\" or "
        "\"we don't do that\" are real, useful answers.",
        "For each decision, mark whether you can answer it by note now, or would rather "
        "settle it in a short working session with our team.",
        "Where an item asks for a file or export, just note who has it. Use the checklist "
        "on the last page.",
        "You can type directly into the boxes in this PDF, or print it and write. Either way, "
        "send it back and finance is unblocked.",
    ]
    for i, s in enumerate(steps, 1):
        c.setFillColor(ORANGE)
        c.circle(MARGIN + 8, y - 2, 8.5, fill=1, stroke=0)
        c.setFont(BODYB, 9)
        c.setFillColor(BLACK)
        c.drawCentredString(MARGIN + 8, y - 5, str(i))
        ny = para(c, MARGIN + 26, y - 3, s, BODY, 9.6, SILVER, CONTENT_W - 30, leading=13)
        y = ny - 8

    # legend line for the answer widgets
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
    # top band
    c.setFillColor(CHARCOAL)
    c.rect(0, PAGE_H - 64, PAGE_W, 64, fill=1, stroke=0)
    c.setFillColor(ORANGE)
    c.rect(0, PAGE_H - 68, PAGE_W, 4, fill=1, stroke=0)
    gear(c, MARGIN + 8, PAGE_H - 32, 10, 12, SILVER, hole=0.5)
    gear(c, MARGIN + 15, PAGE_H - 24, 5.5, 10, ORANGE, hole=0.5)
    cond_text(c, MARGIN + 28, PAGE_H - 40, "FINANCE DECISION RELEASE", 15, WHITE)
    cond_text(c, PAGE_W - MARGIN, PAGE_H - 40, title, 15, ORANGE,
              tracking=0.3, align="right")
    footer(c, page_no)

def decision_card(c, d, top):
    """Draw one decision starting at y=top; return new y (bottom)."""
    x = MARGIN
    # number badge
    c.setFillColor(ORANGE)
    c.roundRect(x, top - 26, 30, 26, 5, fill=1, stroke=0)
    c.setFont(HEAD, 15)
    c.setFillColor(WHITE)
    c.drawCentredString(x + 15, top - 20, str(d["n"]))
    # title
    cond_text(c, x + 40, top - 20, d["title"], 15.5, INK, tracking=0.2)
    y = top - 40
    # why
    y = para(c, x + 40, y, d["why"], BODYB, 10, INK, CONTENT_W - 40, leading=13)
    # hint
    y -= 2
    y = para(c, x + 40, y, d["hint"], BODY, 9, HexColor("#5f5f5c"),
             CONTENT_W - 40, leading=12)
    y -= 8

    # answer field
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

    # choice checkboxes
    cb_y = y
    c.acroForm.checkbox(
        name=f"note_now_{d['n']}", tooltip="I can answer this by note now",
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
    # evidence note on its own line
    if d.get("evidence"):
        c.setFont(BODYO, 8.4)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x, y - 8, f"Helpful file to attach:  {d['evidence']}")
        y -= 18
    else:
        y -= 4
    # divider
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
        # place as many as fit (about 2 per page)
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
    cond_text(c, x + 14, y + 3, "DOCUMENTS & EXPORTS WE STILL NEED", 16, INK)
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
        # owner field
        c.setFont(BODYB, 7)
        c.setFillColor(HexColor("#7a7a76"))
        c.drawString(x + 300, y - 4, "OWNER:")
        c.acroForm.textfield(
            name=f"exp_owner_{i}", tooltip=f"Who owns: {item}",
            x=x + 336, y=y - 8, width=CONTENT_W - 336 - 4, height=15,
            borderStyle="underlined", borderWidth=1,
            borderColor=FIELD_LINE, fillColor=WHITE, textColor=INK,
            fontName=BODY, fontSize=9, forceBorder=True,
        )
        y -= row_h

    y -= 14
    # sign-off
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
        c.drawString(x, yy + 8, label)
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

    sig("owner", "Ryan McKenzie — Owner", y)
    y -= 44
    sig("controller", "Tina McKenzie — VP & Controller", y)

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
    c.setTitle("QEP Finance Decision Release — K3.1 Migration Path")
    c.setAuthor("BlackRock AI (Brian Lewis)")
    c.setSubject("Owner decisions to release BLK-FIN-MIGRATION-PATH (QEP-223 / K3.1)")
    cover(c)
    context_page(c)
    next_no = decisions_pages(c)
    exports_signoff_page(c, next_no)
    c.save()

if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "QEP_K3.1_FINANCE_DECISION_RELEASE_2026-07-04.pdf"
    build(out)
    print("wrote", out)
