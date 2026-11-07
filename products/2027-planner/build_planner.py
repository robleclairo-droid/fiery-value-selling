"""Original 2027 printable planner generator (US Letter PDF). All art is drawn in code; only built-in Helvetica/Times fonts."""
import calendar, datetime as dt, sys
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

W, H = 612, 792
M = 40
INK = HexColor("#2F3B34"); SAGE = HexColor("#7C9A87"); SAGE_L = HexColor("#E3ECE5")
CREAM = HexColor("#FAF7F1"); CLAY = HexColor("#C8825F"); LINE = HexColor("#C9D3CB"); MUTE = HexColor("#7A857D")
YEAR = 2027
MONTHS = [calendar.month_name[i] for i in range(1, 13)]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
calendar.setfirstweekday(0)

out = sys.argv[1] if len(sys.argv) > 1 else "2027-Minimalist-Planner.pdf"
c = canvas.Canvas(out, pagesize=(W, H))
c.setTitle("2027 Minimalist Printable Planner"); c.setAuthor("Original design")
bookmarks = {}

def page_bg():
    c.setFillColor(CREAM); c.rect(0, 0, W, H, stroke=0, fill=1)

def header(title, sub=None, key=None):
    page_bg()
    if key:
        c.bookmarkPage(key); c.addOutlineEntry(title, key, level=0)
    c.setFillColor(INK); c.setFont("Times-Roman", 28); c.drawString(M, H - 62, title)
    if sub:
        c.setFillColor(MUTE); c.setFont("Helvetica", 10); c.drawString(M, H - 80, sub.upper())
    c.setStrokeColor(SAGE); c.setLineWidth(1.5); c.line(M, H - 92, W - M, H - 92)

def footer(n=None):
    c.setFillColor(MUTE); c.setFont("Helvetica", 8)
    c.drawString(M, 24, "2027 Minimalist Planner")
    c.drawRightString(W - M, 24, "Home" )
    c.linkRect("", "idx", (W - M - 30, 18, W - M, 34), relative=0)

def lines(x, y, w, n, gap=22, color=LINE):
    c.setStrokeColor(color); c.setLineWidth(0.5)
    for i in range(n): c.line(x, y - i * gap, x + w, y - i * gap)

def box(x, y, w, h, label=None, fill=None):
    c.setStrokeColor(LINE); c.setLineWidth(0.8)
    if fill: c.setFillColor(fill)
    c.roundRect(x, y, w, h, 4, stroke=1, fill=1 if fill else 0)
    if label:
        c.setFillColor(SAGE); c.setFont("Helvetica-Bold", 8); c.drawString(x + 8, y + h - 14, label.upper())

def mini_cal(x, y, w, month):
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 9); c.drawString(x, y, MONTHS[month - 1].upper())
    cw = w / 7
    c.setFont("Helvetica", 6.5); c.setFillColor(MUTE)
    for i, d in enumerate(DAYS): c.drawCentredString(x + cw * i + cw / 2, y - 12, d[0])
    c.setFillColor(INK); c.setFont("Helvetica", 7.5)
    for r, wk in enumerate(calendar.monthcalendar(YEAR, month)):
        for i, d in enumerate(wk):
            if d: c.drawCentredString(x + cw * i + cw / 2, y - 25 - r * 12, str(d))
    c.linkRect("", f"m{month}", (x, y - 95, x + w, y + 10), relative=0)

# ---------- cover ----------
page_bg()
c.setFillColor(SAGE_L); c.circle(W * 0.78, H * 0.72, 190, stroke=0, fill=1)
c.setFillColor(CLAY); c.circle(W * 0.2, H * 0.2, 54, stroke=0, fill=1)
c.setFillColor(SAGE); c.circle(W * 0.3, H * 0.2 + 30, 26, stroke=0, fill=1)
c.setFillColor(INK); c.setFont("Times-Roman", 96); c.drawString(M + 10, H * 0.55, str(YEAR))
c.setFont("Helvetica", 14); c.drawString(M + 14, H * 0.55 - 34, "M I N I M A L I S T   P L A N N E R")
c.setFillColor(MUTE); c.setFont("Helvetica", 10)
c.drawString(M + 14, H * 0.55 - 58, "Monthly · Weekly · Habits · Mood · Budget · Goals")
c.drawString(M + 14, H * 0.55 - 74, "Hyperlinked  ·  Print-ready US Letter")
c.showPage()

# ---------- index ----------
header("Contents", "Tap any item to jump", "idx")
items = [("Year at a glance", "year"), ("Yearly goals", "goals"), ("Habit tracker", "habit1"), ("Year in pixels (mood)", "pix"),
         ("Budget & savings", "budget"), ("Reading log", "read"), ("Notes", "notes")]
y = H - 130
c.setFont("Helvetica", 12)
for label, key in items:
    c.setFillColor(INK); c.drawString(M, y, label); c.linkRect("", key, (M, y - 4, W - M, y + 14), relative=0)
    c.setStrokeColor(LINE); c.line(M, y - 6, W - M, y - 6); y -= 28
y -= 10; c.setFillColor(SAGE); c.setFont("Helvetica-Bold", 9); c.drawString(M, y, "MONTHS"); y -= 22
for i in range(12):
    col, row = i % 4, i // 4
    c.setFillColor(INK); c.setFont("Helvetica", 11)
    x = M + col * 130; yy = y - row * 24
    c.drawString(x, yy, MONTHS[i]); c.linkRect("", f"m{i+1}", (x, yy - 4, x + 120, yy + 12), relative=0)
y -= 100; c.setFillColor(SAGE); c.setFont("Helvetica-Bold", 9); c.drawString(M, y, "HOW TO USE"); y -= 18
c.setFillColor(INK); c.setFont("Helvetica", 10)
for t in ["1. Start with Yearly goals: pick 3 themes, not 30 resolutions.",
          "2. Each month: fill the calendar, choose 3 priorities, then plan the weeks.",
          "3. Each week: pick a 'big 3' and let the rest be flexible.",
          "4. Print at 100% / Actual size on US Letter. Works on iPad in any PDF annotator.",]:
    c.drawString(M, y, t); y -= 16
c.showPage()

# ---------- year at a glance ----------
header("2027 at a glance", None, "year")
for m in range(1, 13):
    col, row = (m - 1) % 3, (m - 1) // 3
    mini_cal(M + col * 175, H - 125 - row * 150, 155, m)
footer(); c.showPage()

# ---------- goals ----------
header("Yearly goals", "What matters most in 2027", "goals")
box(M, H - 250, W - 2 * M, 140, "My three themes")
lines(M + 12, H - 150, W - 2 * M - 24, 4, 28)
for i, t in enumerate(["Health & energy", "Money & work", "Joy & relationships"]):
    pass
y0 = H - 270
for i, t in enumerate(["Goal 1", "Goal 2", "Goal 3"]):
    box(M + i * 175, 150, 165, y0 - 150, t)
    lines(M + i * 175 + 10, y0 - 34, 145, 16, 22)
footer(); c.showPage()

# ---------- monthly ----------
for m in range(1, 13):
    header(f"{MONTHS[m-1]} {YEAR}", "Monthly overview", f"m{m}")
    gx, gy, gw = M, H - 108, W - 2 * M
    cw = gw / 7; weeks = calendar.monthcalendar(YEAR, m); rh = 72
    for i, d in enumerate(DAYS):
        c.setFillColor(SAGE); c.rect(gx + i * cw, gy - 18, cw, 18, stroke=0, fill=1)
        c.setFillColor(CREAM); c.setFont("Helvetica-Bold", 8); c.drawCentredString(gx + i * cw + cw / 2, gy - 13, d.upper())
    for r, wk in enumerate(weeks):
        for i, d in enumerate(wk):
            x, yb = gx + i * cw, gy - 18 - (r + 1) * rh
            c.setStrokeColor(LINE); c.setLineWidth(0.6); c.setFillColor(SAGE_L if i >= 5 else CREAM)
            c.rect(x, yb, cw, rh, stroke=1, fill=1)
            if d:
                c.setFillColor(INK); c.setFont("Helvetica", 9); c.drawString(x + 5, yb + rh - 13, str(d))
    by = gy - 18 - 6 * rh - 14
    bh = by - 50
    box(M, 50, (W - 2 * M) / 2 - 6, bh, "Top 3 priorities"); lines(M + 10, 50 + bh - 34, (W - 2 * M) / 2 - 26, int((bh - 30) // 24), 24)
    box(M + (W - 2 * M) / 2 + 6, 50, (W - 2 * M) / 2 - 6, bh, "Notes"); lines(M + (W - 2 * M) / 2 + 16, 50 + bh - 34, (W - 2 * M) / 2 - 26, int((bh - 30) // 24), 24)
    footer(); c.showPage()

# ---------- weekly ----------
d0 = dt.date(2026, 12, 28)
while d0 < dt.date(2028, 1, 1):
    d1 = d0 + dt.timedelta(days=6)
    label = f"{d0.strftime('%b %-d')} – {d1.strftime('%b %-d')}" if d0.month != d1.month else f"{d0.strftime('%b %-d')} – {d1.strftime('%-d')}"
    wk = d0.isocalendar()[1] if d0.year != 2026 else 53
    header(f"Week {wk}", f"{label}, {d1.year}")
    colw = (W - 2 * M - 12) / 2; top = H - 110
    box(M, top - 70, W - 2 * M, 70, "Big 3 this week")
    lines(M + 10, top - 34, W - 2 * M - 20, 2, 18)
    cell_h = 120
    for i in range(7):
        dd = d0 + dt.timedelta(days=i)
        col, row = i % 2, i // 2
        x = M + col * (colw + 12); yb = top - 70 - 12 - (row + 1) * (cell_h + 8) + 8
        if i == 6: x = M + colw + 12; yb = top - 70 - 12 - 4 * (cell_h + 8) + 8; 
        box(x, yb, colw, cell_h, f"{DAYS[i]}  {dd.strftime('%b %-d')}", fill=SAGE_L if i >= 5 else None)
        lines(x + 10, yb + cell_h - 34, colw - 20, 4, 20)
    # sunday uses slot beside saturday; use leftover slot for notes
    x = M; yb = top - 70 - 12 - 4 * (cell_h + 8) + 8
    box(x, yb, colw, cell_h, "Weekly notes"); lines(x + 10, yb + cell_h - 34, colw - 20, 4, 20)
    footer(); c.showPage()
    d0 += dt.timedelta(days=7)

# ---------- habit trackers ----------
for m in range(1, 13):
    header(f"Habits · {MONTHS[m-1]}", "Fill a square each day", f"habit{m}" if m > 1 else "habit1")
    nd = calendar.monthrange(YEAR, m)[1]; lw = 120; cs = (W - 2 * M - lw) / 31
    y = H - 118
    c.setFont("Helvetica", 6.5); c.setFillColor(MUTE)
    for d in range(1, nd + 1): c.drawCentredString(M + lw + (d - 1) * cs + cs / 2, y, str(d))
    for r in range(18):
        yy = y - 8 - (r + 1) * 24 + 8
        c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(M, yy, M + lw - 6, yy)
        for d in range(nd): c.rect(M + lw + d * cs + 1, yy, cs - 2, 18, stroke=1, fill=0)
    footer(); c.showPage()

# ---------- year in pixels ----------
header("Year in pixels", "Colour one square per day to track mood", "pix")
cs = (W - 2 * M - 40) / 12; y = H - 125
c.setFont("Helvetica-Bold", 7); c.setFillColor(SAGE)
for m in range(12): c.drawCentredString(M + 40 + m * cs + cs / 2, y, MONTHS[m][:3].upper())
for d in range(31):
    yy = y - 8 - (d + 1) * 17
    c.setFillColor(MUTE); c.setFont("Helvetica", 7); c.drawRightString(M + 30, yy + 6, str(d + 1))
    for m in range(12):
        if d < calendar.monthrange(YEAR, m + 1)[1]:
            c.setStrokeColor(LINE); c.rect(M + 40 + m * cs + 1.5, yy, cs - 3, 14, stroke=1, fill=0)
ly = 40
for i, (col, t) in enumerate([("#7C9A87", "Great"), ("#BCD0C0", "Good"), ("#E8D9B5", "Okay"), ("#E5B896", "Low"), ("#C8825F", "Rough")]):
    c.setFillColor(HexColor(col)); c.rect(M + i * 100, ly, 12, 12, stroke=0, fill=1)
    c.setFillColor(INK); c.setFont("Helvetica", 8); c.drawString(M + i * 100 + 18, ly + 3, t)
c.showPage()

# ---------- budget ----------
header("Monthly budget", "Copy this page for each month", "budget")
half = (W - 2 * M - 12) / 2
box(M, H - 300, half, 190, "Income"); lines(M + 10, H - 148, half - 20, 7, 22)
box(M + half + 12, H - 300, half, 190, "Savings goals"); lines(M + half + 22, H - 148, half - 20, 7, 22)
box(M, 70, W - 2 * M, H - 400, "Expenses")
cols = ["Category", "Planned", "Actual", "Diff"]
for i, t in enumerate(cols):
    c.setFillColor(MUTE); c.setFont("Helvetica-Bold", 8); c.drawString(M + 12 + (0 if i == 0 else 220 + (i - 1) * 90), H - 330, t.upper())
lines(M + 12, H - 345, W - 2 * M - 24, int((H - 430) // 22), 22)
footer(); c.showPage()

# ---------- reading ----------
header("Reading log", "Books to read & finished", "read")
cols = ["Title", "Author", "Rating"]
for i, t in enumerate(cols):
    c.setFillColor(MUTE); c.setFont("Helvetica-Bold", 8); c.drawString(M + [0, 250, 440][i], H - 112, t.upper())
lines(M, H - 128, W - 2 * M, 29, 22)
footer(); c.showPage()

# ---------- notes (dot grid) ----------
for k in range(3):
    header("Notes", "Dot grid", "notes" if k == 0 else None)
    c.setFillColor(LINE)
    for gx in range(M, W - M + 1, 18):
        for gy in range(60, H - 100, 18): c.circle(gx, gy, 0.8, stroke=0, fill=1)
    footer(); c.showPage()

c.save(); print("wrote", out)
