/**
 * Analytics dashboard — a local-first, WakaTime-class activity report.
 *
 * Layout (top → bottom):
 *   1. KPI strip (today / AI / lines / this week)
 *   2. Focus split donut + AI-dependency gauge with weekly highlights
 *   3. Weekday bars + AI-agent breakdown
 *   4. Detailed all-time totals (7d / 30d / 365d, streaks, averages, best day)
 *   5. 365-day contribution heatmap (month + weekday labels, legend, tooltips)
 *   6. Projects, languages and auto-generated insights
 *   7. Tools & settings: security audit, export/share, Discord & privacy
 *
 * All numbers come from the local telemetry backend (`telemetry_dashboard` +
 * `telemetry_insights`); period totals, streaks and the language split are
 * derived on the client from the heatmap/project data. Charts are inline SVG —
 * no extra chart dependency. The background sampling/Discord driver runs at the
 * app root (see App.tsx), so this panel is now purely a viewer.
 */

import {
  Activity as ActivityIcon,
  Bot,
  Calendar,
  Clock,
  Code2,
  Download,
  Flame,
  FolderGit2,
  Lightbulb,
  RefreshCw,
  Send,
  Share2,
  Shield,
  Star,
  Timer,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { t, getLocale } from "@/lib/i18n";
import {
  auditRun,
  DEFAULT_DISCORD_TEMPLATES,
  discordApplySettings,
  discordStatus,
  fmtDuration,
  getTelemetryPrefs,
  loadDiscordSettings,
  saveDiscordSettings,
  setTelemetryPrefs,
  telemetryDashboard,
  telemetryExport,
  telemetryExportCsv,
  telemetryExportWakatime,
  telemetryInsights,
  telemetrySetMasking,
  telemetryShareableCard,
  telemetryWipe,
  telemetryYearCard,
  webhookSendDigest,
  type DashboardSnapshot,
  type DiscordSettings,
  type DiscordStatus,
  type DiscordTemplates,
  type HeatCell,
  type InsightsReport,
  type ProjectTime,
  type AuditReport,
} from "@/lib/analytics";
import { useProjectsStore } from "@/state/projectsStore";
import { confirmDestructive } from "@/state/uiStore";

// Categorical series palette from design tokens (follows the active theme)
// instead of hardcoded hex that ignored light/custom themes.
const AGENT_COLORS = [
  "var(--lx-chart-1)",
  "var(--lx-chart-2)",
  "var(--lx-chart-3)",
  "var(--lx-chart-4)",
  "var(--lx-chart-5)",
  "var(--lx-chart-6)",
];

export function AnalyticsPanel() {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DiscordSettings>(loadDiscordSettings);
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [insights, setInsights] = useState<InsightsReport | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await telemetryDashboard();
      setData(d);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    try {
      setStatus(await discordStatus());
    } catch {
      /* discord status optional */
    }
    try {
      setInsights(await telemetryInsights());
    } catch {
      /* insights optional */
    }
  }, []);

  // The background sampling + Discord driver now runs app-wide (App.tsx); this
  // panel only polls the read-only dashboard so the numbers stay fresh while
  // it's open.
  useEffect(() => {
    void refresh();
    // Skip refreshes while the window is hidden (tray-minimized) — matches the
    // document.hidden guards used by the other polling panels.
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const applySettings = useCallback(async (next: DiscordSettings) => {
    setSettings(next);
    // Persist first so the choice survives restarts even if the backend call
    // below fails (it is re-applied at next driver start).
    saveDiscordSettings(next);
    try {
      setStatus(await discordApplySettings(next));
      await telemetrySetMasking(next.mask_projects);
    } catch {
      /* keep optimistic state */
    }
  }, []);

  if (error && !data) {
    return (
      <div className="p-6 text-sm text-danger">
        {t("Failed to load analytics")}: {error}
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted">{t("Loading analytics…")}</div>;
  }

  return (
    <div className="h-full overflow-auto bg-surface text-strong">
      <div className="@container mx-auto flex max-w-5xl flex-col gap-5 p-4 @md:p-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
              <ActivityIcon size={18} />
            </span>
            <div>
              <h1 className="text-lg font-semibold leading-tight">{t("Analytics")}</h1>
              <p className="text-xs text-muted">{t("Local activity — last 365 days")}</p>
            </div>
          </div>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-strong transition hover:bg-raised"
          >
            <RefreshCw size={13} /> {t("Refresh")}
          </button>
        </header>

        {/* All read-only stats live in a memoized subtree so editing Discord
            settings / typing in the blacklist below never recomputes the derived
            metrics or re-renders the 365-cell heatmap. */}
        <AnalyticsDashboard data={data} insights={insights} />

        <SectionLabel>{t("Tools & settings")}</SectionLabel>

        <Card title={t("Security audit")} icon={<Shield size={13} />}>
          <AuditRunner onDone={() => void refresh()} />
        </Card>

        <Card title={t("Discord & Privacy")} icon={<Bot size={13} />}>
          <DiscordPrivacy settings={settings} status={status} onChange={applySettings} />
        </Card>

        <ExportShare />
      </div>
    </div>
  );
}

/**
 * The read-only statistics dashboard. Memoized on `data`/`insights` so it is
 * skipped entirely while the user interacts with the settings controls in the
 * parent (toggles, sliders, text inputs). Derived metrics are computed once per
 * data change via `useMemo` rather than on every render.
 */
const AnalyticsDashboard = memo(function AnalyticsDashboard({
  data,
  insights,
}: {
  data: DashboardSnapshot;
  insights: InsightsReport | null;
}) {
  const m = useMemo(() => {
    const digest = insights?.digest ?? null;
    const week = data.week;
    const weekCoding = week.reduce((s, d) => s + d.coding_seconds, 0);
    const weekAi = week.reduce((s, d) => s + d.ai_seconds, 0);
    const weekAudit = week.reduce((s, d) => s + d.audit_seconds, 0);
    const weekTotal = weekCoding + weekAi + weekAudit;

    const heat = data.heatmap;
    const total365 = heat.reduce((s, c) => s + c.seconds, 0);
    const activeDays = heat.reduce((n, c) => n + (c.seconds > 0 ? 1 : 0), 0);
    const langs = langBreakdown(data.projects);

    return {
      digest,
      weekCoding,
      weekAi,
      weekAudit,
      weekTotal,
      total7: sumLast(heat, 7),
      total30: sumLast(heat, 30),
      total365,
      activeDays,
      dailyAvg: activeDays > 0 ? Math.round(total365 / activeDays) : 0,
      best: bestDay(heat),
      longest: longestStreak(heat),
      aiDep: digest ? digest.ai_dependency_pct : weekTotal > 0 ? (weekAi / weekTotal) * 100 : 0,
      busiest: busiestWeekday(week),
      langs,
      langTotal: langs.reduce((s, l) => s + l.seconds, 0),
    };
  }, [data, insights]);

  return (
    <>
      <KpiStrip data={data} weekTotal={m.weekTotal} digest={m.digest} />

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Card title={t("Focus this week")} icon={<ActivityIcon size={13} />}>
          <FocusSplit coding={m.weekCoding} ai={m.weekAi} audit={m.weekAudit} total={m.weekTotal} />
        </Card>
        <Card title={t("AI dependency")} icon={<Bot size={13} />}>
          <AiDependency pct={m.aiDep} digest={m.digest} data={data} busiest={m.busiest} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <Card title={t("This week — coding vs AI")} icon={<Calendar size={13} />}>
          <WeekdayBars data={data} />
        </Card>
        <Card title={t("AI agents")} icon={<Bot size={13} />}>
          <AgentBreakdown data={data} />
        </Card>
      </div>

      <Card title={t("All-time activity")} icon={<TrendingUp size={13} />}>
        <DetailedTotals
          total7={m.total7}
          total30={m.total30}
          total365={m.total365}
          activeDays={m.activeDays}
          dailyAvg={m.dailyAvg}
          best={m.best}
          streak={data.streak_days}
          longest={m.longest}
        />
      </Card>

      <Card title={t("Activity — last 365 days")} icon={<Flame size={13} />}>
        <Heatmap data={data} />
      </Card>

      {m.langTotal > 0 ? (
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <Card title={t("Projects")} icon={<FolderGit2 size={13} />}>
            <ProjectLog data={data} />
          </Card>
          <Card title={t("Languages")} icon={<Code2 size={13} />}>
            <Languages langs={m.langs} total={m.langTotal} />
          </Card>
        </div>
      ) : (
        <Card title={t("Projects")} icon={<FolderGit2 size={13} />}>
          <ProjectLog data={data} />
        </Card>
      )}

      {insights && insights.insights.length > 0 && (
        <Card title={t("Insights")} icon={<Lightbulb size={13} />}>
          <InsightsList report={insights} />
        </Card>
      )}
    </>
  );
});

// ---- derived-metric helpers (pure) -------------------------------------

/** Sum of the last `days` heatmap cells (heatmap is ordered oldest → newest). */
function sumLast(cells: HeatCell[], days: number): number {
  if (days <= 0) return 0;
  return cells.slice(Math.max(0, cells.length - days)).reduce((s, c) => s + c.seconds, 0);
}

/** Longest run of consecutive active days anywhere in the heatmap. */
function longestStreak(cells: HeatCell[]): number {
  let best = 0;
  let cur = 0;
  for (const c of cells) {
    if (c.seconds > 0) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** The single most-active day, or null if there's no activity at all. */
function bestDay(cells: HeatCell[]): HeatCell | null {
  let b: HeatCell | null = null;
  for (const c of cells) if (!b || c.seconds > b.seconds) b = c;
  return b && b.seconds > 0 ? b : null;
}

/** Aggregate per-project seconds by primary language (skips unknown). */
function langBreakdown(projects: ProjectTime[]): { lang: string; seconds: number }[] {
  const map = new Map<string, number>();
  for (const p of projects) {
    if (!p.primary_lang) continue;
    map.set(p.primary_lang, (map.get(p.primary_lang) ?? 0) + p.seconds);
  }
  return [...map.entries()]
    .map(([lang, seconds]) => ({ lang, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Busiest day in the current week bucket as {label, seconds}. */
function busiestWeekday(week: DashboardSnapshot["week"]): { label: string; seconds: number } | null {
  let best: DashboardSnapshot["week"][number] | null = null;
  for (const d of week) {
    const total = d.coding_seconds + d.ai_seconds + d.audit_seconds;
    const bestTotal = best ? best.coding_seconds + best.ai_seconds + best.audit_seconds : -1;
    if (total > bestTotal) best = d;
  }
  if (!best) return null;
  const seconds = best.coding_seconds + best.ai_seconds + best.audit_seconds;
  if (seconds <= 0) return null;
  return { label: weekdayLabel(best.date), seconds };
}

function weekdayLabel(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(getLocale(), { weekday: "short" });
}

function fmtDay(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString(getLocale(), { day: "numeric", month: "short" });
}

function fmtHour(hour: number): string {
  return `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:00`;
}

// ---- building blocks ----------------------------------------------------

function Card({
  title,
  icon,
  right,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-edge bg-bar/40 p-4">
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            {icon}
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</span>
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

/** Up/down delta chip with arrow + colour. */
function Delta({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) {
    return <span className="text-muted">{t("no data yet")}</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 ${up ? "text-success" : "text-danger"}`}>
      {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {up ? "+" : "−"}
      {Math.abs(Math.round(pct))}%
    </span>
  );
}

function KpiStrip({
  data,
  weekTotal,
  digest,
}: {
  data: DashboardSnapshot;
  weekTotal: number;
  digest: InsightsReport["digest"] | null;
}) {
  const { today } = data;
  return (
    <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
      <Kpi
        icon={<Clock size={14} className="text-accent" />}
        label={t("Today")}
        value={fmtDuration(today.total_seconds)}
        sub={
          <span className="inline-flex items-center gap-1">
            <Flame size={12} className="text-warning" />
            {data.streak_days} {t("day streak")}
          </span>
        }
      />
      <Kpi
        icon={<Bot size={14} className="text-success" />}
        label={t("AI time today")}
        value={fmtDuration(today.ai_seconds)}
        sub={<Delta pct={today.ai_delta_pct} />}
      />
      <Kpi
        icon={<Code2 size={14} className="text-info" />}
        label={t("Lines changed")}
        value={
          <span className="tabular-nums">
            <span className="text-success">+{today.lines_added}</span>{" "}
            <span className="text-muted">/</span>{" "}
            <span className="text-danger">−{today.lines_removed}</span>
          </span>
        }
        sub={`${today.commits} ${t("commits")}`}
      />
      <Kpi
        icon={<Calendar size={14} className="text-accent" />}
        label={t("This week")}
        value={fmtDuration(weekTotal)}
        sub={<Delta pct={digest?.vs_last_week_pct} />}
      />
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-edge bg-bar/40 p-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums leading-none">{value}</div>
      <div className="mt-1.5 text-xs text-muted">{sub}</div>
    </div>
  );
}

/** Generic donut. A transparent trailing segment leaves the track showing,
 *  which gives a gauge look for single-value rings. */
function Donut({
  segments,
  size = 132,
  thickness = 16,
  center,
  sub,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  center?: string;
  sub?: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const r = size / 2 - thickness / 2 - 1;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      style={{ width: size, maxWidth: "100%", height: "auto", aspectRatio: "1 / 1" }}
      role="img"
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lx-edge)" strokeWidth={thickness} opacity={0.5} />
      <g transform={`translate(${size / 2},${size / 2}) rotate(-90)`}>
        {segments.map((s, i) => {
          const dash = (s.value / total) * c;
          const seg = (
            <circle
              key={i}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return seg;
        })}
      </g>
      {center && (
        <text
          x={size / 2}
          y={size / 2 + (sub ? -4 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-strong"
          fontSize={20}
          fontWeight={700}
        >
          {center}
        </text>
      )}
      {sub && (
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" dominantBaseline="central" className="fill-muted" fontSize={10}>
          {sub}
        </text>
      )}
    </svg>
  );
}

function LegendRow({ color, label, value, pct }: { color: string; label: string; value: string; pct: number }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="truncate text-strong">{label}</span>
      <span className="ml-auto shrink-0 tabular-nums text-muted">{value}</span>
      <span className="w-9 shrink-0 text-right tabular-nums text-muted">{pct}%</span>
    </li>
  );
}

function FocusSplit({ coding, ai, audit, total }: { coding: number; ai: number; audit: number; total: number }) {
  if (total <= 0) return <Empty>{t("No activity this week yet")}</Empty>;
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <Donut
        segments={[
          { value: coding, color: "var(--lx-info)" },
          { value: ai, color: "var(--lx-success)" },
          { value: audit, color: "var(--lx-warning)" },
        ]}
        center={fmtDuration(total)}
        sub={t("this week")}
      />
      <ul className="flex min-w-[150px] flex-1 flex-col gap-2.5">
        <LegendRow color="var(--lx-info)" label={t("Coding")} value={fmtDuration(coding)} pct={pct(coding)} />
        <LegendRow color="var(--lx-success)" label={t("AI")} value={fmtDuration(ai)} pct={pct(ai)} />
        <LegendRow color="var(--lx-warning)" label={t("Audit")} value={fmtDuration(audit)} pct={pct(audit)} />
      </ul>
    </div>
  );
}

function AiDependency({
  pct,
  digest,
  data,
  busiest,
}: {
  pct: number;
  digest: InsightsReport["digest"] | null;
  data: DashboardSnapshot;
  busiest: { label: string; seconds: number } | null;
}) {
  const rounded = Math.round(pct);
  const topProject = digest?.top_project ?? data.projects[0]?.name ?? null;
  const topAgent = digest?.top_agent ?? data.agents[0]?.agent ?? null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <Donut
        size={132}
        thickness={14}
        segments={[
          { value: rounded, color: "var(--lx-accent)" },
          { value: Math.max(0, 100 - rounded), color: "transparent" },
        ]}
        center={`${rounded}%`}
        sub={t("AI-assisted")}
      />
      <ul className="flex min-w-[160px] flex-1 flex-col gap-2.5 text-sm">
        <MiniStat icon={<Clock size={13} />} label={t("Prime time")} value={digest ? fmtHour(digest.prime_time_hour) : "—"} />
        <MiniStat
          icon={<Star size={13} />}
          label={t("Busiest day")}
          value={busiest ? `${busiest.label} · ${fmtDuration(busiest.seconds)}` : "—"}
        />
        <MiniStat icon={<FolderGit2 size={13} />} label={t("Top project")} value={topProject ?? "—"} />
        <MiniStat icon={<Bot size={13} />} label={t("Top agent")} value={topAgent ?? "—"} />
      </ul>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <span className="text-muted">{label}</span>
      <span className="ml-auto max-w-[55%] truncate text-right font-medium text-strong" title={value}>
        {value}
      </span>
    </li>
  );
}

function WeekdayBars({ data }: { data: DashboardSnapshot }) {
  const max = Math.max(1, ...data.week.map((d) => d.coding_seconds + d.ai_seconds + d.audit_seconds));
  const W = 360;
  const H = 170;
  const pad = 26;
  const bw = (W - pad * 2) / data.week.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("Weekday breakdown")}>
      <Legend
        items={[
          { c: "var(--lx-info)", l: t("Coding") },
          { c: "var(--lx-success)", l: t("AI") },
          { c: "var(--lx-warning)", l: t("Audit") },
        ]}
      />
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--lx-edge)" strokeWidth={1} />
      {data.week.map((d, i) => {
        const total = d.coding_seconds + d.ai_seconds + d.audit_seconds;
        const h = ((H - pad * 2) * total) / max;
        const x = pad + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const codingH = (h * d.coding_seconds) / Math.max(1, total);
        const aiH = (h * d.ai_seconds) / Math.max(1, total);
        const auditH = h - codingH - aiH;
        let y = H - pad;
        return (
          <g key={d.date}>
            {[
              { hh: codingH, c: "var(--lx-info)" },
              { hh: aiH, c: "var(--lx-success)" },
              { hh: auditH, c: "var(--lx-warning)" },
            ].map((seg, si) => {
              y -= seg.hh;
              return <rect key={si} x={x} y={y} width={w} height={Math.max(0, seg.hh)} fill={seg.c} rx={1.5} />;
            })}
            <text x={x + w / 2} y={H - pad + 13} textAnchor="middle" className="fill-muted" fontSize={8}>
              {weekdayLabel(d.date)}
            </text>
            <title>{`${weekdayLabel(d.date)}: ${fmtDuration(total)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ items }: { items: { c: string; l: string }[] }) {
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.l} transform={`translate(${26 + i * 86}, 10)`}>
          <rect width={8} height={8} fill={it.c} rx={1} />
          <text x={12} y={8} className="fill-muted" fontSize={8}>
            {it.l}
          </text>
        </g>
      ))}
    </g>
  );
}

function AgentBreakdown({ data }: { data: DashboardSnapshot }) {
  const total = data.agents.reduce((s, a) => s + a.seconds, 0);
  if (total <= 0 || data.agents.length === 0) return <Empty>{t("No AI activity yet")}</Empty>;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <Donut
        segments={data.agents.map((a, i) => ({ value: a.seconds, color: AGENT_COLORS[i % AGENT_COLORS.length] }))}
        center={fmtDuration(total)}
        sub={t("7 days")}
      />
      <ul className="flex min-w-[150px] flex-1 flex-col gap-2.5">
        {data.agents.map((a, i) => (
          <LegendRow
            key={a.agent}
            color={AGENT_COLORS[i % AGENT_COLORS.length]}
            label={a.agent}
            value={fmtDuration(a.seconds)}
            pct={Math.round((a.seconds / total) * 100)}
          />
        ))}
      </ul>
    </div>
  );
}

function DetailedTotals({
  total7,
  total30,
  total365,
  activeDays,
  dailyAvg,
  best,
  streak,
  longest,
}: {
  total7: number;
  total30: number;
  total365: number;
  activeDays: number;
  dailyAvg: number;
  best: HeatCell | null;
  streak: number;
  longest: number;
}) {
  const tiles: { icon: React.ReactNode; label: string; value: string; sub?: string }[] = [
    { icon: <Calendar size={13} />, label: t("Last 7 days"), value: fmtDuration(total7) },
    { icon: <Calendar size={13} />, label: t("Last 30 days"), value: fmtDuration(total30) },
    { icon: <Calendar size={13} />, label: t("Last 365 days"), value: fmtDuration(total365) },
    { icon: <ActivityIcon size={13} />, label: t("Active days"), value: `${activeDays}`, sub: t("of last year") },
    { icon: <Timer size={13} />, label: t("Daily average"), value: fmtDuration(dailyAvg), sub: t("per active day") },
    {
      icon: <Star size={13} />,
      label: t("Best day"),
      value: best ? fmtDuration(best.seconds) : "—",
      sub: best ? fmtDay(best.date) : undefined,
    },
    { icon: <Flame size={13} />, label: t("Current streak"), value: `${streak}`, sub: t("days") },
    { icon: <Flame size={13} />, label: t("Longest streak"), value: `${longest}`, sub: t("days") },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-edge bg-surface/50 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span className="text-muted">{tile.icon}</span>
            <span className="truncate">{tile.label}</span>
          </div>
          <div className="mt-1.5 text-lg font-semibold tabular-nums text-strong">{tile.value}</div>
          {tile.sub && <div className="mt-0.5 text-xs text-muted">{tile.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Heatmap({ data }: { data: DashboardSnapshot }) {
  const cells = data.heatmap;
  const max = Math.max(1, ...cells.map((c) => c.seconds));
  const trackFill = "color-mix(in srgb, var(--lx-edge) 55%, transparent)";
  const level = (s: number): string => {
    if (s <= 0) return trackFill;
    const r = s / max;
    if (r < 0.25) return "color-mix(in srgb, var(--lx-success) 28%, transparent)";
    if (r < 0.5) return "color-mix(in srgb, var(--lx-success) 50%, transparent)";
    if (r < 0.75) return "color-mix(in srgb, var(--lx-success) 75%, transparent)";
    return "var(--lx-success)";
  };
  const cell = 11;
  const gap = 3;
  // Monday-first weekday index (0=Mon … 6=Sun).
  const dow = (date: string) => (new Date(date + "T00:00:00").getDay() + 6) % 7;

  type Pos = { x: number; y: number; c: HeatCell };
  const positions: Pos[] = [];
  const monthLabels: { x: number; label: string }[] = [];
  let col = 0;
  let lastMonth = -1;
  cells.forEach((c, i) => {
    const wd = dow(c.date);
    if (i > 0 && wd === 0) col += 1;
    const x = col * (cell + gap);
    const y = wd * (cell + gap);
    positions.push({ x, y, c });
    const d = new Date(c.date + "T00:00:00");
    if (wd === 0 && d.getMonth() !== lastMonth) {
      monthLabels.push({ x, label: d.toLocaleDateString(getLocale(), { month: "short" }) });
      lastMonth = d.getMonth();
    }
  });

  const cols = col + 1;
  const leftGutter = 28;
  const topGutter = 14;
  const width = leftGutter + cols * (cell + gap);
  const height = topGutter + 7 * (cell + gap);
  const weekdayLabels = [
    { row: 0, label: t("Mon") },
    { row: 2, label: t("Wed") },
    { row: 4, label: t("Fri") },
  ];
  const legend = [0, 0.2, 0.45, 0.7, 1];

  return (
    <div className="flex flex-col gap-2">
      {/* Scale the whole year to the card width via viewBox so every day stays
       * visible without horizontal scrolling. `preserveAspectRatio` keeps the
       * cells square, and `maxWidth` stops the graph from upscaling past its
       * natural size on very wide screens. */}
      <div className="w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={t("Contribution heatmap")}
          className="h-auto w-full"
          style={{ maxWidth: width }}
        >
          {monthLabels.map((m, i) => (
            <text key={i} x={leftGutter + m.x} y={9} className="fill-muted" fontSize={9}>
              {m.label}
            </text>
          ))}
          {weekdayLabels.map((w) => (
            <text key={w.row} x={0} y={topGutter + w.row * (cell + gap) + cell - 1} className="fill-muted" fontSize={9}>
              {w.label}
            </text>
          ))}
          <g transform={`translate(${leftGutter},${topGutter})`}>
            {positions.map(({ x, y, c }) => (
              <rect key={c.date} x={x} y={y} width={cell} height={cell} rx={2} fill={level(c.seconds)}>
                <title>{`${fmtDay(c.date)}: ${fmtDuration(c.seconds)}`}</title>
              </rect>
            ))}
          </g>
        </svg>
      </div>
      <div className="flex items-center gap-1.5 self-end text-[10px] text-muted">
        <span>{t("Less")}</span>
        {legend.map((r, i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 rounded-sm"
            style={{
              background:
                r === 0 ? trackFill : `color-mix(in srgb, var(--lx-success) ${Math.round(r * 100)}%, transparent)`,
            }}
          />
        ))}
        <span>{t("More")}</span>
      </div>
    </div>
  );
}

function ProjectLog({ data }: { data: DashboardSnapshot }) {
  const max = Math.max(1, ...data.projects.map((p) => p.seconds));
  const total = Math.max(1, data.projects.reduce((s, p) => s + p.seconds, 0));
  if (data.projects.length === 0) return <Empty>{t("No projects yet")}</Empty>;
  return (
    <ul className="flex flex-col gap-2.5">
      {data.projects.map((p) => (
        <li key={p.name}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-strong">{p.name}</span>
              {p.primary_lang && (
                <span className="shrink-0 rounded border border-edge px-1.5 py-px text-[10px] text-muted">
                  {p.primary_lang}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {fmtDuration(p.seconds)} · {Math.round((p.seconds / total) * 100)}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-edge">
            <div className="h-full rounded bg-accent" style={{ width: `${(p.seconds / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Languages({ langs, total }: { langs: { lang: string; seconds: number }[]; total: number }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {langs.slice(0, 6).map((l, i) => {
        const pct = Math.round((l.seconds / total) * 100);
        return (
          <li key={l.lang}>
            <div className="flex items-center justify-between text-sm">
              <span className="truncate text-strong">{l.lang}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {fmtDuration(l.seconds)} · {pct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-edge">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, background: AGENT_COLORS[i % AGENT_COLORS.length] }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted">{children}</p>;
}

// ---- security audit -----------------------------------------------------

function SeverityBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "critical" | "high" | "medium" | "low";
}) {
  const colors = {
    critical: "bg-danger-soft text-danger",
    high: "bg-warning-soft-strong text-warning",
    medium: "bg-warning-soft text-warning",
    low: "bg-raised text-muted",
  } as const;
  return (
    <span className={`rounded px-2 py-0.5 ${colors[tone]}`}>
      {label}: <b>{value}</b>
    </span>
  );
}

/** Runs a static audit of the active project. The backend bumps the audit
 * counters and raises a critical Discord status when critical issues are found,
 * so this is the concrete producer for those features. */
function AuditRunner({ onDone }: { onDone: () => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const activeId = useProjectsStore((s) => s.activeId);
  const active = projects.find((p) => p.id === activeId) ?? null;
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!active?.path) return;
    setBusy(true);
    setErr(null);
    try {
      setReport(await auditRun(active.path));
      onDone();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-sm text-strong">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-muted">{active ? active.name : t("Open a project to audit it")}</span>
        <button
          type="button"
          disabled={!active || busy}
          onClick={() => void run()}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("Scanning…") : t("Run audit")}
        </button>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      {report && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <SeverityBadge label={t("Critical")} value={report.critical} tone="critical" />
            <SeverityBadge label={t("High")} value={report.high} tone="high" />
            <SeverityBadge label={t("Medium")} value={report.medium} tone="medium" />
            <SeverityBadge label={t("Low")} value={report.low} tone="low" />
          </div>
          <p className="text-xs text-muted">
            {report.files_scanned} {t("files")} · {report.lines_scanned} {t("lines scanned")}
          </p>
          <ul className="flex flex-col gap-1">
            {report.findings.slice(0, 8).map((f, i) => (
              <li key={i} className="truncate text-xs text-muted">
                <span className="font-mono text-muted">
                  {f.file}:{f.line}
                </span>{" "}
                — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- insights -----------------------------------------------------------

const SEVERITY_STYLE: Record<string, string> = {
  warning: "border-warning-soft-strong bg-warning-soft text-warning",
  positive: "border-success-soft-strong bg-success-soft text-success",
  info: "border-edge bg-bar/40 text-strong",
};

function InsightsList({ report }: { report: InsightsReport }) {
  return (
    <ul className="flex flex-col gap-2">
      {report.insights.map((i, idx) => (
        <li
          key={`${i.kind}-${idx}`}
          className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${SEVERITY_STYLE[i.severity] ?? SEVERITY_STYLE.info}`}
        >
          <Lightbulb size={15} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">{i.title}. </span>
            <span className="opacity-80">{i.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---- export & share -----------------------------------------------------

function downloadBlob(name: string, content: string, mime: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel downloads in some WebView/browser builds.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportShare() {
  const [slack, setSlack] = useState("");
  const [tgToken, setTgToken] = useState("");
  const [tgChat, setTgChat] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const exportCsv = async () => {
    try {
      downloadBlob("luxor-stats.csv", await telemetryExportCsv(90), "text/csv");
    } catch {
      /* ignore */
    }
  };
  const exportWaka = async () => {
    try {
      const json = await telemetryExportWakatime(7);
      downloadBlob("luxor-wakatime.json", JSON.stringify(json, null, 2), "application/json");
    } catch {
      /* ignore */
    }
  };
  const exportFull = async () => {
    try {
      const json = await telemetryExport();
      downloadBlob("luxor-stats.json", JSON.stringify(json, null, 2), "application/json");
    } catch {
      /* ignore */
    }
  };
  const shareWeekly = async () => {
    try {
      downloadBlob("luxor-week.svg", await telemetryShareableCard(), "image/svg+xml");
    } catch {
      /* ignore */
    }
  };
  const shareYear = async () => {
    try {
      downloadBlob("luxor-year.svg", await telemetryYearCard(), "image/svg+xml");
    } catch {
      /* ignore */
    }
  };
  const sendDigest = async () => {
    setSending(true);
    setSent(null);
    try {
      await webhookSendDigest({
        slack_url: slack || null,
        telegram_token: tgToken || null,
        telegram_chat: tgChat || null,
      });
      setSent(t("Digest sent"));
    } catch (e) {
      setSent(`Error: ${String(e)}`);
    } finally {
      setSending(false);
    }
  };

  const btn = "flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm text-strong hover:bg-raised";
  const statusTone = sent?.startsWith("Error:") ? "text-danger" : "text-muted";

  return (
    <details className="group rounded-xl border border-edge bg-bar/35 p-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-muted transition hover:text-strong">
        <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
          <Share2 size={13} /> {t("Export & Share")}
        </span>
        <span className="text-[11px] normal-case opacity-70 group-open:hidden">
          {t("Hidden advanced sharing options")}
        </span>
        <span className="hidden text-[11px] normal-case opacity-70 group-open:inline">
          {t("Click to collapse")}
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-4 border-t border-edge pt-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void shareWeekly()} className={btn}>
            <Share2 size={14} /> {t("Weekly card (SVG)")}
          </button>
          <button onClick={() => void shareYear()} className={btn}>
            <Share2 size={14} /> {t("Year in Review (SVG)")}
          </button>
          <button onClick={() => void exportCsv()} className={btn}>
            <Download size={14} /> CSV
          </button>
          <button onClick={() => void exportWaka()} className={btn}>
            <Download size={14} /> WakaTime JSON
          </button>
          <button onClick={() => void exportFull()} className={btn}>
            <Download size={14} /> {t("Full JSON")}
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("Send weekly digest to a webhook")}
          </span>
          <p className="text-xs text-muted">
            {t("Optional: provide Slack, or Telegram token plus chat ID. Leave this collapsed if you only need local exports.")}
          </p>
          <input
            value={slack}
            onChange={(e) => setSlack(e.target.value)}
            placeholder={t("Slack incoming webhook URL")}
            className="rounded-md border border-edge bg-surface px-2 py-1 text-sm"
          />
          <div className="flex flex-col gap-2 @lg:flex-row">
            <input
              value={tgToken}
              onChange={(e) => setTgToken(e.target.value)}
              placeholder={t("Telegram bot token")}
              className="w-full rounded-md border border-edge bg-surface px-2 py-1 font-mono text-sm"
            />
            <input
              value={tgChat}
              onChange={(e) => setTgChat(e.target.value)}
              placeholder={t("Telegram chat ID")}
              className="w-full rounded-md border border-edge bg-surface px-2 py-1 font-mono text-sm @lg:w-40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void sendDigest()}
              disabled={sending || (!slack.trim() && !(tgToken.trim() && tgChat.trim()))}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              <Send size={14} /> {sending ? t("Sending…") : t("Send digest now")}
            </button>
            {sent && <span className={`text-xs ${statusTone}`}>{sent}</span>}
          </div>
        </div>
      </div>
    </details>
  );
}

// ---- discord & privacy --------------------------------------------------

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-strong">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-edge"}`}
      >
        {/* Transform-based knob animation runs on the compositor (no layout work per frame). */}
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-150 ${checked ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
    </label>
  );
}

/** Grouped text inputs for one Discord activity frame's templates. */
function TemplateGroup({
  title,
  fields,
  templates,
  onChange,
}: {
  title: string;
  fields: [keyof DiscordTemplates, string][];
  templates: DiscordTemplates;
  onChange: (t: DiscordTemplates) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border border-edge/60 p-2">
      <legend className="px-1 text-xs font-medium text-strong">{title}</legend>
      {fields.map(([key, label]) => (
        <label key={key} className="flex flex-col gap-0.5 text-xs text-muted">
          <span>{label}</span>
          <input
            type="text"
            value={templates[key]}
            maxLength={128}
            placeholder={DEFAULT_DISCORD_TEMPLATES[key]}
            onChange={(e) => onChange({ ...templates, [key]: e.target.value })}
            className="rounded-md border border-edge bg-surface px-2 py-1 text-sm text-strong"
          />
        </label>
      ))}
    </fieldset>
  );
}

function DiscordPrivacy({
  settings,
  status,
  onChange,
}: {
  settings: DiscordSettings;
  status: DiscordStatus | null;
  onChange: (s: DiscordSettings) => void;
}) {
  const set = <K extends keyof DiscordSettings>(key: K, value: DiscordSettings[K]) =>
    onChange({ ...settings, [key]: value });

  // Local telemetry collection switches (Paranoid Mode / collection toggle).
  const [prefs, setPrefs] = useState(getTelemetryPrefs);
  const updatePrefs = (next: typeof prefs) => {
    const normalized = next.paranoid ? { ...next, collect: false } : next;
    setPrefs(normalized);
    setTelemetryPrefs(normalized);
  };

  const handleExport = async () => {
    try {
      const json = await telemetryExport();
      downloadBlob("luxor-stats.json", JSON.stringify(json, null, 2), "application/json");
    } catch {
      /* ignore */
    }
  };

  const handleWipe = async () => {
    const ok = await confirmDestructive({
      title: t("Delete ALL local activity history?"),
      message: t("This cannot be undone."),
      confirmLabel: t("Delete"),
    });
    if (!ok) return;
    try {
      await telemetryWipe();
    } catch {
      /* ignore */
    }
  };

  const statusLabel = status?.connected
    ? t("Discord activity active")
    : status?.ipc_connected
      ? t("Discord IPC connected — waiting for activity send")
      : status?.enabled
        ? t("Discord enabled — waiting for client")
        : t("Discord Rich Presence off");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-edge bg-bar/40 p-3">
        <Toggle
          label={t("Collect local activity statistics")}
          checked={prefs.collect && !prefs.paranoid}
          onChange={(v) => updatePrefs({ ...prefs, collect: v, paranoid: v ? false : prefs.paranoid })}
        />
        <Toggle
          label={t("Paranoid Mode (stop all tracking & Discord)")}
          checked={prefs.paranoid}
          onChange={(v) => updatePrefs({ ...prefs, paranoid: v, collect: v ? false : prefs.collect })}
        />
        <p className="text-xs text-muted">
          {t("When off (or in Paranoid Mode) Luxor records nothing in the background.")}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-edge bg-surface/50 px-3 py-2 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${
            status?.connected ? "bg-success" : status?.enabled ? "bg-warning" : "bg-muted"
          }`}
          style={status?.ipc_connected && !status.connected ? { background: "var(--lx-info)" } : undefined}
        />
        <span className="text-strong">{statusLabel}</span>
        {status?.enabled && !status.connected && (
          <span className="ml-auto text-muted">
            {status.ipc_connected
              ? t("Activity will appear after the next telemetry tick.")
              : status.reconnect_in_ms
                ? `${t("Retrying Discord connection in")} ${Math.max(1, Math.ceil(status.reconnect_in_ms / 1000))}s`
                : t("Is Discord, Vesktop or another RPC-compatible client running?")}
          </span>
        )}
      </div>
      {status?.enabled && !status.connected && status.last_error && (
        <p className="rounded-md border border-edge bg-surface/50 px-3 py-2 text-xs text-danger">
          {t("Last error")}: {status.last_error}
        </p>
      )}
      {settings.enabled && (prefs.paranoid || !prefs.collect) && (
        <p className="rounded-md border border-edge bg-surface/50 px-3 py-2 text-xs text-warning">
          {t("Rich Presence is paused while activity collection is off or Paranoid Mode is on.")}
        </p>
      )}

      <Toggle
        label={t("Enable Discord Rich Presence")}
        checked={settings.enabled}
        onChange={(v) => set("enabled", v)}
      />

      <div className="grid grid-cols-1 gap-2 @lg:grid-cols-2">
        <Toggle label={t("Show project name")} checked={settings.show_project} onChange={(v) => set("show_project", v)} />
        <Toggle label={t("Show git branch")} checked={settings.show_branch} onChange={(v) => set("show_branch", v)} />
        <Toggle label={t("Show AI status")} checked={settings.show_agent} onChange={(v) => set("show_agent", v)} />
        <Toggle label={t("Show audit results")} checked={settings.show_audit} onChange={(v) => set("show_audit", v)} />
      </div>

      <label className="flex flex-col gap-1 text-sm text-strong">
        <span className="flex items-center justify-between">
          <span>{t("Status rotation speed")}</span>
          <span className="tabular-nums text-muted">{settings.rotate_seconds}s</span>
        </span>
        <input
          type="range"
          min={5}
          max={30}
          value={settings.rotate_seconds}
          onChange={(e) => set("rotate_seconds", Number(e.target.value))}
          className="accent-accent"
        />
      </label>

      <details className="rounded-md border border-edge bg-bar/40 p-3">
        <summary className="cursor-pointer text-sm text-strong">
          {t("Customize status texts")}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">
            {t(
              "Customize the text of each Discord activity. Placeholders: {project}, {branch}, {agent}, {session}, {lines}, {issues}. Empty fields reset to defaults.",
            )}
          </p>
          <TemplateGroup
            title={t("Idle")}
            fields={[
              ["idle_details", t("Top line")],
              ["idle_state", t("Bottom line")],
            ]}
            templates={settings.templates}
            onChange={(tpl) => set("templates", tpl)}
          />
          <TemplateGroup
            title={t("Project frame")}
            fields={[
              ["project_details", t("Top line")],
              ["project_state", t("Bottom line (branch)")],
            ]}
            templates={settings.templates}
            onChange={(tpl) => set("templates", tpl)}
          />
          <TemplateGroup
            title={t("AI frame")}
            fields={[
              ["agent_details", t("Top line")],
              ["agent_state", t("Bottom line")],
            ]}
            templates={settings.templates}
            onChange={(tpl) => set("templates", tpl)}
          />
          <TemplateGroup
            title={t("Audit frame")}
            fields={[
              ["audit_details", t("Top line")],
              ["audit_state_ok", t("Bottom line (no issues)")],
              ["audit_state_issues", t("Bottom line (issues found)")],
            ]}
            templates={settings.templates}
            onChange={(tpl) => set("templates", tpl)}
          />
          <TemplateGroup
            title={t("Fallback (nothing else to show)")}
            fields={[
              ["fallback_details", t("Top line")],
              ["fallback_state", t("Bottom line")],
            ]}
            templates={settings.templates}
            onChange={(tpl) => set("templates", tpl)}
          />
          <button
            onClick={() => set("templates", { ...DEFAULT_DISCORD_TEMPLATES })}
            className="self-start rounded-md border border-edge px-3 py-1.5 text-sm text-strong hover:bg-raised"
          >
            {t("Reset texts to defaults")}
          </button>
        </div>
      </details>

      <Toggle
        label={t("Mask private project & file names")}
        checked={settings.mask_projects}
        onChange={(v) => set("mask_projects", v)}
      />

      <label className="flex flex-col gap-1 text-sm text-strong">
        <span>{t("Privacy blacklist (comma-separated, e.g. *work*, *nda*)")}</span>
        <input
          type="text"
          value={settings.blacklist.join(", ")}
          onChange={(e) =>
            set(
              "blacklist",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="*work*, *nda*"
          className="rounded-md border border-edge bg-surface px-2 py-1 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm text-strong">
        <span>{t("Discord application (client) ID")}</span>
        <input
          type="text"
          value={settings.client_id}
          onChange={(e) => set("client_id", e.target.value)}
          placeholder="123456789012345678"
          className="rounded-md border border-edge bg-surface px-2 py-1 font-mono text-sm"
        />
      </label>

      <p className="rounded-md border border-edge bg-bar/60 px-3 py-2 text-xs text-muted">
        🔒 {t("All statistics are stored locally in local_stats.db and are NEVER sent to any server.")}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleExport()}
          className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm text-strong hover:bg-raised"
        >
          <Download size={14} /> {t("Export JSON")}
        </button>
        <button
          onClick={() => void handleWipe()}
          className="flex items-center gap-1.5 rounded-md border border-danger-soft-strong px-3 py-1.5 text-sm text-danger hover:bg-danger-soft"
        >
          <Trash2 size={14} /> {t("Delete all history")}
        </button>
      </div>
    </div>
  );
}
