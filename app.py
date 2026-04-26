import streamlit as st
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import json, io, math
from datetime import date

# ─── Page config ─────────────────────────────────────────────────────────────
st.set_page_config(page_title="בדיקת התכנות שכירות", page_icon="🏠", layout="wide")

st.markdown("""
<style>
  body, .stApp { direction: rtl; }
  h1,h2,h3,label,.stMarkdown,.stMetric { direction: rtl; text-align: right; }
  .stSlider > div { direction: ltr; }
  .stNumberInput input, .stTextInput input { text-align: right; }
  .stTabs [data-baseweb="tab"] { font-size: 14px; font-weight: 600; }
  div[data-testid="metric-container"] { direction: rtl; }
</style>
""", unsafe_allow_html=True)

CHART_LAYOUT = dict(
    paper_bgcolor="#0f172a", plot_bgcolor="#080c14",
    font=dict(color="#e2e8f0", size=12),
    legend=dict(bgcolor="#0f172a", bordercolor="#1e293b"),
    yaxis=dict(tickprefix="₪", gridcolor="#1e293b"),
    xaxis=dict(gridcolor="#1e293b"),
    hovermode="x unified",
    margin=dict(t=50, b=30, l=10, r=10),
)

# ─── Israel tax 2024 ──────────────────────────────────────────────────────────
TAX_BRACKETS = [
    (7_010,  0.10), (10_060, 0.14), (16_150, 0.20),
    (21_240, 0.31), (44_030, 0.35), (56_970, 0.47), (float("inf"), 0.50),
]
CREDIT_POINT = 242  # ₪/month

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
        return gross * (0.035 + 0.031)
    return cap * 0.066 + (gross - cap) * (0.12 + 0.031)

def gross_to_net_full(gross: float, cp: float = 2.25, pen_p: float = 6.0, keren_p: float = 2.5) -> dict:
    pension = gross * pen_p / 100
    keren   = gross * keren_p / 100
    taxable = gross - pension * 0.35
    itax    = calc_income_tax(taxable, cp)
    bl      = calc_bituach(gross)
    net     = max(0.0, gross - itax - bl - pension - keren)
    return dict(gross=gross, pension=pension, keren=keren, income_tax=itax, bituach=bl, net=net)

# ─── Mortgage ─────────────────────────────────────────────────────────────────
def monthly_mortgage(principal: float, annual_rate: float, years: int) -> float:
    if annual_rate == 0:
        return principal / (years * 12)
    r = annual_rate / 100 / 12
    n = years * 12
    return principal * r * (1 + r)**n / ((1 + r)**n - 1)

# ─── Forecast ─────────────────────────────────────────────────────────────────
def build_forecast(net0, rent0, living0, fixed, init_sav, years,
                   raise_p, rent_p, infl_p, return_p):
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

# ─── Helpers ──────────────────────────────────────────────────────────────────
def fmt(n): return f"₪{n:,.0f}"

def verdict(v):
    if v < 0:     return "⛔ בעייתי",     "#ef4444"
    if v < 500:   return "⚠️ גבולי מאוד", "#f97316"
    if v < 1_500: return "🟡 גבולי",      "#eab308"
    if v < 3_000: return "✅ סביר",        "#22c55e"
    return            "💚 מצוין",          "#16a34a"

def hline(fig, y=0, color="rgba(239,68,68,0.4)"):
    fig.add_hline(y=y, line_dash="dash", line_color=color)

# ─── Session-state defaults ───────────────────────────────────────────────────
DEFAULTS = dict(
    income_type="ברוטו", income=15_000, credit_points=2.25, pension_p=6.0, keren_p=2.5,
    partner=False, p_income_type="ברוטו", p_income=12_000,
    p_credit_points=2.25, p_pension_p=6.0, p_keren_p=2.5,
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
    st.markdown("## ⚙️ פרמטרים")

    # Profile save/load
    with st.expander("💾 פרופיל"):
        profile_json = json.dumps({k: st.session_state.get(k, DEFAULTS[k]) for k in DEFAULTS},
                                   ensure_ascii=False, indent=2)
        st.download_button("📤 ייצוא JSON", profile_json, "profile.json", "application/json")
        up = st.file_uploader("📥 טעינת JSON", type="json", label_visibility="collapsed")
        if up:
            try:
                loaded = json.load(up)
                for k, v in loaded.items():
                    if k in DEFAULTS: st.session_state[k] = v
                st.success("נטען!"); st.rerun()
            except Exception as e:
                st.error(str(e))

    st.divider()

    # ── Income ────────────────────────────────────────────────────────────────
    st.markdown("### 💰 הכנסה")
    income_type = st.radio("סוג", ["נטו","ברוטו"], horizontal=True,
                            index=["נטו","ברוטו"].index(st.session_state.income_type),
                            key="income_type")
    income = st.number_input("הכנסה (₪)", 1000, 200_000, key="income", step=500)

    breakdown = None
    if income_type == "ברוטו":
        with st.expander("ניכויים"):
            cp  = st.number_input("נקודות זיכוי", 0.0, 10.0, key="credit_points", step=0.25)
            pp  = st.number_input("פנסיה %",       0.0, 10.0, key="pension_p",    step=0.5)
            kp  = st.number_input("קרן השתלמות %", 0.0,  5.0, key="keren_p",     step=0.5)
        breakdown  = gross_to_net_full(income, cp, pp, kp)
        net_income = breakdown["net"]
        st.caption(f"נטו: **{fmt(net_income)}**")
        with st.expander("פירוט ניכויים"):
            st.write(f"מס הכנסה: {fmt(breakdown['income_tax'])}")
            st.write(f"ביטוח לאומי+בריאות: {fmt(breakdown['bituach'])}")
            st.write(f"פנסיה: {fmt(breakdown['pension'])}")
            st.write(f"קרן השתלמות: {fmt(breakdown['keren'])}")
    else:
        net_income = float(income)

    # ── Partner ───────────────────────────────────────────────────────────────
    partner = st.toggle("👫 שותף/ה", key="partner")
    p_net = 0.0
    if partner:
        with st.expander("שותף/ה", expanded=True):
            pit = st.radio("סוג", ["נטו","ברוטו"], horizontal=True,
                           index=["נטו","ברוטו"].index(st.session_state.p_income_type),
                           key="p_income_type")
            pi  = st.number_input("הכנסה (₪)", 1000, 200_000, key="p_income", step=500)
            if pit == "ברוטו":
                pcp = st.number_input("נקודות זיכוי", 0.0, 10.0, key="p_credit_points", step=0.25)
                ppp = st.number_input("פנסיה %",       0.0, 10.0, key="p_pension_p",    step=0.5)
                pkp = st.number_input("קרן השתלמות %", 0.0,  5.0, key="p_keren_p",     step=0.5)
                p_bd  = gross_to_net_full(pi, pcp, ppp, pkp)
                p_net = p_bd["net"]
                st.caption(f"נטו שותף/ה: **{fmt(p_net)}**")
            else:
                p_net = float(pi)

    combined_net = net_income + p_net

    st.divider()

    # ── Housing ───────────────────────────────────────────────────────────────
    st.markdown("### 🏘️ דיור")
    rent        = st.number_input("שכר דירה (₪)",  0, 30_000, key="rent",        step=100)
    vaad        = st.number_input("ועד בית (₪)",   0,  2_000, key="vaad",        step=10)
    arnona      = st.number_input("ארנונה (₪)",    0,  5_000, key="arnona",      step=10)
    electricity = st.number_input("חשמל (₪)",      0,  2_000, key="electricity", step=10)
    water_      = st.number_input("מים (₪)",       0,  1_000, key="water",       step=10)
    fixed       = vaad + arnona + electricity + water_
    housing     = rent + fixed

    st.divider()

    # ── Living ────────────────────────────────────────────────────────────────
    st.markdown("### 🧾 הוצאות חיים")
    preset = st.selectbox("פרסט", ["ממוצע","מינימלי","נוח","מותאם אישית"], key="preset")
    if preset != "מותאם אישית":
        for k, v in PRESETS[preset].items():
            st.session_state[k] = v
    with st.expander("פירוט", expanded=(preset == "מותאם אישית")):
        food      = st.number_input("🛒 מזון",    step=50,  key="food")
        transport = st.number_input("🚗 תחבורה",  step=50,  key="transport")
        phone_    = st.number_input("📱 טלפון",   step=10,  key="phone")
        subs      = st.number_input("📺 מנויים",  step=10,  key="subs")
        gym       = st.number_input("💪 ספורט",   step=10,  key="gym")
        misc      = st.number_input("🎲 שונות",   step=50,  key="misc")
    living = food + transport + phone_ + subs + gym + misc

    savings_goal = st.number_input("🏦 יעד חיסכון/חודש (₪)", 0, 50_000, key="savings_goal", step=100)

    st.divider()

    # ── Child ─────────────────────────────────────────────────────────────────
    st.markdown("### 👶 ילד בן שנתיים")
    incl_child = st.toggle("כלול", key="incl_child")
    child_exp_total = child_benefit = child_state_sav = 0
    if incl_child:
        with st.expander("הוצאות ילד", expanded=True):
            daycare    = st.number_input("🏫 גן/מעון",  step=50, key="daycare")
            cfood      = st.number_input("🍼 מזון",     step=50, key="cfood")
            diapers    = st.number_input("🧷 חיתולים", step=10, key="diapers")
            clothing   = st.number_input("👕 ביגוד",   step=10, key="clothing")
            medical    = st.number_input("💊 רפואה",   step=10, key="medical")
            activities = st.number_input("🎨 חוגים",   step=10, key="activities")
            cm         = st.number_input("📦 שונות",   step=10, key="child_misc")
        child_exp_total = daycare + cfood + diapers + clothing + medical + activities + cm
        with st.expander("הטבות"):
            child_state_sav = st.number_input("💰 חיסכון ממלכתי (יוצא)", step=10, key="child_state_sav")
            child_benefit   = st.number_input("🎁 קצבת ילדים (נכנסת)",  step=10, key="child_benefit")
            st.caption("קצבה ~₪180 לילד ראשון/שני | המדינה מוסיפה ~₪50 לחיסכון ממלכתי")

# ─── Core budget ──────────────────────────────────────────────────────────────
child_net_cost = child_exp_total + child_state_sav - child_benefit
effective_net  = combined_net + child_benefit
total_spend    = living + child_exp_total + housing + child_state_sav
free_cash      = effective_net - total_spend
after_goal     = free_cash - savings_goal
rent_pct       = rent / combined_net * 100 if combined_net > 0 else 0
housing_pct    = housing / combined_net * 100 if combined_net > 0 else 0

# ─── Forecast defaults ────────────────────────────────────────────────────────
years    = st.session_state.years
init_sav = st.session_state.init_sav
raise_p  = st.session_state.raise_p
rent_p   = st.session_state.rent_p
infl_p   = st.session_state.infl_p
return_p = st.session_state.return_p
living_fc = living + child_net_cost
df_fc = build_forecast(combined_net, rent, living_fc, fixed,
                        init_sav, years, raise_p, rent_p, infl_p, return_p)

# ─── TABS ─────────────────────────────────────────────────────────────────────
st.markdown("<h1 style='text-align:center'>🏠 בדיקת התכנות שכירות</h1>", unsafe_allow_html=True)
tabs = st.tabs(["🏠 בסיס", "📈 תחזית", "🔀 תרחישים", "🏦 חיסכון לדירה", "⚖️ שכירות vs. משכנתא", "📤 ייצוא"])

# ══════════════════════════════════════════════════════════════════ TAB 0 ══
with tabs[0]:
    lbl, col = verdict(after_goal)
    st.markdown(f"<h2 style='text-align:center;color:{col}'>{lbl}</h2>", unsafe_allow_html=True)

    c1,c2,c3,c4 = st.columns(4)
    c1.metric("הכנסה נטו משולבת", fmt(combined_net))
    c2.metric("סה״כ הוצאות",      fmt(total_spend))
    c3.metric("פנוי לפני חיסכון", fmt(free_cash))
    c4.metric("נשאר אחרי הכל",    fmt(after_goal))

    st.divider()

    # Waterfall chart
    wf_x = ["הכנסה נטו"]
    wf_y = [combined_net]
    wf_m = ["absolute"]
    if child_benefit > 0:
        wf_x.append("קצבת ילדים"); wf_y.append(child_benefit); wf_m.append("relative")
    for lx, ly in [("שכר דירה", -rent), ("דיור נוסף", -fixed), ("הוצאות חיים", -living)]:
        wf_x.append(lx); wf_y.append(ly); wf_m.append("relative")
    if incl_child:
        wf_x += ["הוצאות ילד","חיסכון ממלכתי"]
        wf_y += [-child_exp_total, -child_state_sav]
        wf_m += ["relative","relative"]
    wf_x += ["יעד חיסכון","נשאר"]
    wf_y += [-savings_goal, after_goal]
    wf_m += ["relative","total"]

    fig_wf = go.Figure(go.Waterfall(
        orientation="v", measure=wf_m, x=wf_x, y=wf_y,
        connector=dict(line=dict(color="#334155")),
        increasing=dict(marker_color="#22c55e"),
        decreasing=dict(marker_color="#f59e0b"),
        totals=dict(marker_color=col),
        texttemplate="%{y:,.0f}₪", textposition="outside",
    ))
    fig_wf.update_layout(**{**CHART_LAYOUT,
        "title": "📊 תזרים תקציב חודשי", "showlegend": False, "height": 420})
    st.plotly_chart(fig_wf, use_container_width=True)

    st.divider()
    with st.expander("📋 פירוט תקציב מלא"):
        bd_rows = [
            ("הכנסה נטו", fmt(combined_net)),
            ("קצבת ילדים", fmt(child_benefit)) if incl_child else None,
            ("— שכר דירה", fmt(rent)),
            ("— דיור נוסף", fmt(fixed)),
            ("— הוצאות חיים", fmt(living)),
            ("— הוצאות ילד", fmt(child_exp_total)) if incl_child else None,
            ("— חיסכון ממלכתי ילד", fmt(child_state_sav)) if incl_child else None,
            ("─ פנוי לפני חיסכון", fmt(free_cash)),
            ("— יעד חיסכון", fmt(savings_goal)),
            ("══ נשאר אחרי הכל", fmt(after_goal)),
        ]
        df_bd = pd.DataFrame([(r[0], r[1]) for r in bd_rows if r],
                              columns=["סעיף", "סכום"])
        st.dataframe(df_bd, hide_index=True, use_container_width=True)

    st.markdown("### כללי אצבע")
    for rpct, desc in [(0.25,"מרווח גבוה"),(0.30,"סטנדרט"),(0.333,"גבול עליון")]:
        max_r = combined_net * rpct
        ok = rent <= max_r
        c1,c2,c3 = st.columns([3,2,1])
        c1.write(f"**כלל {rpct*100:.0f}%** — {desc}")
        c2.write(f"מקס׳: {fmt(max_r)}")
        c3.write("✅" if ok else "❌")

    c1,c2 = st.columns(2)
    c1.metric("שכ״ד מתוך נטו",      f"{rent_pct:.1f}%")
    c2.metric("דיור כולל מתוך נטו", f"{housing_pct:.1f}%")
    if incl_child:
        st.metric("עלות נטו ילד/חודש", fmt(child_net_cost))

# ══════════════════════════════════════════════════════════════════ TAB 1 ══
with tabs[1]:
    c1,c2,c3 = st.columns(3)
    years_t    = c1.slider("אופק (שנים)", 1, 15, years)
    init_sav_t = c2.number_input("חיסכון התחלתי (₪)", 0, 500_000, init_sav, 1_000, key="t_init")
    return_p_t = c3.slider("תשואה שנתית %", 0.0, 15.0, return_p, 0.5)
    c4,c5,c6 = st.columns(3)
    raise_p_t  = c4.slider("עליית שכר %",  0.0, 15.0, raise_p, 0.5)
    rent_p_t   = c5.slider("עליית שכ״ד %", 0.0, 15.0, rent_p,  0.5)
    infl_p_t   = c6.slider("אינפלציה %",    0.0, 10.0, infl_p,  0.5)

    df_t = build_forecast(combined_net, rent, living_fc, fixed,
                           init_sav_t, years_t, raise_p_t, rent_p_t, infl_p_t, return_p_t)
    last = df_t.iloc[-1]
    k1,k2,k3,k4 = st.columns(4)
    k1.metric(f"פשוט ({years_t}ש׳)",          fmt(last["חיסכון_פשוט"]))
    k2.metric(f"+ריבית {return_p_t}% ({years_t}ש׳)", fmt(last["חיסכון_ריבית"]))
    k3.metric(f"שכ״ד בעוד {years_t}ש׳",        fmt(last["שכירות"]))
    k4.metric(f"הכנסה בעוד {years_t}ש׳",       fmt(last["הכנסה"]))

    fig_s = go.Figure()
    fig_s.add_trace(go.Scatter(x=df_t["label"], y=df_t["חיסכון_פשוט"],
        name="פשוט", line=dict(color="#818cf8", width=2, dash="dot")))
    fig_s.add_trace(go.Scatter(x=df_t["label"], y=df_t["חיסכון_ריבית"],
        name=f"+ריבית {return_p_t}%", line=dict(color="#10b981", width=2.5),
        fill="tonexty", fillcolor="rgba(16,185,129,0.07)"))
    hline(fig_s)
    fig_s.update_layout(**{**CHART_LAYOUT, "title": "📈 חיסכון צבור"})
    st.plotly_chart(fig_s, use_container_width=True)

    fig_f = go.Figure()
    fig_f.add_trace(go.Scatter(x=df_t["label"], y=df_t["פנוי_לחודש"],
        name="פנוי", line=dict(color="#6366f1", width=2.5),
        fill="tozeroy", fillcolor="rgba(99,102,241,0.1)"))
    hline(fig_f)
    fig_f.update_layout(**{**CHART_LAYOUT, "title": "💵 פנוי לחודש", "showlegend": False})
    st.plotly_chart(fig_f, use_container_width=True)

# ══════════════════════════════════════════════════════════════════ TAB 2 ══
with tabs[2]:
    COLORS = ["#6366f1","#10b981","#f59e0b","#818cf8","#f43f5e","#06b6d4"]
    n_sc = int(st.number_input("מספר תרחישים", 2, 6, 4, 1))
    dnames = ["תרחיש נוכחי","דירה זולה ב-500₪","דירה יקרה ב-500₪","העלאה בשכר 2K","תרחיש 5","תרחיש 6"]
    drds   = [0,-500,500,0,0,0]
    dids   = [0,0,0,2000,0,0]

    sc_defs = []
    cols_sc = st.columns(min(n_sc, 3))
    for i in range(n_sc):
        with cols_sc[i % 3]:
            with st.expander(dnames[i] if i < len(dnames) else f"תרחיש {i+1}", expanded=True):
                nm = st.text_input("שם", dnames[i] if i < len(dnames) else f"תרחיש {i+1}", key=f"sn{i}")
                rd = st.number_input("Δ שכ״ד",   value=drds[i] if i < len(drds) else 0, step=100, key=f"srd{i}")
                idd= st.number_input("Δ הכנסה",  value=dids[i] if i < len(dids) else 0, step=500, key=f"sid{i}")
                ed = st.number_input("Δ הוצאות", value=0, step=100, key=f"sed{i}")
            sc_defs.append(dict(name=nm, rd=rd, id=idd, ed=ed, color=COLORS[i]))

    st.divider()
    results, chart_map = [], {}
    for s in sc_defs:
        sn=combined_net+s["id"]; sr=rent+s["rd"]; sl=living_fc+s["ed"]
        sh=sr+fixed; sf=sn-sl-sh; sa=sf-savings_goal
        dfs=build_forecast(sn,sr,sl,fixed,init_sav_t,5,raise_p_t,rent_p_t,infl_p_t,return_p_t)
        ls=dfs.iloc[-1]
        results.append({**s,"sn":sn,"sr":sr,"sf":sf,"sa":sa,
                        "sav5s":ls["חיסכון_פשוט"],"sav5c":ls["חיסכון_ריבית"],"df":dfs})
        for _,row in dfs.iterrows():
            lb=row["label"]
            if lb not in chart_map: chart_map[lb]={"label":lb}
            chart_map[lb][s["name"]+" (פשוט)"]=row["חיסכון_פשוט"]
            chart_map[lb][s["name"]+" (+ריבית)"]=row["חיסכון_ריבית"]

    tbl=pd.DataFrame([{"תרחיש":r["name"],"שכ״ד":fmt(r["sr"]),"הכנסה":fmt(r["sn"]),
                        "פנוי/חודש":fmt(r["sa"]),"פשוט 5ש׳":fmt(r["sav5s"]),
                        "+ריבית 5ש׳":fmt(r["sav5c"]),"סטטוס":verdict(r["sa"])[0]} for r in results])
    st.dataframe(tbl, hide_index=True, use_container_width=True)

    fig_sc=go.Figure()
    cd=list(chart_map.values())
    for s in sc_defs:
        fig_sc.add_trace(go.Scatter(x=[d["label"] for d in cd],
            y=[d.get(s["name"]+" (פשוט)") for d in cd],
            name=s["name"]+" (פשוט)",line=dict(color=s["color"],width=1.5,dash="dot"),legendgroup=s["name"]))
        fig_sc.add_trace(go.Scatter(x=[d["label"] for d in cd],
            y=[d.get(s["name"]+" (+ריבית)") for d in cd],
            name=s["name"]+" (+ריבית)",line=dict(color=s["color"],width=2.5),legendgroup=s["name"]))
    hline(fig_sc)
    fig_sc.update_layout(**{**CHART_LAYOUT,"title":"📊 השוואת חיסכון"})
    st.plotly_chart(fig_sc, use_container_width=True)

    st.markdown("### 🏆 דירוג")
    medals=["🥇","🥈","🥉"]+[f"{i+1}." for i in range(3,10)]
    for i,r in enumerate(sorted(results,key=lambda r:r["sav5c"],reverse=True)):
        c1,c2,c3,c4=st.columns([3,2,2,2])
        c1.write(f"{medals[i]} **{r['name']}**")
        c2.write(fmt(r["sav5s"])); c3.write(fmt(r["sav5c"]))
        lb,cl=verdict(r["sa"])
        c4.markdown(f"<span style='color:{cl}'>{lb}</span>",unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════ TAB 3 ══
with tabs[3]:
    st.markdown("### 🏦 כמה זמן עד הון עצמי לדירה?")
    c1,c2,c3=st.columns(3)
    apt_price   = c1.number_input("מחיר דירה (₪)", 500_000,10_000_000,st.session_state.apt_price,50_000)
    eq_pct      = c2.slider("הון עצמי נדרש %",10,40,st.session_state.equity_pct)
    existing    = c3.number_input("חיסכון קיים (₪)",0,5_000_000,init_sav_t,10_000,key="ex_sav")

    equity_need = apt_price * eq_pct / 100
    gap         = max(0.0, equity_need - existing)
    ms          = max(1.0, after_goal)
    r_m         = return_p_t / 100 / 12

    # Simple
    mn_s = math.ceil(gap / ms) if ms > 0 else float("inf")

    # Compound
    if r_m > 0 and ms > 0:
        S = existing; mn_c = 0
        while S < equity_need and mn_c < 600:
            S = S*(1+r_m)+ms; mn_c+=1
        if mn_c>=600: mn_c=float("inf")
    else:
        mn_c = mn_s

    k1,k2,k3,k4=st.columns(4)
    k1.metric("מחיר דירה",      fmt(apt_price))
    k2.metric("הון עצמי נדרש",  fmt(equity_need))
    k3.metric("חסר עוד",        fmt(gap))
    k4.metric("חיסכון/חודש",    fmt(ms))

    st.divider()
    c1,c2=st.columns(2)
    if mn_s==float("inf"): c1.error("אין חיסכון חיובי")
    else:
        y,m=divmod(int(mn_s),12); c1.metric("זמן (פשוט)",f"{y} שנים {m} חודשים")
    if mn_c==float("inf"): c2.error("לא ניתן להגיע")
    else:
        y,m=divmod(int(mn_c),12); c2.metric(f"זמן (+ריבית {return_p_t}%)",f"{y} שנים {m} חודשים")

    tot=min(int(mn_s)+12 if mn_s!=float("inf") else 240,360)
    sv=sc=existing
    pts=[]
    for mm in range(tot+1):
        yr,mo=divmod(mm,12)
        lbl=f"{yr}ש׳" if mo==0 else (f"{mo}ח׳" if yr==0 else f"{yr}ש׳+{mo}")
        pts.append({"label":lbl,"פשוט":round(sv),"עם ריבית":round(sc)})
        sv+=ms; sc=sc*(1+r_m)+ms

    df_apt=pd.DataFrame(pts)
    fig_apt=go.Figure()
    fig_apt.add_trace(go.Scatter(x=df_apt["label"],y=df_apt["פשוט"],
        name="פשוט",line=dict(color="#818cf8",width=2,dash="dot")))
    fig_apt.add_trace(go.Scatter(x=df_apt["label"],y=df_apt["עם ריבית"],
        name=f"+ריבית {return_p_t}%",line=dict(color="#10b981",width=2.5),
        fill="tonexty",fillcolor="rgba(16,185,129,0.07)"))
    fig_apt.add_hline(y=equity_need, line_dash="dash", line_color="#f59e0b",
                      annotation_text=f"יעד {fmt(equity_need)}")
    fig_apt.update_layout(**{**CHART_LAYOUT,"title":"🏦 צבירת הון עצמי"})
    st.plotly_chart(fig_apt,use_container_width=True)

# ══════════════════════════════════════════════════════════════════ TAB 4 ══
with tabs[4]:
    st.markdown("### ⚖️ שכירות vs. משכנתא")
    c1,c2,c3=st.columns(3)
    apt2      = c1.number_input("מחיר דירה (₪)",500_000,10_000_000,st.session_state.apt_price,50_000,key="ap2")
    eq2       = c2.slider("הון עצמי %",10,40,st.session_state.equity_pct,key="eq2")
    mrate     = c3.slider("ריבית משכנתא %",1.0,10.0,st.session_state.mortgage_rate,0.1)
    c4,c5     = st.columns(2)
    myears    = c4.slider("תקופה (שנים)",10,30,st.session_state.mortgage_years)
    apt_appre = c5.slider("עליית ערך דירה שנתית %",0.0,10.0,4.0,0.5)

    eq_amount = apt2*eq2/100
    principal = apt2-eq_amount
    mrt       = monthly_mortgage(principal,mrate,myears)
    total_pay = mrt*myears*12
    total_int = total_pay-principal

    k1,k2,k3,k4=st.columns(4)
    k1.metric("קרן",          fmt(principal))
    k2.metric("תשלום חודשי",  fmt(mrt))
    k3.metric("סה״כ ריבית",   fmt(total_int))
    k4.metric("סה״כ תשלום",   fmt(total_pay))

    st.divider()

    rows_cmp=[]
    S_inv=eq_amount; r_m2=return_p_t/100/12
    for mm in range(myears*12+1):
        rent_m=rent*(1+rent_p_t/100)**(mm/12)
        apt_val=apt2*(1+apt_appre/100)**(mm/12)
        extra=mrt-rent_m
        S_inv=S_inv*(1+r_m2)+max(0,extra)
        if mm%6==0:
            yr,mo=divmod(mm,12)
            lbl=f"{yr}ש׳" if mo==0 else (f"{mo}ח׳" if yr==0 else f"{yr}ש׳+{mo}")
            rows_cmp.append({"label":lbl,"ערך דירה":round(apt_val),"עושר שוכר":round(S_inv)})

    df_cmp=pd.DataFrame(rows_cmp)
    fig_cmp=go.Figure()
    fig_cmp.add_trace(go.Scatter(x=df_cmp["label"],y=df_cmp["ערך דירה"],
        name="ערך נכס (קונה)",line=dict(color="#10b981",width=2.5)))
    fig_cmp.add_trace(go.Scatter(x=df_cmp["label"],y=df_cmp["עושר שוכר"],
        name="עושר שוכר (השקעות)",line=dict(color="#818cf8",width=2.5)))
    fig_cmp.update_layout(**{**CHART_LAYOUT,"title":"📊 ערך נכס vs. עושר שוכר"})
    st.plotly_chart(fig_cmp,use_container_width=True)

    diff=mrt-rent
    if diff>0:
        st.info(f"💡 משכנתא יקרה ב-**{fmt(diff)}/חודש** משכירות. כדאי לקנות רק אם הדירה עולה ב-{apt_appre:.1f}%+ בשנה.")
    else:
        st.success(f"💡 משכנתא זולה ב-**{fmt(-diff)}/חודש** — רכישה כדאית כלכלית.")
    st.caption("* לא כולל מס רכישה, שיפוץ, עמלות. לא ייעוץ פיננסי.")

# ══════════════════════════════════════════════════════════════════ TAB 5 ══
with tabs[5]:
    st.markdown("### 📤 ייצוא נתונים")

    # JSON
    profile_out = json.dumps({k: st.session_state.get(k, DEFAULTS[k]) for k in DEFAULTS},
                               ensure_ascii=False, indent=2)
    st.download_button("💾 ייצוא פרופיל JSON", profile_out, "rental_profile.json", "application/json")

    st.divider()

    # Excel
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        # Budget sheet
        bd=[("הכנסה נטו משולבת",combined_net),("שכר דירה",-rent),
            ("דיור נוסף",-fixed),("הוצאות חיים",-living)]
        if incl_child:
            bd+=[("הוצאות ילד",-child_exp_total),("חיסכון ממלכתי ילד",-child_state_sav),
                 ("קצבת ילדים",child_benefit)]
        bd+=[("פנוי לפני חיסכון",free_cash),("יעד חיסכון",-savings_goal),("נשאר",after_goal)]
        pd.DataFrame(bd,columns=["סעיף","סכום ₪"]).to_excel(writer,sheet_name="תקציב",index=False)

        # Forecast sheet
        df_t.drop(columns=["m"]).to_excel(writer,sheet_name="תחזית",index=False)

        # Scenarios sheet
        tbl.to_excel(writer,sheet_name="תרחישים",index=False)

    st.download_button("📥 הורד Excel",buf.getvalue(),"rental_analysis.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    st.divider()
    st.markdown(f"**סיכום — {date.today().strftime('%d/%m/%Y')}**")
    c1,c2,c3=st.columns(3)
    c1.metric("הכנסה נטו",fmt(combined_net))
    c2.metric("דיור סה״כ",fmt(housing))
    c3.metric("נשאר",fmt(after_goal))

st.caption("הכלי הוא להערכה עצמית בלבד. לא ייעוץ פיננסי.")
