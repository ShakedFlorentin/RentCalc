import streamlit as st
import pandas as pd
import json, io, math
from datetime import date

st.set_page_config(page_title="בדיקת התכנות שכירות", page_icon="🏠", layout="wide")

st.markdown("""
<style>
  /* ── RTL base ── */
  body, .stApp { direction: rtl; font-family: 'Segoe UI', 'Arial', sans-serif; }
  h1,h2,h3,label,.stMarkdown,.stMetric,p { direction: rtl; text-align: right; }
  .stSlider > div { direction: ltr; }
  .stNumberInput input, .stTextInput input { text-align: right; direction: rtl; }
  .stRadio > div { direction: rtl; }
  .stSelectbox > div { direction: rtl; }

  /* ── Tabs ── */
  .stTabs [data-baseweb="tab-list"] { gap: 4px; }
  .stTabs [data-baseweb="tab"] {
    font-size: 14px; font-weight: 600;
    padding: 10px 18px; border-radius: 8px 8px 0 0;
    background: #1e293b; color: #94a3b8;
    border: 1px solid #334155; border-bottom: none;
  }
  .stTabs [aria-selected="true"] {
    background: #334155 !important; color: #f1f5f9 !important;
  }

  /* ── Metric cards ── */
  div[data-testid="metric-container"] {
    direction: rtl;
    background: #1e293b;
    border-radius: 12px;
    padding: 16px 18px;
    border: 1px solid #334155;
  }
  div[data-testid="metric-container"] > div { direction: rtl; }
  [data-testid="stMetricLabel"] { font-size: 13px !important; color: #94a3b8; }
  [data-testid="stMetricValue"] { font-size: 22px !important; font-weight: 700; color: #f1f5f9; }

  /* ── Sidebar ── */
  [data-testid="stSidebar"] { background: #0f172a; border-left: 1px solid #1e293b; }
  [data-testid="stSidebar"] .stMarkdown h3 {
    background: #1e293b; border-radius: 8px; padding: 6px 12px;
    margin: 8px 0 4px; font-size: 14px; color: #cbd5e1;
    border-right: 3px solid #6366f1;
  }
  [data-testid="stSidebar"] .stMarkdown h2 {
    color: #f1f5f9; font-size: 18px; margin-bottom: 4px;
  }

  /* ── Expanders ── */
  [data-testid="stExpander"] {
    background: #1e293b; border-radius: 10px;
    border: 1px solid #334155 !important;
  }

  /* ── Divider ── */
  hr { border-color: #334155; margin: 12px 0; }

  /* ── Dataframe ── */
  [data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; }

  /* ── Info/Success/Error boxes ── */
  .stAlert { border-radius: 10px; }

  /* ── Download buttons ── */
  [data-testid="stDownloadButton"] button {
    border-radius: 8px; font-weight: 600; width: 100%;
  }

  /* ── Budget breakdown card ── */
  .bcard { border-radius: 12px; overflow: hidden; border: 1px solid #334155; margin: 12px 0; }
  .brow {
    display: flex; justify-content: space-between; align-items: center;
    padding: 11px 18px; border-bottom: 1px solid #1e293b;
    direction: rtl;
  }
  .brow:last-child { border-bottom: none; }
  .brow-income  { background: rgba(34,197,94,0.10);  border-right: 4px solid #22c55e; }
  .brow-bonus   { background: rgba(16,185,129,0.08); border-right: 4px solid #10b981; }
  .brow-expense { background: rgba(239,68,68,0.06);  border-right: 4px solid #ef4444; }
  .brow-sub     { background: rgba(245,158,11,0.08); border-right: 4px solid #f59e0b; border-top: 2px solid #334155; }
  .brow-goal    { background: rgba(99,102,241,0.08); border-right: 4px solid #6366f1; }
  .brow-total   { border-top: 2px solid #475569; background: rgba(0,0,0,0.25); border-right: 4px solid; }
  .brow-label   { font-size: 14px; color: #cbd5e1; }
  .brow-amount  { font-size: 16px; font-weight: 700; font-family: 'Courier New', monospace; }
  .col-green    { color: #4ade80; }
  .col-red      { color: #f87171; }
  .col-orange   { color: #fbbf24; }
  .col-blue     { color: #818cf8; }
  .col-gray     { color: #94a3b8; }

  /* ── Rule bars ── */
  .rule-card {
    background: #1e293b; border-radius: 10px; padding: 14px 18px;
    margin: 6px 0; border: 1px solid #334155; direction: rtl;
  }
  .rule-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .rule-bar-bg { background: #334155; border-radius: 4px; height: 8px; overflow: hidden; }
  .rule-bar-fill { height: 8px; border-radius: 4px; transition: width 0.3s; }

  /* ── Verdict banner ── */
  .verdict-wrap {
    padding: 18px 28px; border-radius: 14px; text-align: center;
    font-size: 26px; font-weight: 800; letter-spacing: 0.5px;
    margin: 0 0 20px; border: 1px solid;
  }

  /* ── Section headers ── */
  .section-title {
    font-size: 17px; font-weight: 700; color: #e2e8f0;
    margin: 20px 0 10px; padding-right: 10px;
    border-right: 3px solid #6366f1; display: block;
  }

  /* ── Summary stats row ── */
  .stat-pill {
    display: inline-block; background: #1e293b; border-radius: 20px;
    padding: 6px 14px; font-size: 13px; color: #94a3b8;
    border: 1px solid #334155; margin: 3px;
  }
  .stat-pill strong { color: #f1f5f9; }
</style>
""", unsafe_allow_html=True)

# ─── Tax calculations ─────────────────────────────────────────────────────────
TAX_BRACKETS = [
    (7_010, 0.10), (10_060, 0.14), (16_150, 0.20),
    (21_240, 0.31), (44_030, 0.35), (56_970, 0.47), (float("inf"), 0.50),
]
CREDIT_POINT = 242

def calc_income_tax(gross_monthly: float, credit_points: float = 2.25) -> float:
    annual = gross_monthly * 12
    tax, prev = 0.0, 0.0
    for ceil, rate in TAX_BRACKETS:
        if annual <= prev: break
        tax += (min(annual, ceil) - prev) * rate
        prev = ceil
    return max(0.0, tax / 12 - credit_points * CREDIT_POINT)

def calc_bituach(gross: float) -> float:
    cap = 7_522
    if gross <= cap:
        return gross * 0.066
    return cap * 0.066 + (gross - cap) * 0.151

def gross_to_net_full(gross: float, cp: float = 2.25, pen_p: float = 6.0,
                      keren_p: float = 2.5, bituach_override=None, other_ded: float = 0.0) -> dict:
    pension = gross * pen_p / 100
    keren   = gross * keren_p / 100
    taxable = gross - pension * 0.35
    itax    = calc_income_tax(taxable, cp)
    bl      = bituach_override if bituach_override is not None else calc_bituach(gross)
    net     = max(0.0, gross - itax - bl - pension - keren - other_ded)
    return dict(gross=gross, pension=pension, keren=keren, income_tax=itax, bituach=bl, other_ded=other_ded, net=net)

def monthly_mortgage(principal: float, annual_rate: float, years: int) -> float:
    if annual_rate == 0:
        return principal / (years * 12)
    r = annual_rate / 100 / 12
    n = years * 12
    return principal * r * (1 + r)**n / ((1 + r)**n - 1)

def build_forecast(net0, rent0, living0, fixed, init_sav, years, raise_p, rent_p, infl_p, return_p):
    rows = []
    Ss = Sc = init_sav
    net = net0; rent = rent0; living = living0
    r = return_p / 100 / 12
    for m in range(years * 12 + 1):
        if m > 0 and m % 12 == 0:
            net    *= 1 + raise_p / 100
            rent   *= 1 + rent_p  / 100
            living *= 1 + infl_p  / 100
        free = net - living - rent - fixed
        Ss += free
        Sc = Sc * (1 + r) + free
        if m % 3 == 0:
            yr, mo = divmod(m, 12)
            lbl = ("היום" if m == 0 else f"{yr}ש׳" if mo == 0
                   else f"{mo}ח׳" if yr == 0 else f"{yr}ש׳+{mo}")
            rows.append(dict(label=lbl, m=m,
                חיסכון_פשוט=round(Ss), חיסכון_ריבית=round(Sc),
                פנוי_לחודש=round(free), שכירות=round(rent), הכנסה=round(net)))
    return pd.DataFrame(rows)

def fmt(n):  return f"₪{n:,.0f}"
def fmtp(n): return f"{n:.1f}%"

def verdict(v):
    if v < 0:     return "⛔ בעייתי",     "#ef4444", "rgba(239,68,68,0.12)",  "#ef4444"
    if v < 500:   return "⚠️ גבולי מאוד", "#f97316", "rgba(249,115,22,0.12)", "#f97316"
    if v < 1_500: return "🟡 גבולי",      "#eab308", "rgba(234,179,8,0.12)",  "#eab308"
    if v < 3_000: return "✅ סביר",        "#22c55e", "rgba(34,197,94,0.12)",  "#22c55e"
    return             "💚 מצוין",         "#16a34a", "rgba(22,163,74,0.12)",  "#16a34a"

# ─── Session defaults ─────────────────────────────────────────────────────────
DEFAULTS = dict(
    income_type="ברוטו", income=15_000, credit_points=2.25, pension_p=6.0, keren_p=2.5,
    bituach_manual=False, bituach_amount=0, other_deductions=0,
    partner=False, p_income_type="ברוטו", p_income=12_000,
    p_credit_points=2.25, p_pension_p=6.0, p_keren_p=2.5,
    p_bituach_manual=False, p_bituach_amount=0, p_other_deductions=0,
    rent=4_500, vaad=150, arnona=350, electricity=200, water=80,
    preset="ממוצע",
    food=2500, transport=700, phone=100, subs=200, gym=200, misc=600,
    savings_goal=1_500,
    incl_child=False,
    daycare=2200, cfood=400, diapers=250, clothing=200,
    medical=150, activities=150, child_misc=200,
    child_state_sav=200, child_benefit=180,
    years=5, init_sav=10_000, raise_p=3.0, rent_p=5.0, infl_p=3.0, return_p=6.0,
    apt_price=1_800_000, equity_pct=25, mortgage_rate=4.5, mortgage_years=25,
)
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

PRESETS = {
    "מינימלי": dict(food=1800, transport=400,  phone=60,  subs=100, gym=0,   misc=300),
    "ממוצע":   dict(food=2500, transport=700,  phone=100, subs=200, gym=200, misc=600),
    "נוח":     dict(food=3500, transport=1200, phone=120, subs=350, gym=280, misc=1000),
}

# ─── SIDEBAR ──────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("## 🏠 הגדרות")

    with st.expander("💾 שמירה / טעינת פרופיל"):
        profile_json = json.dumps(
            {k: st.session_state.get(k, DEFAULTS[k]) for k in DEFAULTS},
            ensure_ascii=False, indent=2)
        st.download_button("📤 ייצוא JSON", profile_json, "profile.json", "application/json",
                           use_container_width=True)
        up = st.file_uploader("📥 בחר קובץ JSON", type="json", key="profile_upload")
        if up is not None:
            try:
                loaded = json.loads(up.read().decode("utf-8"))
                for k, v in loaded.items():
                    if k in DEFAULTS:
                        st.session_state[k] = v
                st.success(f"✅ נטען! {len([k for k in loaded if k in DEFAULTS])} פרמטרים")
            except Exception as e:
                st.error(f"שגיאה: {e}")

    st.divider()

    # ── Income ────────────────────────────────────────────────────────────────
    st.markdown("### 💰 הכנסה חודשית")
    income_type = st.radio("סוג הכנסה", ["נטו", "ברוטו"], horizontal=True,
                            index=["נטו", "ברוטו"].index(st.session_state.income_type),
                            key="income_type")
    income = st.number_input("סכום (₪)", 1000, 200_000, key="income", step=500)

    breakdown = None
    if income_type == "ברוטו":
        with st.expander("✂️ ניכויים"):
            cp = st.number_input("נקודות זיכוי", 0.0, 10.0, key="credit_points", step=0.25,
                                  help="ברירת מחדל: 2.25 לגבר, 2.75 לאישה")
            pp = st.number_input("פנסיה %", 0.0, 10.0, key="pension_p", step=0.5)
            kp = st.number_input("קרן השתלמות %", 0.0, 5.0, key="keren_p", step=0.5)
            st.markdown("**ביטוח לאומי + בריאות**")
            bl_manual = st.toggle("הזנה ידנית", key="bituach_manual",
                                   help="סמן אם ברצונך להזין סכום ידנית במקום חישוב אוטומטי")
            if bl_manual:
                bl_amt = st.number_input("סכום ביטוח לאומי + בריאות (₪)", 0, 50_000,
                                          key="bituach_amount", step=10)
                bituach_override = float(bl_amt)
            else:
                bituach_override = None
                auto_bl = calc_bituach(float(income))
                st.caption(f"חישוב אוטומטי: **{fmt(auto_bl)}**")
            other_ded = st.number_input("ניכויים נוספים (₪)", 0, 50_000,
                                         key="other_deductions", step=50,
                                         help="כל ניכוי אחר: הלוואות, מזונות, וכד׳")
        breakdown  = gross_to_net_full(income, cp, pp, kp, bituach_override, float(other_ded))
        net_income = breakdown["net"]
        total_ded  = income - net_income
        st.markdown(f"""
        <div style="background:#1e293b;border-radius:10px;padding:12px 16px;border:1px solid #334155;margin:8px 0;">
          <div style="font-size:12px;color:#94a3b8;margin-bottom:2px;">הכנסה נטו מחושבת</div>
          <div style="font-size:22px;font-weight:700;color:#4ade80;">{fmt(net_income)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">ניכויים: {fmt(total_ded)} ({total_ded/income*100:.1f}%)</div>
        </div>""", unsafe_allow_html=True)
        with st.expander("📋 פירוט ניכויים"):
            rows_ded = [
                ("מס הכנסה",             breakdown['income_tax']),
                ("ביטוח לאומי + בריאות", breakdown['bituach']),
                ("פנסיה",                breakdown['pension']),
                ("קרן השתלמות",          breakdown['keren']),
            ]
            if breakdown['other_ded'] > 0:
                rows_ded.append(("ניכויים נוספים", breakdown['other_ded']))
            for label, val in rows_ded:
                pct = val / income * 100 if income > 0 else 0
                st.markdown(f"""
                <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #1e293b;direction:rtl;">
                  <span style="color:#cbd5e1;font-size:13px;">{label}</span>
                  <span style="color:#f87171;font-size:13px;font-weight:600;">{fmt(val)} <span style="color:#64748b;font-size:11px;">({pct:.1f}%)</span></span>
                </div>""", unsafe_allow_html=True)
    else:
        net_income = float(income)

    partner = st.toggle("👫 הוסף שותף/ה", key="partner")
    p_net = 0.0
    if partner:
        with st.expander("👤 שותף/ה", expanded=True):
            pit = st.radio("סוג הכנסה", ["נטו", "ברוטו"], horizontal=True,
                           index=["נטו", "ברוטו"].index(st.session_state.p_income_type),
                           key="p_income_type")
            pi = st.number_input("הכנסה (₪)", 1000, 200_000, key="p_income", step=500)
            if pit == "ברוטו":
                pcp = st.number_input("נקודות זיכוי", 0.0, 10.0, key="p_credit_points", step=0.25)
                ppp = st.number_input("פנסיה %",       0.0, 10.0, key="p_pension_p",    step=0.5)
                pkp = st.number_input("קרן השתלמות %", 0.0,  5.0, key="p_keren_p",     step=0.5)
                st.markdown("**ביטוח לאומי + בריאות**")
                p_bl_manual = st.toggle("הזנה ידנית", key="p_bituach_manual")
                if p_bl_manual:
                    p_bl_amt = st.number_input("ביטוח לאומי + בריאות (₪)", 0, 50_000,
                                                key="p_bituach_amount", step=10)
                    p_bituach_override = float(p_bl_amt)
                else:
                    p_bituach_override = None
                    st.caption(f"חישוב אוטומטי: **{fmt(calc_bituach(float(pi)))}**")
                p_other_ded = st.number_input("ניכויים נוספים (₪)", 0, 50_000,
                                               key="p_other_deductions", step=50)
                p_bd  = gross_to_net_full(pi, pcp, ppp, pkp, p_bituach_override, float(p_other_ded))
                p_net = p_bd["net"]
                st.caption(f"נטו שותף/ה: **{fmt(p_net)}**")
            else:
                p_net = float(pi)

    combined_net = net_income + p_net

    st.divider()

    # ── Housing ───────────────────────────────────────────────────────────────
    st.markdown("### 🏘️ הוצאות דיור")
    rent        = st.number_input("שכר דירה (₪)",  0, 30_000, key="rent",        step=100)
    vaad        = st.number_input("ועד בית (₪)",   0,  2_000, key="vaad",        step=10)
    arnona      = st.number_input("ארנונה (₪)",    0,  5_000, key="arnona",      step=10)
    electricity = st.number_input("חשמל (₪)",      0,  2_000, key="electricity", step=10)
    water_      = st.number_input("מים (₪)",       0,  1_000, key="water",       step=10)
    fixed       = vaad + arnona + electricity + water_
    housing     = rent + fixed
    st.caption(f"סה״כ דיור: **{fmt(housing)}** (שכ״ד + {fmt(fixed)} נלווים)")

    st.divider()

    # ── Living ────────────────────────────────────────────────────────────────
    st.markdown("### 🧾 הוצאות חיים")
    preset = st.selectbox("פרסט הוצאות", ["ממוצע", "מינימלי", "נוח", "מותאם אישית"], key="preset")
    if preset != "מותאם אישית":
        for k, v in PRESETS[preset].items():
            st.session_state[k] = v
    with st.expander("פירוט הוצאות", expanded=(preset == "מותאם אישית")):
        food      = st.number_input("🛒 מזון וקניות",  step=50, key="food")
        transport = st.number_input("🚗 תחבורה",       step=50, key="transport")
        phone_    = st.number_input("📱 טלפון",         step=10, key="phone")
        subs      = st.number_input("📺 מנויים",        step=10, key="subs")
        gym       = st.number_input("💪 ספורט / בריאות", step=10, key="gym")
        misc      = st.number_input("🎲 שונות / פנאי",   step=50, key="misc")
    living = food + transport + phone_ + subs + gym + misc
    st.caption(f"סה״כ הוצאות חיים: **{fmt(living)}**")

    savings_goal = st.number_input("🏦 יעד חיסכון חודשי (₪)", 0, 50_000, key="savings_goal", step=100)

    st.divider()

    # ── Child ─────────────────────────────────────────────────────────────────
    st.markdown("### 👶 ילד (עד גיל 3)")
    incl_child = st.toggle("כלול ילד בחישוב", key="incl_child")
    child_exp_total = child_benefit = child_state_sav = 0
    if incl_child:
        with st.expander("הוצאות ילד", expanded=True):
            daycare    = st.number_input("🏫 גן / מעון",   step=50, key="daycare")
            cfood      = st.number_input("🍼 אוכל לתינוק", step=50, key="cfood")
            diapers    = st.number_input("🧷 חיתולים",     step=10, key="diapers")
            clothing   = st.number_input("👕 ביגוד",       step=10, key="clothing")
            medical    = st.number_input("💊 רפואה",       step=10, key="medical")
            activities = st.number_input("🎨 חוגים",       step=10, key="activities")
            cm         = st.number_input("📦 שונות",       step=10, key="child_misc")
        child_exp_total = daycare + cfood + diapers + clothing + medical + activities + cm
        with st.expander("🎁 הטבות מהמדינה"):
            child_state_sav = st.number_input("💰 חיסכון ממלכתי (יוצא)", step=10, key="child_state_sav")
            child_benefit   = st.number_input("🎁 קצבת ילדים (נכנסת)",  step=10, key="child_benefit")
            st.caption("קצבה ~₪180 לילד ראשון/שני")

# ─── Core calculations ────────────────────────────────────────────────────────
child_net_cost = child_exp_total + child_state_sav - child_benefit
effective_net  = combined_net + child_benefit
total_spend    = living + child_exp_total + housing + child_state_sav
free_cash      = effective_net - total_spend
after_goal     = free_cash - savings_goal
rent_pct       = rent / combined_net * 100 if combined_net > 0 else 0
housing_pct    = housing / combined_net * 100 if combined_net > 0 else 0

years    = st.session_state.years
init_sav = st.session_state.init_sav
raise_p  = st.session_state.raise_p
rent_p   = st.session_state.rent_p
infl_p   = st.session_state.infl_p
return_p = st.session_state.return_p
living_fc = living + child_net_cost

# ─── Page header ──────────────────────────────────────────────────────────────
st.markdown("<h1 style='text-align:center;font-size:28px;color:#f1f5f9;margin-bottom:4px;'>🏠 בדיקת התכנות שכירות</h1>", unsafe_allow_html=True)
st.markdown("<p style='text-align:center;color:#64748b;font-size:13px;margin-bottom:20px;'>כלי לניתוח עצמי — לא ייעוץ פיננסי</p>", unsafe_allow_html=True)

tabs = st.tabs(["🏠 תקציב", "📈 תחזית", "🔀 תרחישים", "🏦 חיסכון לדירה", "⚖️ שכירות vs. משכנתא", "📤 ייצוא"])

# ══════════════════════════════════════════════════════════════════ TAB 0 ══
with tabs[0]:
    lbl, col, bg, border = verdict(after_goal)
    st.markdown(f"""
    <div class="verdict-wrap" style="background:{bg};border-color:{border};color:{col};">
      {lbl} &nbsp;·&nbsp; <span style="font-size:20px;">נשאר: {fmt(after_goal)}</span>
    </div>""", unsafe_allow_html=True)

    # Top metrics
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("💰 הכנסה נטו", fmt(combined_net),
              delta=fmt(p_net) + " שותף/ה" if partner and p_net > 0 else None)
    c2.metric("🏠 סה״כ דיור", fmt(housing),
              delta=f"{housing_pct:.0f}% מההכנסה", delta_color="inverse")
    c3.metric("🧾 הוצאות חיים", fmt(living))
    c4.metric("✅ נשאר אחרי הכל", fmt(after_goal),
              delta=f"{after_goal/combined_net*100:.0f}% מהנטו" if combined_net > 0 else None)

    st.markdown("<span class='section-title'>📊 פירוט תקציב חודשי</span>", unsafe_allow_html=True)

    # Budget breakdown card
    def brow(label, amount, row_class, amount_class, prefix=""):
        sign = "−" if amount < 0 else ("+" if prefix == "+" else "")
        return f"""
        <div class="brow {row_class}">
          <span class="brow-label">{label}</span>
          <span class="brow-amount {amount_class}">{sign}{fmt(abs(amount))}</span>
        </div>"""

    html = '<div class="bcard">'
    html += brow("💰 הכנסה נטו משולבת", combined_net, "brow-income", "col-green")
    if incl_child and child_benefit > 0:
        html += brow("🎁 קצבת ילדים", child_benefit, "brow-bonus", "col-green", "+")
    html += brow("🏠 שכר דירה", -rent,  "brow-expense", "col-red")
    html += brow("🔌 עלויות דיור נלוות", -fixed, "brow-expense", "col-red")
    html += brow("🛒 הוצאות חיים", -living, "brow-expense", "col-red")
    if incl_child:
        html += brow("👶 הוצאות ילד", -child_exp_total, "brow-expense", "col-red")
        html += brow("💰 חיסכון ממלכתי ילד", -child_state_sav, "brow-expense", "col-red")
    html += brow("💵 פנוי לפני חיסכון", free_cash, "brow-sub", "col-orange")
    html += brow("🏦 יעד חיסכון חודשי", -savings_goal, "brow-goal", "col-blue")
    total_style = f"border-right-color:{col}"
    lbl_icon = "💚" if after_goal >= 3000 else ("✅" if after_goal >= 1500 else ("🟡" if after_goal >= 500 else "⛔"))
    html += f"""
    <div class="brow brow-total" style="{total_style}">
      <span class="brow-label" style="font-weight:700;color:#f1f5f9;">{lbl_icon} נשאר אחרי הכל</span>
      <span class="brow-amount" style="color:{col};font-size:18px;">{fmt(after_goal)}</span>
    </div>"""
    html += '</div>'
    st.markdown(html, unsafe_allow_html=True)

    # Rent rules
    st.markdown("<span class='section-title'>📐 כללי אצבע — שכר דירה</span>", unsafe_allow_html=True)
    for rpct, desc, bar_color in [
        (0.25, "כלל 25% — מרווח גבוה", "#22c55e"),
        (0.30, "כלל 30% — סטנדרט",     "#f59e0b"),
        (0.333,"כלל 33% — גבול עליון",  "#ef4444"),
    ]:
        max_r  = combined_net * rpct
        ok     = rent <= max_r
        fill   = min(100, rent / max_r * 100) if max_r > 0 else 100
        status = "✅" if ok else "❌"
        bar_c  = bar_color if ok else "#ef4444"
        st.markdown(f"""
        <div class="rule-card">
          <div class="rule-header">
            <span style="font-size:14px;font-weight:600;color:#e2e8f0;">{status} {desc}</span>
            <span style="font-size:13px;color:#94a3b8;">
              שכ״ד: <strong style="color:#f1f5f9;">{fmt(rent)}</strong> /
              מקסימום: <strong style="color:{bar_color};">{fmt(max_r)}</strong>
            </span>
          </div>
          <div class="rule-bar-bg">
            <div class="rule-bar-fill" style="width:{fill:.0f}%;background:{bar_c};"></div>
          </div>
        </div>""", unsafe_allow_html=True)

    # Summary pills
    st.markdown("<br>", unsafe_allow_html=True)
    pills = [
        ("שכ״ד מתוך נטו",      fmtp(rent_pct)),
        ("דיור כולל מתוך נטו", fmtp(housing_pct)),
        ("הוצאות מתוך נטו",    fmtp(total_spend / combined_net * 100) if combined_net > 0 else "—"),
    ]
    if incl_child:
        pills.append(("עלות נטו ילד/חודש", fmt(child_net_cost)))
    pill_html = "".join(f'<span class="stat-pill">{k}: <strong>{v}</strong></span>' for k, v in pills)
    st.markdown(f'<div style="direction:rtl;">{pill_html}</div>', unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════ TAB 1 ══
with tabs[1]:
    st.markdown("<span class='section-title'>⚙️ הגדרות תחזית</span>", unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    years_t    = c1.slider("אופק (שנים)", 1, 15, years)
    init_sav_t = c2.number_input("חיסכון התחלתי (₪)", 0, 500_000, init_sav, 1_000, key="t_init")
    return_p_t = c3.slider("תשואה שנתית %", 0.0, 15.0, return_p, 0.5)
    c4, c5, c6 = st.columns(3)
    raise_p_t  = c4.slider("עליית שכר שנתית %",  0.0, 15.0, raise_p, 0.5)
    rent_p_t   = c5.slider("עליית שכ״ד שנתית %", 0.0, 15.0, rent_p,  0.5)
    infl_p_t   = c6.slider("אינפלציה %",           0.0, 10.0, infl_p,  0.5)

    df_t = build_forecast(combined_net, rent, living_fc, fixed,
                           init_sav_t, years_t, raise_p_t, rent_p_t, infl_p_t, return_p_t)
    last = df_t.iloc[-1]

    st.markdown("<span class='section-title'>📊 תוצאות בעוד {years_t} שנים</span>".replace("{years_t}", str(years_t)), unsafe_allow_html=True)
    k1, k2, k3, k4 = st.columns(4)
    k1.metric(f"חיסכון פשוט",            fmt(last["חיסכון_פשוט"]))
    k2.metric(f"חיסכון + ריבית {return_p_t}%", fmt(last["חיסכון_ריבית"]))
    k3.metric(f"שכ״ד צפוי",              fmt(last["שכירות"]))
    k4.metric(f"הכנסה צפויה",            fmt(last["הכנסה"]))

    st.markdown("<span class='section-title'>📋 טבלת תחזית</span>", unsafe_allow_html=True)
    st.dataframe(
        df_t.drop(columns=["m"]).rename(columns={
            "label":       "תקופה",
            "חיסכון_פשוט": "חיסכון פשוט ₪",
            "חיסכון_ריבית": f"+ריבית {return_p_t}% ₪",
            "פנוי_לחודש":   "פנוי/חודש ₪",
            "שכירות":       "שכ״ד ₪",
            "הכנסה":        "הכנסה ₪",
        }),
        hide_index=True, use_container_width=True
    )

# ══════════════════════════════════════════════════════════════════ TAB 2 ══
with tabs[2]:
    st.markdown("<span class='section-title'>🔀 הגדרת תרחישים</span>", unsafe_allow_html=True)
    n_sc   = int(st.number_input("מספר תרחישים", 2, 6, 4, 1))
    dnames = ["תרחיש נוכחי", "דירה זולה ב-500₪", "דירה יקרה ב-500₪", "העלאה בשכר 2K", "תרחיש 5", "תרחיש 6"]
    drds   = [0, -500, 500, 0, 0, 0]
    dids   = [0, 0, 0, 2000, 0, 0]

    sc_defs = []
    cols_sc = st.columns(min(n_sc, 3))
    for i in range(n_sc):
        with cols_sc[i % 3]:
            with st.expander(dnames[i] if i < len(dnames) else f"תרחיש {i+1}", expanded=True):
                nm  = st.text_input("שם תרחיש", dnames[i] if i < len(dnames) else f"תרחיש {i+1}", key=f"sn{i}")
                rd  = st.number_input("שינוי שכ״ד (₪)", value=drds[i] if i < len(drds) else 0, step=100, key=f"srd{i}")
                idd = st.number_input("שינוי הכנסה (₪)", value=dids[i] if i < len(dids) else 0, step=500, key=f"sid{i}")
                ed  = st.number_input("שינוי הוצאות (₪)", value=0, step=100, key=f"sed{i}")
            sc_defs.append(dict(name=nm, rd=rd, id=idd, ed=ed))

    st.divider()
    results = []
    for s in sc_defs:
        sn = combined_net + s["id"]; sr = rent + s["rd"]; sl = living_fc + s["ed"]
        sh = sr + fixed; sf = sn - sl - sh; sa = sf - savings_goal
        dfs = build_forecast(sn, sr, sl, fixed, init_sav_t, 5, raise_p_t, rent_p_t, infl_p_t, return_p_t)
        ls  = dfs.iloc[-1]
        results.append({**s, "sn": sn, "sr": sr, "sf": sf, "sa": sa,
                        "sav5s": ls["חיסכון_פשוט"], "sav5c": ls["חיסכון_ריבית"]})

    st.markdown("<span class='section-title'>📊 השוואת תרחישים</span>", unsafe_allow_html=True)
    tbl = pd.DataFrame([{
        "תרחיש":     r["name"],
        "שכ״ד":      fmt(r["sr"]),
        "הכנסה":     fmt(r["sn"]),
        "פנוי/חודש": fmt(r["sa"]),
        "חיסכון 5ש׳ פשוט": fmt(r["sav5s"]),
        "חיסכון 5ש׳ +ריבית": fmt(r["sav5c"]),
        "סטטוס":     verdict(r["sa"])[0],
    } for r in results])
    st.dataframe(tbl, hide_index=True, use_container_width=True)

    st.markdown("<span class='section-title'>🏆 דירוג לפי חיסכון</span>", unsafe_allow_html=True)
    medals = ["🥇", "🥈", "🥉"] + [f"{i+1}." for i in range(3, 10)]
    for i, r in enumerate(sorted(results, key=lambda r: r["sav5c"], reverse=True)):
        lbl2, cl2, _, _ = verdict(r["sa"])
        c1, c2, c3, c4 = st.columns([3, 2, 2, 2])
        c1.markdown(f"**{medals[i]} {r['name']}**")
        c2.write(fmt(r["sav5s"]))
        c3.write(fmt(r["sav5c"]))
        c4.markdown(f"<span style='color:{cl2};font-weight:600;'>{lbl2}</span>", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════ TAB 3 ══
with tabs[3]:
    st.markdown("<span class='section-title'>🏦 כמה זמן עד הון עצמי לדירה?</span>", unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    apt_price = c1.number_input("מחיר דירה (₪)", 500_000, 10_000_000, st.session_state.apt_price, 50_000)
    eq_pct    = c2.slider("הון עצמי נדרש %", 10, 40, st.session_state.equity_pct)
    existing  = c3.number_input("חיסכון קיים (₪)", 0, 5_000_000, init_sav_t, 10_000, key="ex_sav")

    equity_need = apt_price * eq_pct / 100
    gap         = max(0.0, equity_need - existing)
    ms          = max(1.0, after_goal)
    r_m         = return_p_t / 100 / 12

    mn_s = math.ceil(gap / ms) if ms > 0 else float("inf")
    if r_m > 0 and ms > 0:
        S = existing; mn_c = 0
        while S < equity_need and mn_c < 600:
            S = S * (1 + r_m) + ms; mn_c += 1
        if mn_c >= 600: mn_c = float("inf")
    else:
        mn_c = mn_s

    k1, k2, k3, k4 = st.columns(4)
    k1.metric("מחיר דירה",     fmt(apt_price))
    k2.metric("הון עצמי נדרש", fmt(equity_need))
    k3.metric("חסר עוד",       fmt(gap))
    k4.metric("חיסכון חודשי",  fmt(ms))

    st.divider()
    c1, c2 = st.columns(2)
    if mn_s == float("inf"):
        c1.error("⚠️ חיסכון חודשי שלילי — לא ניתן לצבור הון")
    else:
        y, m = divmod(int(mn_s), 12)
        c1.metric("⏱️ זמן ללא ריבית", f"{y} שנים {m} חודשים")
    if mn_c == float("inf"):
        c2.error("⚠️ לא ניתן להגיע ליעד")
    else:
        y, m = divmod(int(mn_c), 12)
        c2.metric(f"📈 זמן עם ריבית {return_p_t}%", f"{y} שנים {m} חודשים")

    # Progress toward goal
    if gap > 0 and existing > 0:
        progress = min(1.0, existing / equity_need)
        st.markdown(f"""
        <div style="margin-top:16px;">
          <div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:13px;margin-bottom:6px;direction:rtl;">
            <span>התקדמות לעבר הון עצמי</span>
            <span><strong style="color:#f1f5f9;">{fmt(existing)}</strong> מתוך {fmt(equity_need)}</span>
          </div>
          <div style="background:#1e293b;border-radius:6px;height:12px;overflow:hidden;border:1px solid #334155;">
            <div style="width:{progress*100:.1f}%;background:linear-gradient(90deg,#6366f1,#10b981);height:100%;border-radius:6px;"></div>
          </div>
          <div style="text-align:left;color:#6366f1;font-size:12px;margin-top:4px;">{progress*100:.1f}%</div>
        </div>""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════ TAB 4 ══
with tabs[4]:
    st.markdown("<span class='section-title'>⚖️ שכירות vs. משכנתא</span>", unsafe_allow_html=True)
    c1, c2, c3 = st.columns(3)
    apt2      = c1.number_input("מחיר דירה (₪)", 500_000, 10_000_000, st.session_state.apt_price, 50_000, key="ap2")
    eq2       = c2.slider("הון עצמי %", 10, 40, st.session_state.equity_pct, key="eq2")
    mrate     = c3.slider("ריבית משכנתא %", 1.0, 10.0, st.session_state.mortgage_rate, 0.1)
    c4, c5    = st.columns(2)
    myears    = c4.slider("תקופת משכנתא (שנים)", 10, 30, st.session_state.mortgage_years)
    apt_appre = c5.slider("עליית ערך דירה שנתית %", 0.0, 10.0, 4.0, 0.5)

    eq_amount = apt2 * eq2 / 100
    principal = apt2 - eq_amount
    mrt       = monthly_mortgage(principal, mrate, myears)
    total_pay = mrt * myears * 12
    total_int = total_pay - principal

    st.markdown("<span class='section-title'>💳 פרטי משכנתא</span>", unsafe_allow_html=True)
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("קרן להלוואה",  fmt(principal))
    k2.metric("תשלום חודשי",  fmt(mrt))
    k3.metric("סה״כ ריבית",   fmt(total_int))
    k4.metric("סה״כ תשלום",   fmt(total_pay))

    diff = mrt - rent
    if diff > 0:
        st.info(f"💡 המשכנתא יקרה ב-**{fmt(diff)}/חודש** משכירות. לרכישה כדאית צריך עליית ערך של **{apt_appre:.1f}%+ בשנה**.")
    else:
        st.success(f"💡 המשכנתא זולה ב-**{fmt(-diff)}/חודש** — רכישה כדאית כלכלית כבר היום.")

    st.markdown("<span class='section-title'>📊 השוואת עושר לאורך זמן</span>", unsafe_allow_html=True)
    rows_cmp = []
    S_inv = eq_amount; r_m2 = return_p_t / 100 / 12
    for mm in range(myears * 12 + 1):
        rent_m  = rent * (1 + rent_p_t / 100) ** (mm / 12)
        apt_val = apt2 * (1 + apt_appre / 100) ** (mm / 12)
        extra   = mrt - rent_m
        S_inv   = S_inv * (1 + r_m2) + max(0, extra)
        if mm % 6 == 0:
            yr, mo = divmod(mm, 12)
            lbl = f"{yr}ש׳" if mo == 0 else (f"{mo}ח׳" if yr == 0 else f"{yr}ש׳+{mo}")
            rows_cmp.append({"תקופה": lbl, "ערך דירה (קונה) ₪": round(apt_val),
                              "עושר שוכר (השקעות) ₪": round(S_inv)})
    st.dataframe(pd.DataFrame(rows_cmp), hide_index=True, use_container_width=True)
    st.caption("* לא כולל מס רכישה, שיפוץ, עמלות. לא ייעוץ פיננסי.")

# ══════════════════════════════════════════════════════════════════ TAB 5 ══
with tabs[5]:
    st.markdown("<span class='section-title'>📤 ייצוא נתונים</span>", unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    with c1:
        profile_out = json.dumps(
            {k: st.session_state.get(k, DEFAULTS[k]) for k in DEFAULTS},
            ensure_ascii=False, indent=2)
        st.download_button("💾 ייצוא פרופיל JSON", profile_out,
                           "rental_profile.json", "application/json", use_container_width=True)

    with c2:
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            bd = [("הכנסה נטו משולבת", combined_net), ("שכר דירה", -rent),
                  ("דיור נוסף", -fixed), ("הוצאות חיים", -living)]
            if incl_child:
                bd += [("הוצאות ילד", -child_exp_total),
                       ("חיסכון ממלכתי ילד", -child_state_sav),
                       ("קצבת ילדים", child_benefit)]
            bd += [("פנוי לפני חיסכון", free_cash),
                   ("יעד חיסכון", -savings_goal), ("נשאר", after_goal)]
            pd.DataFrame(bd, columns=["סעיף", "סכום ₪"]).to_excel(writer, sheet_name="תקציב", index=False)
            df_t.drop(columns=["m"]).to_excel(writer, sheet_name="תחזית", index=False)
            tbl.to_excel(writer, sheet_name="תרחישים", index=False)
        st.download_button("📥 הורד Excel", buf.getvalue(), "rental_analysis.xlsx",
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           use_container_width=True)

    st.divider()
    st.markdown(f"<span class='section-title'>📅 סיכום — {date.today().strftime('%d/%m/%Y')}</span>", unsafe_allow_html=True)
    verdict_lbl, verdict_col, verdict_bg, _ = verdict(after_goal)
    st.markdown(f"""
    <div style="background:#1e293b;border-radius:12px;padding:20px 24px;border:1px solid #334155;direction:rtl;">
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><div style="font-size:12px;color:#94a3b8;">הכנסה נטו</div><div style="font-size:18px;font-weight:700;color:#4ade80;">{fmt(combined_net)}</div></div>
        <div><div style="font-size:12px;color:#94a3b8;">דיור סה״כ</div><div style="font-size:18px;font-weight:700;color:#f87171;">{fmt(housing)}</div></div>
        <div><div style="font-size:12px;color:#94a3b8;">הוצאות חיים</div><div style="font-size:18px;font-weight:700;color:#f87171;">{fmt(living)}</div></div>
        <div><div style="font-size:12px;color:#94a3b8;">נשאר</div><div style="font-size:18px;font-weight:700;color:{verdict_col};">{fmt(after_goal)}</div></div>
        <div><div style="font-size:12px;color:#94a3b8;">סטטוס</div><div style="font-size:18px;font-weight:700;color:{verdict_col};">{verdict_lbl}</div></div>
      </div>
    </div>""", unsafe_allow_html=True)

st.markdown("<br><p style='text-align:center;color:#475569;font-size:12px;'>הכלי הוא להערכה עצמית בלבד · לא ייעוץ פיננסי</p>", unsafe_allow_html=True)
