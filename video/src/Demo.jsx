import { AbsoluteFill, Sequence, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'

const { fontFamily: SANS } = loadInter('normal', { weights: ['400', '600', '700'], subsets: ['latin'] })
const { fontFamily: MONO } = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] })

export const FPS = 30

// Scene timeline, in frames.
const T = {
  title: [0, 54],
  problem: [54, 138],
  gate: [138, 276],
  fix: [276, 372],
  outro: [372, 450],
}
export const DURATION = T.outro[1]

// Palette of the README assets.
const C = {
  bg: '#16161a',
  panel: '#1c1c21',
  border: '#2a2a31',
  text: '#e4e4e7',
  muted: '#a1a1aa',
  dim: '#52525b',
  opus: '#e2484f',
  sonnet: '#f48815',
  haiku: '#efb219',
  green: '#4eba65',
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const ease = Easing.bezier(0.25, 0.1, 0.25, 1)

// Fade a scene in over its first frames and out over its last.
const useSceneFade = (len, inF = 6, outF = 6) => {
  const f = useCurrentFrame()
  return interpolate(f, [0, inF, len - outF, len], [0, 1, 1, 0], clamp)
}

const rise = (f, start, dur = 14) => ({
  opacity: interpolate(f, [start, start + dur], [0, 1], clamp),
  transform: `translateY(${interpolate(f, [start, start + dur], [16, 0], { ...clamp, easing: ease })}px)`,
})

const Caption = ({ children, sub, f, start = 0 }) => (
  <div style={{ position: 'absolute', top: 70, left: 0, right: 0, textAlign: 'center', ...rise(f, start) }}>
    <div style={{ fontFamily: SANS, fontSize: 44, fontWeight: 700, color: C.text, letterSpacing: -1 }}>{children}</div>
    {sub ? <div style={{ fontFamily: SANS, fontSize: 26, color: C.muted, marginTop: 12 }}>{sub}</div> : null}
  </div>
)

const Window = ({ title, width, children, style }) => (
  <div style={{ width, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.45)', ...style }}>
    <div style={{ height: 40, background: C.panel, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 16px', position: 'relative' }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: '#3f3f46', marginRight: 8 }} />)}
      <div style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontFamily: SANS, fontSize: 15, color: C.muted }}>{title}</div>
    </div>
    <div style={{ padding: '22px 26px', fontFamily: MONO, fontSize: 21, lineHeight: 1.55, color: C.text }}>{children}</div>
  </div>
)

// ── 1. Title ────────────────────────────────────────────────────────────────
const Title = () => {
  const f = useCurrentFrame()
  const fade = useSceneFade(T.title[1] - T.title[0], 1, 8)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: fade }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: C.muted, ...rise(f, 0) }}>CLAUDE CODE PLUGIN</div>
        <div style={{ fontFamily: SANS, fontSize: 132, fontWeight: 700, color: C.text, letterSpacing: -4, marginTop: 8, ...rise(f, 4) }}>ultraguard</div>
        <div style={{ fontFamily: SANS, fontSize: 32, color: C.text, marginTop: 6, ...rise(f, 6) }}>Every ultracode workflow on the right model.</div>
      </div>
    </AbsoluteFill>
  )
}

// ── 2. The problem: every agent inherits Opus ───────────────────────────────
const ROW_X = (i, n, gap = 92) => 640 - ((n - 1) * gap) / 2 + i * gap

const Dot = ({ x, y, color, scale = 1, label, labelOpacity = 1 }) => (
  <div style={{ position: 'absolute', left: x - 26, top: y - 26, width: 52, height: 52, transform: `scale(${scale})` }}>
    <div style={{ width: 52, height: 52, borderRadius: 26, background: color, boxShadow: `0 0 28px color-mix(in srgb, ${color} 33%, transparent)` }} />
    {label ? <div style={{ position: 'absolute', top: 62, left: -20, right: -20, textAlign: 'center', fontFamily: MONO, fontSize: 19, color, opacity: labelOpacity }}>{label}</div> : null}
  </div>
)

const Problem = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fade = useSceneFade(T.problem[1] - T.problem[0])
  const counter = interpolate(f, [34, 44], [0, 1], clamp)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Caption f={f} sub="Every subagent inherits the session's Opus.">A workflow fans out.</Caption>
      {Array.from({ length: 10 }, (_, i) => {
        const s = spring({ frame: f - 10 - i * 2, fps, config: { damping: 12, stiffness: 160 } })
        return <Dot key={i} x={ROW_X(i, 10)} y={350} color={C.opus} scale={s} label="opus" labelOpacity={s} />
      })}
      <div style={{ position: 'absolute', top: 500, left: 0, right: 0, textAlign: 'center', opacity: counter, transform: `scale(${0.9 + 0.1 * counter})` }}>
        <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700, color: C.opus }}>10 Opus agents at once</span>
      </div>
    </AbsoluteFill>
  )
}

// ── 3. The gate reads the script and denies ─────────────────────────────────
const CODE = [
  ['await parallel(topics.map(t => () =>', null],
  ['  agent(`Research ${t}`, {', null],
  ["    label: 'synth: research',", 'label'],
  ["    model: 'opus', effort: 'high'", 'model'],
  ['  })))', null],
]

const Gate = () => {
  const f = useCurrentFrame()
  const fade = useSceneFade(T.gate[1] - T.gate[0])
  const scan = interpolate(f, [12, 36], [0, CODE.length], clamp)
  const denyIn = interpolate(f, [38, 48], [0, 1], clamp)
  const shake = f >= 38 && f < 52 ? Math.sin((f - 38) * 2.2) * interpolate(f, [38, 52], [8, 0], clamp) : 0
  const flagged = f >= 38
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Caption f={f} sub="It reads the script and never runs it.">Before launch, the gate checks every agent().</Caption>
      <div style={{ position: 'absolute', top: 210, left: 0, right: 0, display: 'flex', justifyContent: 'center', ...rise(f, 4) }}>
        <Window title="Workflow script" width={1040} style={{ transform: `translateX(${shake}px)` }}>
          <div style={{ position: 'relative' }}>
            {f >= 12 && f < 38 ? (
              <div style={{ position: 'absolute', left: -26, right: -26, top: Math.min(scan, CODE.length - 1) * 32.55, height: 32.55, background: 'rgba(161,161,170,0.12)', borderLeft: `3px solid ${C.muted}` }} />
            ) : null}
            {CODE.map(([line, tag], i) => {
              const lead = line.match(/^ */)[0]
              const on = flagged && tag
              return (
                <div key={i} style={{ position: 'relative', whiteSpace: 'pre', color: on ? C.opus : C.text }}>
                  {lead}<span style={{ textDecoration: on ? `underline wavy ${C.opus}` : 'none', textUnderlineOffset: 6 }}>{line.slice(lead.length)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.border}`, opacity: denyIn, transform: `translateY(${(1 - denyIn) * 10}px)`, fontSize: 21 }}>
            <div style={{ color: C.opus, fontWeight: 700 }}>✗ ultraguard blocked this Workflow launch (2 problems)</div>
            <div style={{ marginTop: 6 }}><span style={{ color: C.muted }}>ten-opus.js:3 </span><span style={{ color: C.opus }}>LABEL+FANOUT</span> <span style={{ color: C.muted }}>[synth: research]</span></div>
            <div><span style={{ color: C.muted }}>reads like investigation ("research") →</span> investigate: on sonnet</div>
            <div><span style={{ color: C.muted }}>up to 10 opus agents can run at once here;</span> the limit is 3</div>
          </div>
        </Window>
      </div>
    </AbsoluteFill>
  )
}

// ── 4. Relaunch: each agent on its tier ─────────────────────────────────────
const TIERS = [
  { name: 'opus ≤ 3', color: C.opus, classes: 'decide · judge · synth · design' },
  { name: 'sonnet', color: C.sonnet, classes: 'investigate · build · fix · combine' },
  { name: 'haiku', color: C.haiku, classes: 'code · grunt' },
]
const TIER_Y = (r) => 262 + r * 112

const Fix = () => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fade = useSceneFade(T.fix[1] - T.fix[0], 6, 8)
  const badge = interpolate(f, [40, 50], [0, 1], clamp)
  // The 10 research agents move to Sonnet as investigate:, rightmost first so paths do not cross.
  const dots = Array.from({ length: 10 }, (_, k) => {
    const p = spring({ frame: f - 6 - (9 - k) * 1.5, fps, config: { damping: 16, stiffness: 90 } })
    const mix = (a, b) => a + (b - a) * p
    const col = interpolateColors(p, [0.3, 0.7], [C.opus, C.sonnet])
    return (
      <Dot key={k} x={mix(ROW_X(k, 10), 634 + k * 52)} y={mix(350, TIER_Y(1))} color={col}
        scale={1 - 0.2 * Math.min(p, 1)} label="opus" labelOpacity={interpolate(p, [0, 0.25], [1, 0], clamp)} />
    )
  })
  // One new synth: stage on Opus merges their findings.
  const synth = spring({ frame: f - 30, fps, config: { damping: 12, stiffness: 160 } })
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Caption f={f} sub="Research runs as investigate: on Sonnet. One synth: on Opus merges it.">Claude fixes it. Each agent on its tier.</Caption>
      {TIERS.map((tier, r) => (
        <div key={tier.name} style={{ position: 'absolute', top: TIER_Y(r) - 26, left: 170, width: 420, opacity: interpolate(f, [8 + r * 4, 18 + r * 4], [0, 1], clamp) }}>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 700, color: tier.color, textAlign: 'right' }}>{tier.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 19, color: C.muted, textAlign: 'right', marginTop: 2 }}>{tier.classes}</div>
        </div>
      ))}
      {dots}
      <Dot x={634} y={TIER_Y(0)} color={C.opus} scale={0.8 * synth} />
      <div style={{ position: 'absolute', top: TIER_Y(2) - 12, left: 618, fontFamily: MONO, fontSize: 19, color: C.dim, opacity: interpolate(f, [16, 26], [0, 1], clamp) }}>none needed here</div>
      <div style={{ position: 'absolute', top: 600, left: 0, right: 0, textAlign: 'center', opacity: badge }}>
        <span style={{ fontFamily: MONO, fontSize: 26, color: C.green, border: `2px solid ${C.green}`, borderRadius: 10, padding: '8px 18px' }}>✓ passes the gate silently · workflow launches</span>
      </div>
    </AbsoluteFill>
  )
}

// ── 5. ultraguard-eval + install ────────────────────────────────────────────
const Outro = () => {
  const f = useCurrentFrame()
  const fade = useSceneFade(T.outro[1] - T.outro[0], 6, 1)
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Caption f={f} sub="ultraguard-eval checks the run matches what the gate approved.">During the run, you see it held.</Caption>
      <div style={{ position: 'absolute', top: 220, left: 0, right: 0, display: 'flex', justifyContent: 'center', ...rise(f, 2) }}>
        <Window title="claude · ultracode" width={760}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ color: C.green, fontSize: 24 }}>□</span>
            <span style={{ fontWeight: 700 }}>ultraguard-eval</span>
            <span style={{ color: '#999999' }}>1 running</span>
          </div>
          <div style={{ borderTop: '1.5px solid #888888', marginTop: 10, paddingTop: 10, color: C.muted }}>&gt; <span style={{ opacity: Math.floor(f / 8) % 2 ? 1 : 0 }}>▌</span></div>
        </Window>
      </div>
      <div style={{ position: 'absolute', top: 450, left: 0, right: 0, textAlign: 'center', ...rise(f, 12) }}>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.text }}>/plugin marketplace add GonzMenSeb/ultraguard</div>
        <div style={{ fontFamily: MONO, fontSize: 26, color: C.text, marginTop: 8 }}>/plugin install ultraguard@ultraguard</div>
        <div style={{ fontFamily: SANS, fontSize: 22, color: C.muted, marginTop: 18 }}>Opus only where judgment pays, never more than 3 at once.</div>
      </div>
    </AbsoluteFill>
  )
}

export const Demo = () => (
  <AbsoluteFill style={{ background: C.bg, fontVariantLigatures: 'none' }}>
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 80% 30%, rgba(226,72,79,0.07), rgba(226,72,79,0) 55%)' }} />
    <Sequence from={T.title[0]} durationInFrames={T.title[1] - T.title[0]}><Title /></Sequence>
    <Sequence from={T.problem[0]} durationInFrames={T.problem[1] - T.problem[0]}><Problem /></Sequence>
    <Sequence from={T.gate[0]} durationInFrames={T.gate[1] - T.gate[0]}><Gate /></Sequence>
    <Sequence from={T.fix[0]} durationInFrames={T.fix[1] - T.fix[0]}><Fix /></Sequence>
    <Sequence from={T.outro[0]} durationInFrames={T.outro[1] - T.outro[0]}><Outro /></Sequence>
  </AbsoluteFill>
)
