import streamlit as st
import numpy as np
import pandas as pd
import plotly.graph_objects as go

# ── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="בדיקת התכנות שכירות",
    page_icon="🏠",
    layout="centered",
)

# ── RTL + style ───────────────────────────────────────────────────────────────
st.markdown("""
<style>
  body, .stApp { direction: rtl; }
  h1, h2, h3, label, .stMarkdown, .stMetric { direction: rtl; text-align: right; }
  .stSlider > div { direction: ltr; }
  .stNumberInput input { text-align: right; }
  .stTabs [data-baseweb="tab"] { font-size: 15px; font-weight: 600; }
  .metric-box {
    background: #0f172a; border: 1px solid #1e293b; border-radius: 10px;
    padding: 12px 16px; text-align: center; margin-bottom: 8px;
  }
  .metric-label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
  .metric-value { font-size: 20px; font-weight: 700; }
  .rule-row {
    background: #0f172a; border-radius: 8px; padding: 10px 14px;
    display: flex; justify-content: space-between; margin-bottom: 6px;
  }
</style>
""", unsafe_allow_html=True)

# ── Helpers ───────────────────────────────────────────────────────────────────
def fmt(n: float) -> str:
    return f"₪{n:,.0f}"

def gross_to_net(g: float) -> float:
    if g <= 7_000:  return g * 0.88
    if g <= 12_000: return g * 0.83
    if g <= 20_000: return g * 0.77
    return g * 0.72

def verdict(v: float):
    if v < 0:     return "⛔ בעייתי",    "#ef4444"
    if v < 500:   return "⚠️ גבולי מאוד", "#f97316"
    if v < 1_500: return "🟡 גבולי",      "#eab308"
    if v < 3_000: return "✅ סביר",        "#22c55e"
    return            "💚 מצוין",          "#16a34a"

def build_forecast(net0, rent0, living0, fixed, init_sav, years,
                   raise_p, rent_p, infl_p, return_p):
    """Returns DataFrame with monthly data, sampled quarterly."""
    rows = []
    S_simple = S_compound = init_sav
    net = net0; rent = rent0; living = living0
    r = return_p / 100 / 12

    for m in range(years * 12 + 1):
        if m > 0 and m % 12 == 0:
            net    *= 1 + raise_p / 100
            rent   *= 1 + rent_p  / 100
            living *= 1 + infl_p  / 100

        free = net - living - rent - fixed
        S_simple   = S_simple + free
        S_compound = S_compound * (1 + r) + free

        if m % 3 == 0:
            yr, mo = divmod(m, 12)
            if m == 0:       label = "היום"
            elif mo == 0:    label = f"{yr}ש׳"
            elif yr == 0:    label = f"{mo}ח׳"
            else:            label = f"{yr}ש׳+{mo}"
            rows.append(dict(
                m=m, label=label,
                חיסכון_פשוט=round(S_simple),
                חיסכון_ריבית=round(S_compound),
                פנוי_לחודש=round(free),
                שכירות=round(rent),
                הכנסה=round(net),
            ))
    return pd.DataFrame(rows)

# ── Sidebar — shared parameters ───────────────────────────────────────────────
with st.sidebar:
    st.markdown("## ⚙️ פרמטרים כלליים")

    income_type = st.radio("סוג הכנסה", ["נטו", "ברוטו"], horizontal=True)
    income = st.number_input("הכנסה חודשית (₪)", min_value=1000, max_value=100_000,
                              value=12_000, step=500)
    net_income = income if income_type == "נטו" else gross_to_net(income)
    if income_type == "ברוטו":
        st.caption(f"נטו משוערת: **{fmt(net_income)}**")

    st.divider()
    st.markdown("**🏘️ דיור**")
    rent       = st.number_input("שכר דירה (₪)",     min_value=0, max_value=30_000, value=4_500, step=100)
    vaad       = st.number_input("ועד בית (₪)",      min_value=0, max_value=2_000,  value=150,   step=10)
    arnona     = st.number_input("ארנונה (₪)",       min_value=0, max_value=5_000,  value=350,   step=10)
    electricity= st.number_input("חשמל (₪)",         min_value=0, max_value=2_000,  value=200,   step=10)
    water      = st.number_input("מים (₪)",          min_value=0, max_value=1_000,  value=80,    step=10)
    fixed      = vaad + arnona + electricity + water
    housing    = rent + fixed

    st.divider()
    st.markdown("**🧾 הוצאות חיים**")
    preset = st.selectbox("פרסט", ["ממוצע", "מינימלי", "נוח", "מותאם אישית"])
    preset_vals = {
        "מינימלי": dict(food=1800, transport=400,  phone=60,  subs=100, gym=0,   misc=300),
        "ממוצע":   dict(food=2500, transport=700,  phone=100, subs=200, gym=200, misc=600),
        "נוח":     dict(food=3500, transport=1200, phone=120, subs=350, gym=280, misc=1000),
    }
    if preset != "מותאם אישית":
        pv = preset_vals[preset]
    else:
        pv = dict(food=2500, transport=700, phone=100, subs=200, gym=200, misc=600)

    with st.expander("פירוט הוצאות חיים", expanded=(preset == "מותאם אישית")):
        food       = st.number_input("🛒 מזון",     value=pv["food"],      step=50, key="food")
        transport  = st.number_input("🚗 תחבורה",   value=pv["transport"], step=50, key="transport")
        phone      = st.number_input("📱 טלפון",    value=pv["phone"],     step=10, key="phone")
        subs       = st.number_input("📺 מנויים",   value=pv["subs"],      step=10, key="subs")
        gym        = st.number_input("💪 ספורט",    value=pv["gym"],       step=10, key="gym")
        misc       = st.number_input("🎲 שונות",    value=pv["misc"],      step=50, key="misc")
    living = food + transport + phone + subs + gym + misc

    st.divider()
    savings_goal = st.number_input("🏦 יעד חיסכון אישי/חודש (₪)",
                                    min_value=0, max_value=20_000, value=1_500, step=100)

    st.divider()
    st.markdown("**👶 ילד בן שנתיים**")
    incl_child = st.toggle("כלול בחישוב", value=False)
    child_exp_total = child_benefit = child_state_sav = 0
    if incl_child:
        with st.expander("הוצאות ילד", expanded=True):
            daycare    = st.number_input("🏫 גן/מעון",  value=2200, step=50)
            cfood      = st.number_input("🍼 מזון",     value=400,  step=50)
            diapers    = st.number_input("🧷 חיתולים", value=250,  step=10)
            clothing   = st.number_input("👕 ביגוד",   value=200,  step=10)
            medical    = st.number_input("💊 רפואה",   value=150,  step=10)
            activities = st.number_input("🎨 חוגים",   value=150,  step=10)
            child_misc = st.number_input("📦 שונות",   value=200,  step=10)
        child_exp_total = daycare + cfood + diapers + clothing + medical + activities + child_misc
        with st.expander("הטבות וחיסכון"):
            child_state_sav = st.number_input("💰 חיסכון ממלכתי (יוצא)", value=200, step=10)
            child_benefit   = st.number_input("🎁 קצבת ילדים (נכנסת)",  value=180, step=10)
            st.caption("המדינה מוסיפה ~₪50/חודש לחיסכון ממלכתי. קצבת ילדים ~₪180 לילד ראשון/שני.")

# ── Core calculation ──────────────────────────────────────────────────────────
effective_net  = net_income + child_benefit
total_spend    = living + child_exp_total + housing + child_state_sav
free_cash      = effective_net - total_spend
after_goal     = free_cash - savings_goal
rent_pct       = rent / net_income * 100 if net_income > 0 else 0
housing_pct    = housing / net_income * 100 if net_income > 0 else 0
child_net_cost = child_exp_total + child_state_sav - child_benefit

# ── Tabs ─────────────────────────────────────────────────────────────────────
st.markdown("<h1 style='text-align:center'>🏠 בדיקת התכנות שכירות</h1>", unsafe_allow_html=True)
tab_base, tab_forecast, tab_scenarios = st.tabs(["🏠 בסיס", "📈 תחזית חיסכון", "🔀 תרחישים"])

# ════════════════════════════════════════════════════════════════════ TAB 0 ══
with tab_base:
    label, color = verdict(after_goal)
    st.markdown(f"<h2 style='text-align:center; color:{color}'>{label}</h2>", unsafe_allow_html=True)

    # Budget summary
    cols = st.columns(3)
    cols[0].metric("הכנסה נטו",          fmt(net_income))
    cols[1].metric("סה״כ הוצאות",        fmt(total_spend + savings_goal))
    cols[2].metric("נשאר אחרי הכל",      fmt(after_goal),
                   delta=None if after_goal >= 0 else f"גירעון {fmt(-after_goal)}")

    st.divider()

    # Detailed breakdown
    with st.expander("📋 פירוט תקציב מלא", expanded=True):
        data = {
            "סעיף": [],
            "סכום": [],
        }
        def add(label, val, negative=False):
            data["סעיף"].append(label)
            data["סכום"].append(f"{'—' if negative else '+'} {fmt(val)}")

        add("הכנסה נטו",              net_income)
        if incl_child:
            add("+ קצבת ילדים",       child_benefit)
        add("שכר דירה",               rent,          negative=True)
        add("עלויות דיור נוספות",     fixed,         negative=True)
        add("הוצאות חיים",            living,        negative=True)
        if incl_child:
            add("הוצאות ילד",         child_exp_total, negative=True)
            add("חיסכון ממלכתי ילד", child_state_sav, negative=True)
        data["סעיף"].append("── פנוי לפני חיסכון")
        data["סכום"].append(fmt(free_cash))
        add("יעד חיסכון אישי",       savings_goal,  negative=True)
        data["סעיף"].append("══ נשאר אחרי הכל")
        data["סכום"].append(fmt(after_goal))

        df_budget = pd.DataFrame(data)
        st.dataframe(df_budget, hide_index=True, use_container_width=True)

    # Rules of thumb
    st.markdown("### כללי אצבע")
    rules = [("כלל 25%", 0.25, "מרווח גבוה"), ("כלל 30%", 0.30, "סטנדרט בינ״ל"), ("כלל 33%", 0.333, "גבול עליון")]
    for rule_name, pct, desc in rules:
        max_rent = net_income * pct
        ok = rent <= max_rent
        icon = "✅" if ok else "❌"
        c1, c2, c3 = st.columns([2, 2, 1])
        c1.write(f"**{rule_name}** — {desc}")
        c2.write(f"מקסימום: {fmt(max_rent)}")
        c3.write(icon)

    # Housing %
    st.divider()
    col1, col2 = st.columns(2)
    col1.metric("שכ״ד מתוך נטו", f"{rent_pct:.1f}%",
                help="מומלץ מתחת ל-30%")
    col2.metric("דיור כולל מתוך נטו", f"{housing_pct:.1f}%",
                help="כולל ועד, ארנונה, חשמל, מים")

    if incl_child:
        st.divider()
        st.metric("עלות נטו של הילד לחודש", fmt(child_net_cost),
                  help="הוצאות + חיסכון ממלכתי פחות קצבת ילדים")

# ════════════════════════════════════════════════════════════════════ TAB 1 ══
with tab_forecast:
    st.markdown("### ⚙️ פרמטרי תחזית")
    c1, c2 = st.columns(2)
    years    = c1.slider("אופק זמן (שנים)", 1, 15, 5)
    init_sav = c2.number_input("חיסכון התחלתי (₪)", 0, 500_000, 10_000, 1_000)
    c3, c4 = st.columns(2)
    raise_p  = c3.slider("עליית שכר שנתית %", 0.0, 15.0, 3.0, 0.5)
    rent_p   = c4.slider("עליית שכ״ד שנתית %", 0.0, 15.0, 5.0, 0.5)
    c5, c6 = st.columns(2)
    infl_p   = c5.slider("אינפלציית הוצאות %", 0.0, 10.0, 3.0, 0.5)
    return_p = c6.slider("תשואה שנתית (חיסכון + ריבית) %", 0.0, 15.0, 6.0, 0.5)

    living_for_forecast = living + child_net_cost
    df = build_forecast(net_income, rent, living_for_forecast, fixed,
                        init_sav, years, raise_p, rent_p, infl_p, return_p)

    # KPIs
    last = df.iloc[-1]
    k1, k2, k3 = st.columns(3)
    k1.metric(f"חיסכון פשוט ({years}ש׳)",      fmt(last["חיסכון_פשוט"]))
    k2.metric(f"+ ריבית {return_p:.1f}% ({years}ש׳)", fmt(last["חיסכון_ריבית"]))
    k3.metric(f"שכ״ד עתידי ({years}ש׳)",         fmt(last["שכירות"]))

    st.divider()

    # Savings chart — both modes
    fig_sav = go.Figure()
    fig_sav.add_trace(go.Scatter(
        x=df["label"], y=df["חיסכון_פשוט"],
        name="חיסכון פשוט", line=dict(color="#818cf8", width=2, dash="dot"),
    ))
    fig_sav.add_trace(go.Scatter(
        x=df["label"], y=df["חיסכון_ריבית"],
        name=f"חיסכון + ריבית {return_p:.1f}%", line=dict(color="#10b981", width=2.5),
        fill="tonexty", fillcolor="rgba(16,185,129,0.07)",
    ))
    fig_sav.add_hline(y=0, line_dash="dash", line_color="#ef444466")
    fig_sav.update_layout(
        title="📈 חיסכון צבור — פשוט vs. עם ריבית",
        paper_bgcolor="#0f172a", plot_bgcolor="#080c14",
        font=dict(color="#e2e8f0", size=12),
        legend=dict(bgcolor="#0f172a", bordercolor="#1e293b"),
        yaxis=dict(tickprefix="₪", gridcolor="#1e293b"),
        xaxis=dict(gridcolor="#1e293b"),
        hovermode="x unified",
        margin=dict(t=50, b=30, l=10, r=10),
    )
    st.plotly_chart(fig_sav, use_container_width=True)

    # Free cash chart
    fig_free = go.Figure()
    fig_free.add_trace(go.Scatter(
        x=df["label"], y=df["פנוי_לחודש"],
        name="פנוי לחודש", line=dict(color="#6366f1", width=2.5),
        fill="tozeroy",
        fillcolor="rgba(99,102,241,0.1)",
    ))
    fig_free.add_hline(y=0, line_dash="dash", line_color="#ef4444")
    fig_free.update_layout(
        title="💵 פנוי לחודש לאורך זמן",
        paper_bgcolor="#0f172a", plot_bgcolor="#080c14",
        font=dict(color="#e2e8f0", size=12),
        yaxis=dict(tickprefix="₪", gridcolor="#1e293b"),
        xaxis=dict(gridcolor="#1e293b"),
        hovermode="x unified",
        showlegend=False,
        margin=dict(t=50, b=30, l=10, r=10),
    )
    st.plotly_chart(fig_free, use_container_width=True)

    st.caption(f"שכר +{raise_p}% · שכ״ד +{rent_p}% · הוצאות +{infl_p}% · תשואה {return_p}% בשנה")

# ════════════════════════════════════════════════════════════════════ TAB 2 ══
with tab_scenarios:
    st.markdown("### הגדר תרחישים")

    n_scenarios = st.number_input("מספר תרחישים", 2, 6, 4, 1)
    COLORS = ["#6366f1", "#10b981", "#f59e0b", "#818cf8", "#f43f5e", "#06b6d4"]

    scenario_defs = []
    default_names  = ["תרחיש נוכחי", "דירה זולה ב-500₪", "דירה יקרה ב-500₪", "העלאה בשכר 2K", "תרחיש 5", "תרחיש 6"]
    default_rd     = [0, -500, 500, 0, 0, 0]
    default_id_val = [0, 0, 0, 2000, 0, 0]
    default_ed     = [0, 0, 0, 0, 0, 0]

    cols_sc = st.columns(min(n_scenarios, 3))
    for i in range(n_scenarios):
        col = cols_sc[i % 3]
        with col:
            with st.expander(f"תרחיש {i+1}", expanded=True):
                name = st.text_input("שם", default_names[i] if i < len(default_names) else f"תרחיש {i+1}", key=f"sc_name_{i}")
                rd   = st.number_input("Δ שכ״ד (₪)", value=default_rd[i],     step=100, key=f"sc_rd_{i}")
                id_v = st.number_input("Δ הכנסה (₪)", value=default_id_val[i], step=500, key=f"sc_id_{i}")
                ed   = st.number_input("Δ הוצאות (₪)", value=default_ed[i],   step=100, key=f"sc_ed_{i}")
                scenario_defs.append(dict(name=name, rd=rd, id=id_v, ed=ed, color=COLORS[i]))

    st.divider()

    # Compute results
    results = []
    for s in scenario_defs:
        s_net    = net_income + s["id"]
        s_rent   = rent + s["rd"]
        s_living = living_for_forecast + s["ed"]
        s_house  = s_rent + fixed
        s_free   = s_net - s_living - s_house
        s_after  = s_free - savings_goal

        df_s = build_forecast(s_net, s_rent, s_living, fixed,
                               init_sav, 5, raise_p, rent_p, infl_p, return_p)
        last_s = df_s.iloc[-1]
        results.append({
            **s,
            "s_net": s_net, "s_rent": s_rent, "s_free": s_free, "s_after": s_after,
            "sav5_simple":   last_s["חיסכון_פשוט"],
            "sav5_compound": last_s["חיסכון_ריבית"],
            "df": df_s,
        })

    # Summary table
    tbl = pd.DataFrame([{
        "תרחיש":          r["name"],
        "שכ״ד":           fmt(r["s_rent"]),
        "הכנסה":          fmt(r["s_net"]),
        "פנוי/חודש":      fmt(r["s_after"]),
        "חיסכון פשוט 5ש׳": fmt(r["sav5_simple"]),
        "+ ריבית 5ש׳":    fmt(r["sav5_compound"]),
        "סטטוס":          verdict(r["s_after"])[0],
    } for r in results])
    st.dataframe(tbl, hide_index=True, use_container_width=True)

    st.divider()

    # Comparison chart
    fig_sc = go.Figure()
    for r in results:
        fig_sc.add_trace(go.Scatter(
            x=r["df"]["label"], y=r["df"]["חיסכון_פשוט"],
            name=r["name"] + " (פשוט)",
            line=dict(color=r["color"], width=1.5, dash="dot"),
            legendgroup=r["name"],
        ))
        fig_sc.add_trace(go.Scatter(
            x=r["df"]["label"], y=r["df"]["חיסכון_ריבית"],
            name=r["name"] + " (+ריבית)",
            line=dict(color=r["color"], width=2.5),
            legendgroup=r["name"],
        ))

    fig_sc.add_hline(y=0, line_dash="dash", line_color="#ef444466")
    fig_sc.update_layout(
        title="📊 השוואת חיסכון — כל התרחישים, 5 שנים",
        paper_bgcolor="#0f172a", plot_bgcolor="#080c14",
        font=dict(color="#e2e8f0", size=12),
        legend=dict(bgcolor="#0f172a", bordercolor="#1e293b", font=dict(size=10)),
        yaxis=dict(tickprefix="₪", gridcolor="#1e293b"),
        xaxis=dict(gridcolor="#1e293b"),
        hovermode="x unified",
        margin=dict(t=50, b=30, l=10, r=10),
    )
    st.plotly_chart(fig_sc, use_container_width=True)
    st.caption("קו מקווקו = חיסכון פשוט · קו מלא = עם ריבית דה-ריבית")

    # Ranking
    st.markdown("### 🏆 דירוג לפי חיסכון + ריבית (5 שנים)")
    ranked = sorted(results, key=lambda r: r["sav5_compound"], reverse=True)
    medals = ["🥇", "🥈", "🥉"] + [f"{i+1}." for i in range(3, 10)]
    for i, r in enumerate(ranked):
        c1, c2, c3, c4 = st.columns([3, 2, 2, 2])
        c1.write(f"{medals[i]} **{r['name']}**")
        c2.write(fmt(r["sav5_simple"]))
        c3.write(fmt(r["sav5_compound"]))
        lbl, col = verdict(r["s_after"])
        c4.markdown(f"<span style='color:{col}'>{lbl}</span>", unsafe_allow_html=True)

st.caption("הכלי הוא להערכה עצמית בלבד. לא ייעוץ פיננסי.")
