# fanzhu1998.github.io

Personal site for **Fan Zhu** — Associate Portfolio Manager at an asset management firm.

**Live:** https://fanzhu1998.github.io/

---

## Stack

No framework, no build step, no dependencies. Static HTML, CSS and vanilla JS,
served directly by GitHub Pages.

```
index.html               the whole site — one page, eight sections
assets/css/style.css     design tokens + all styles (light & dark)
assets/js/main.js        theme toggle, nav, scroll-spy, reveals, email assembly
assets/js/network.js     hero canvas — live minimum spanning tree
assets/js/viz-core.js    shared harness for canvas backgrounds (FZViz.mount)
assets/js/frontier.js    about canvas — live mean-variance efficient frontier
assets/js/sensitivity.js experience canvas — live delta-gamma sensitivity spider
assets/js/volsurface.js  live SSVI implied volatility surface — parked (commented out in index.html)
assets/js/finetree.js    research canvas — live fine tree classifier
assets/js/neural.js      toolkit canvas — a neural network, training
assets/favicon.svg       monogram + node-pair mark
.nojekyll                serve files as-is, skip Jekyll processing
```

Edit a file, commit, push. That is the entire deploy process.

## The hero animation

The background of the hero is not decoration. It is a live correlation network
over the 49 Fama–French industry portfolios, driven by a small simulated factor
model, and it behaves the way the thesis says a real one does.

**The model.** Each industry loads on three factors: a market factor with weight
`lambda`, a sector factor that takes whatever variance the market factor leaves,
and a slowly rotating style factor that keeps the structure evolving so the
network never settles. Sectors also carry fixed affinities to each other, and
every pair carries a fixed idiosyncratic term — so a sector is a cluster with
real internal structure, not a blob of interchangeable points.

**The regime.** `lambda` is driven by a two-state process that flips between calm
and stress. Stress arrives fast, leaves slowly, and does not last as long as calm
does. When it hits, every correlation rises at once: sector structure gets
crowded out, the web of strong pairs densifies, and the tree collapses toward a
single hub. Onnela et al. measured exactly that on real data — the spanning tree
shrinks in a crash.

**The geometry is the correlation matrix.** Correlations become distances the way
the thesis does it, `d = sqrt(2(1 - rho))`, and the layout is a stress
majorisation (SMACOF) embedding of those distances, taking a fraction of each
solver step per frame. So the network physically contracts when correlations rise
and sprawls back into sector clusters when they fall — the movement you see *is*
the regime shifting, not an animation played over it.

Drawn each frame:

- the **faint web** of the strongest pairwise correlations, thresholded by a
  histogram that holds the edge count near a target as correlations move;
- the **minimum spanning tree** over `d` (Prim's algorithm) as the bright
  backbone, brighter where the correlation is stronger;
- a **flash** on every edge the tree has just rewired — the topology visibly
  reorganising;
- **node radius** by MST degree, the centrality measure the thesis uses;
- a **halo** on the dominant hub that swells with `lambda`, and a **shockwave**
  on each regime shift.

Nodes reaching degree ≥ 5 get labelled. At n = 49 a frame costs roughly ten
thousand pair operations and about sixty canvas paths; the node count drops to 34
and 24 on narrower screens. The simulation runs in fixed 1/60 s steps on a real
clock, so a 120Hz screen paints more often without running it faster, and phones
and tablets paint at ~30fps taking two steps a frame. On narrow screens the copy
spans the full width, so the network moves into the clear band above it — see
*Band mode* under Canvas backgrounds. It pauses when scrolled out of view or
when the tab is hidden, and renders a single settled frame under
`prefers-reduced-motion` or data saver.

## The about-section background

The same idea as the hero, applied to the other half of the job: a live
mean-variance efficient frontier, drawn full bleed behind "Between the model and
the trade" the way the hero network is drawn behind the name. The canvas runs the
whole section underneath, a scrim in the stylesheet knocks it back where the copy
sits, and `.wrap` rides over both — the section is marked `.section--viz` and the
layering, the scrim and the fade into the cards come with it.

Eight assets carry returns from a two-factor covariance model,
`Sigma = gamma * L L' + diag(delta^2)`, which is positive definite by
construction — so the solve underneath it cannot blow up. Every frame it solves
`Sigma [a b] = [1 mu]` by Gauss-Jordan and reads the closed form off the
standard scalars:

```
A = 1'a,  B = 1'b,  C = mu'b,  D = AC - B^2
sigma^2(m) = (A m^2 - 2B m + C) / D
w(m)       = g + h m,   g = (C a - B b)/D,  h = (A b - B a)/D
```

So the curve is the exact minimum-variance hyperbola rather than a fitted one,
and `w(m)` gives the **real weight vector** behind any point on it — which is
what the scatter is built from. The weights are not drawn: moving along the
curve is re-weighting the book, but a bar stack in the corner said that at the
cost of the chart being minimal, and the chart is better off minimal.

- The **upper branch is bright** because it is the part that is actually
  efficient. The lower branch is dim because it is not.
- The **scatter** is a fixed set of portfolios, each one a frontier portfolio at
  some target return pushed off the curve by a fixed deviation. The deviation is
  de-meaned, so weights still sum to one exactly, and a zero deviation lands on
  the curve — which makes the frontier the scatter's true left boundary rather
  than a line drawn near it. Sampling around equal weight instead never reaches
  the low-return end and leaves the bullet with no nose.
- The **tangency portfolio** is solved for against a drifting risk-free rate —
  pinned below the minimum-variance return, so it always lands on the efficient
  branch — and marked on the curve. The capital market line through it is
  deliberately *not* drawn: a straight line cutting across the picture fights
  the curve rather than supporting it.
- Loadings, idiosyncratic variances, expected returns and the systemic weight
  `gamma` all drift on slow incommensurate sines. As `gamma` rises the bullet
  narrows and the frontier flattens — diversification stops paying, the same way
  the hero network contracts toward one hub when correlations rise.

The plot box runs past both the top and the right of the canvas, so the cloud
bleeds off those edges instead of ending on hard cuts, and so the curve has room
to spread horizontally — which is what makes its bend legible rather than leaving
it a near-vertical climb. The travelling dot's sweep is capped at what is
actually on screen, or it would spend part of every cycle out of sight.

How much of each branch is shown decides what the silhouette reads as. The
minimum-variance point is a *vertical tangent*, so showing the inefficient branch
symmetrically turns the nose into a rounded protrusion; keeping it to a sliver
(`mMv - 0.06 rng` against `mMv + 1.36 rng` above) leaves a frontier that rises
out of the bottom left instead, which is both the more elegant shape and the one
people actually draw. The upper bound is extended to compensate, so trimming the
band does not stretch the curve vertically and steepen it.

Below 1024px it is a figure above the section head rather than a backdrop beside
it — see *Band mode* under Canvas backgrounds.

**Cost.** The scatter is the only expensive part — a thousand-odd portfolios,
each a K² quadratic form and a fill. It is rendered into an offscreen layer a few
times a second rather than every frame, and blitted with an affine correction
that maps the window it was drawn in onto the window showing now, so the cloud
stays registered to the curve however the view drifts. Everything that has to be
smooth — the curve, the dot and the comet — is a few dozen operations and runs
every frame. Density follows the area on show, so a wide screen does not
get a sparse dusting and a small one does not pay for points nobody sees.

One trap worth naming, because it cost a round: the view window has a *target*
and an *eased current value*, and they are deliberately separate. The target is
only recomputed when the scatter is, a few times a second; the easing has to run
every single frame. Easing inside the scatter refresh instead makes the whole
frame — and with it the nose of the curve, its sharpest feature — step about
eight times a second rather than move, which reads as a wobble.

## The experience-section background

The shape of the daily Rates/FX sensitivity run, behind "From risk analytics to
portfolio construction". Four legs, every one pinned through the origin — a
sensitivity ladder is a *change* in PnL against a *shock*, so at zero shock
nothing has moved and every factor crosses there. That pinch with the curves
fanning out either side is what makes it a spider.

```
PnL_f(s) = delta_f . s  +  1/2 gamma_f . s^2  +  1/6 speed_f . s^3
```

The first two terms are the delta-gamma approximation the risk engine reports.
The cubic is a deliberate third-order addition: a pure quadratic is perfectly
symmetric about its vertex and real revaluation ladders never are, because gamma
itself moves as the shock gets larger.

Each leg is a **deliberate archetype rather than a random draw** — four curves
that each say something beat a dozen that blur together:

| leg | coefficients | shape | book |
| --- | --- | --- | --- |
| `STRADDLE` | `δ≈0, γ≫0` | U | well hedged, long convexity |
| `CUBIC` | `δ≈0, γ≈0, speed` dominant | `s³` — flat middle, opposite wings | convexity that changes sign across the range |
| `STRUCTURED` | base + 3 smoothed digitals | plateaus and changes of curvature | optionality with strikes across the range |

Each leg carries its own step of the accent ramp, which happens to have exactly
three of them — so the legs are told apart by shade rather than by a legend, and
the ramp reads as an ordered ramp in both themes (light-to-dim in the dark one,
dark-to-light in the light one). The alphas lift the dimmer end so all three
carry equally.

`STRUCTURED` is the complicated one, and it is the only leg that needs more than
a polynomial: three `tanh` terms at drifting strikes, re-based so the leg still
passes through the origin. Nothing lower order reproduces a real ladder with
strikes scattered across it.

A **hedge dial** drifts from well hedged toward directional and back. It moves
`STRUCTURED`'s directional component, which is the honest place for it — hedging
changes directional exposure, not the convexity you were sold. A marker sweeps
the shock axis, drops a dot where it cuts each leg, and haloes whichever one is
moving most at that shock.

One bit of geometry is load-bearing: the wing extremes are where the convexity
actually shows, so the box is sized to keep them on screen rather than letting
them run off the canvas and leaving only the flat middle in view.

Four polynomials over sixty samples plus a handful of `tanh` calls is a few
thousand flops a frame, so unlike the frontier's scatter there is nothing here
worth caching.

## The volatility surface (parked)

**Not on the page at the moment.** Its canvas and script are commented out in
`index.html` — kept, not deleted, against a project that earns it — and the
neural network below has its place in the toolkit section. Bringing it back is
uncommenting both lines and moving the network to an inner chart (see the
harness notes), since a section carries one chart.

A live implied volatility surface — the pricing dictionary. Every option is
looked up against it, so its shape carries the two things the market is actually
quoting: a skew across strike and a term structure across expiry.

Built with **SSVI**, the surface form of Gatheral's stochastic-volatility-
inspired parameterisation, rather than an arbitrary curved mesh — it is what a
surface is genuinely fitted with, and it stays roughly arbitrage-sane by
construction:

```
w(k, θ) = θ/2 · ( 1 + ρ·φ·k + sqrt((φ·k + ρ)² + 1 − ρ²) )
φ(θ)    = η / θ^γ
σ(k, T) = sqrt( w / T )
```

At `k = 0` the bracket collapses to 2 and `w = θ` exactly, so the ATM line of the
surface *is* the term structure by construction rather than by accident.

| parameter | what it does |
| --- | --- |
| `θ(T)` | ATM term structure — contango when calm, inverted when the front end gets bid |
| `ρ` | the skew; negative for equity, steepens under stress, and the reason the surface leans rather than sitting symmetric |
| `η`, `γ` | how fast the skew flattens with expiry; `γ ≈ 0.44` reproduces the usual `1/√T` decay |

A stress dial drifts between those regimes. Maturities are spaced
**geometrically**, because the curvature lives at the short end and a linear grid
spends its resolution at the back where the surface is flat.

**The strike range is the whole picture.** A real surface is quoted across
moneyness of roughly 0.5 to 3 — log-moneyness of about −1.1 to +0.5 — and that
width is where the skew ridge lives. Plot a narrow ±20% band instead and SSVI is
very nearly linear across it: the result is a tilted plane, which is what a
surface emphatically is not. The wing is the point.

Two pieces of projection geometry are load-bearing, and both were got wrong
first time:

- **The tall corner belongs at the back.** The put wing at the short end is the
  high one, so it is mapped to the far corner and rises into empty space above
  the sheet. Put it near the viewer and a wireframe of a surface this tall folds
  through itself into a tangle.
- **Proportions are a balance, not a maximisation.** Too little vertical and it
  reads as a tilted plane; too little footprint and the mesh self-intersects,
  because a tall surface in axonometric needs depth separation to stay legible.
- **Do not spend the whole clear band on width.** A surface stretched to fill
  the space reads as flat however curved it is — the eye takes a wide, shallow
  footprint as a plane seen edge-on. The box takes a little over half the band
  and its height comes from the vertical room above the toolkit grid rather than
  from its own width, so narrowing it does not flatten it as well. The unspent
  width also carries the chart back toward the middle of the page. The footprint
  depth is tied to the footprint *width*, not the box, so the base stays a proper
  isometric diamond at any box shape and only the vertical axis takes the extra.

**SSVI alone is not enough to look real.** It is monotone in strike, so a fitted
base gives one tall wing and leaves the rest of the sheet very nearly a plane.
Real surfaces are not that clean: event vol at a particular expiry,
structured-product flow parked at a particular strike, and the rest of the
supply-and-demand mess show up as localised humps and dips riding on the fit —
and they move. Four Gaussians in (strike, log-expiry) approximate that, with
centres and amplitudes drifting and the amplitude crossing zero so they surface
and subside rather than sliding about. They are a demo device, not a fit, and the
clamp on the sum is there so a rare coincidence of all four cannot spike the
sheet and squash everything else through the range normalisation.

Two parameter choices are held off their extremes deliberately. Drive `ρ` hard
negative and the call wing goes dead flat, which is most of the sheet; keeping it
moderate and lifting `η` instead makes every slice a skewed smile with *both*
wings rising, which is relief across the whole surface rather than one tall
corner and a plane behind it.

The animation is the surface itself — the base parameters and the bumps drifting
on incommensurate sines, so the skew leans and relaxes, the ridge builds and
decays, and the humps roll across. Nothing sweeps over it; the shape is the
motion. Note that the vertical range auto-scales, so a change in the *level* of
vol is invisible by construction — only changes in *shape* read, which is why
the shape parameters carry the animation.

**One hump, and it stays where it is.** This is the difference between a surface
and a flag. Letting a centre drift makes the relief *travel* across the sheet, so
every part of it is always moving and the whole thing rolls and waves. Pinned and
pulsed instead, the hump swells and subsides over its own patch while the rest of
the sheet holds still — which is how a surface actually behaves: a name gets bid
for a fortnight around one expiry and the rest of the book does not move with it.

Three details keep it reading as vol rather than as an artefact:

- **Wide.** A narrow Gaussian on a smooth sheet is a spike poking through a
  tarpaulin. Spread over most of the strike axis it becomes a swell the surface
  carries, which is both more elegant and closer to what a bid for a region of
  the book actually does to the quotes.
- **A raised cosine with a floor under it**, not a plain sine. The hump breathes
  between a third of its height and full, rather than swinging through zero into
  a pit and back — so it is always present and the surface never flattens off to
  bare SSVI at the bottom of a cycle. A full breath takes about six seconds;
  slower than that and nobody waits long enough to notice the surface is alive.
- **A display curve on the vertical** (`z^0.65`). A real surface has a huge
  dynamic range — the short-dated wing can be five times the long-dated ATM — and
  mapping that linearly spends the whole axis on one corner and presses the rest
  flat against the floor. The exponent lifts the body of the sheet without
  flattening the wall.

Three axes are drawn off the near-left corner — implied vol rising, strike and
expiry running away along the base. That corner is the call wing at the short
end, which is the *low* corner of the surface, so the axes sit in clear space
instead of being buried under the skew wall. Same stroke as the floor so the
frame reads as one object; no ticks and no labels, because the shape is the
point and the numbers are not.

Because the centre is fixed, the Gaussian shape factors are **constants** —
computed once at seed and never again. The hump costs one cosine a frame rather
than `NT + NK` exponentials, so pinning it turned out to be cheaper as well as
better-looking.

Drawn as a wireframe in axonometric projection rather than a filled mesh: it
matches the line language of the other three backgrounds, costs ~30 strokes
instead of a few hundred fills, and depth reads fine from grading the lines by
distance with the boundary picked out. ~360 grid points and one `pow` per expiry
— a few thousand flops a frame, nothing worth caching.

## The research-section background

The classifier that won the thesis, alive behind "Market structure, and what
actually predicts": a fine tree. Of the bank of classifiers run over the
correlation-network features, the one that reached 91.7% was a CART decision
tree allowed up to a hundred splits — which grows deep and lopsided, pure
branches stopping early and mixed ones splitting on until they run out of
samples. That is what is drawn: not a diagram of a tree but a tree grown the way
CART grows one, on fake data shaped like the real features.

**The growth is CART's.** Every split takes a feature from the thesis's own set
— Kruskal stress, density, maximum and mean degree, in-component degree, and
the moments of S&P 500 returns — and a threshold in its range, sends a share of
the node's observations left, and pushes the two children's bull fractions apart
while preserving their weighted mean, which is what a real split does to class
purity. Growth is best-first: the largest, most mixed node splits next, so the
tree is unbalanced the way a fitted one is. A branch stops when it is pure, when
it is down to the minimum leaf size, or at depth seven — the "certain degree" a
fine tree is held to — and the whole tree stops at a leaf budget that follows
the width on show.

Three things move:

- **It grows**, root first, each split branching out of its parent a beat after
  the level above, so entering the section you watch it branch and branch.
- **Observations arrive** at the root every couple of seconds and are routed
  down — left or right at each split, in proportion to the split — lighting
  the path as they go, to a leaf that flashes the regime it predicts. That is
  the whole of what a decision tree does at prediction time, and it is what
  makes the picture read as a classifier rather than a dendrogram.
- **The window rolls.** Every ten seconds or so a subtree is pruned back to its
  parent, the branches withdrawing deepest-first, and regrown from the same node
  as a different fit. The layout eases to the new leaf count rather than
  snapping, so the rest of the tree makes room the way branches do.

Edges are graded by depth and weighted by sample count, so the trunk carries
the tree and the fine structure fades toward the leaves. Bull leaves are filled,
bear leaves are rings — the two classes told apart by form, since the palette is
one hue. One label, and only for a moment: the regime a leaf has just called.
Nothing else needs naming — the split rules stay in the model.

Unlike the frontier and the surface, a tree is a bounded object — its leaves
are its edge — so the box stays inside the canvas rather than bleeding off it.
The section runs long past the paper card, and the card is opaque, so the tree
has a shallow band (`--viz-fade-a: 11.5%; --viz-fade-b: 15%`) and must be gone
before the card starts.

A hundred-odd nodes: one cubic per edge, one dot per node, a few thousand flops
a frame. Nothing worth caching.

## The toolkit-section background

Beside "What I reach for.", in the place the volatility surface held: a neural
network, training. A small multilayer perceptron — seven features in,
three hidden layers of 10, 8 and 5, two regimes out — and it is genuinely
trained, on fake data shaped like the regime problem: online gradient descent,
one sample at a time, cross-entropy on a softmax. Nothing about it is a
recording.

What is drawn is the two passes that make up one step:

- **Forward.** A sample's activations travel left to right along the weights.
  Every connection carries a pulse as bright as the signal on it — the product
  of the activation and the weight, graded against the strongest signal of that
  layer — so the pass reads as a wave over the strong paths rather than a flash
  of everything. Each layer's units fill with their activation as the wave
  reaches them, and the output layer calls the regime.
- **Backward.** The error travels right to left the same way, in the cooler
  tone, each pulse as bright as the gradient on its connection; units flare as
  the error lands on them. Then the weights move. The resting web is drawn by
  sign and strength — two tones, four weights of line — so the change is
  visible: connections thicken, thin and change sign as the network learns.
- **The regime shifts.** Every 40–70 samples the data-generating direction
  changes. What the network knew stops being true, the loss readout jumps, and
  it learns again — so it never settles into a finished picture.

Four quiet steps are taken for every animated one, so the loss moves at a
watchable speed rather than a real one. No labels: the passes are the point,
and the output unit that fills is the call.

It is the section's chart in the ordinary way — first child of the section,
placed against the section's first head. It began life as an **inner chart**
beside the education head (see the harness notes below), and that form still
works if the surface ever comes back and the two have to share the section.

Cost: 200 weights. A forward and backward pass is a few hundred multiplies; the
resting web is eight strokes a frame, and a pass in flight adds three.

## Canvas backgrounds

`assets/js/viz-core.js` is the harness both backgrounds' successors should use.
A visualisation only ever has to answer "draw one frame, at this size, in this
palette, at time t"; everything around that is identical every time, so it lives
in one place: device-pixel-ratio sizing, reading theme tokens out of CSS and
re-reading them on the theme toggle, running rAF only while the canvas is on
screen and the tab is visible, honouring `prefers-reduced-motion` (and data
saver, which gets the same single settled frame), debounced resize, a
real-elapsed-time clock so a 120Hz display does not run the animation at double
speed, and a ~30fps paint cap on coarse-pointer devices — phones and tablets —
which on that clock halves the battery cost without changing the speed.

```js
FZViz.mount("frontier", {
  seed:  function (env) { /* first mount and every resize */ },
  frame: function (env) { /* draw exactly one frame */ }
});
```

`env` carries `ctx`, `W`, `H`, `dpr`, `t` in seconds, `frame`, `reduced`,
`light` (which way round the theme is, since a dark accent on a light ground
needs more alpha to read the same), `mode` (`"backdrop"` or `"band"` — see
below), `keepOut` (the copy's box, below), a `palette` of `"r,g,b"` triplets
keyed by token name, an `rgba(token, alpha)` helper, and a `state` object the
spec owns. The canvas is cleared before every frame, so a spec only ever draws.

Adding another background is: mark the section `.section--viz`, drop one
`<canvas class="section__viz" id="…">` in it, and write one file with
`seed`/`frame` whose box function starts with the one line that handles narrow
screens (below). Nothing in the harness needs to change — the frontier, the
sensitivity spider, the vol surface and the fine tree share it unmodified.

**Keeping a background off the copy.** Washing the chart out with a scrim and
hoping was not good enough — curves still crossed the type and it was tiring to
read. The harness instead measures the section's `.section__head` and hands each
spec the box in `env.keepOut`; the spec calls `FZViz.softErase(ctx, rect, pad,
feather)` at the end of its draw and the chart simply is not there. Exact, no
haze over the type, and it follows the text however it reflows.

Two details make it work. The measurement walks the `offsetParent` chain rather
than using `getBoundingClientRect`, because the section head carries `.reveal`
and holds a `translateY` until it animates in — a rect taken before that would be
off by the transform. And the erase is composed from a solid core plus four edge
and four corner gradients, laid out not to overlap, because `destination-out`
compounds and overlapping fills would cut a visible seam along the edges.

Both charts also take their horizontal position *from* that measured box rather
than from a fraction, so the parts worth seeing stay clear of the copy at any
width instead of only at the one they were eyeballed on.

Because the charts can only start where the text stops, the copy's measure is
the one lever that moves them back toward the middle of the page — so a section
carrying a chart shortens it:

```css
.section--viz .section__head:first-of-type { max-width: 64ch; }
```

`:first-of-type` matters: the toolkit section holds three heads, and only the
first one shares its band with the section's chart.

**Inner charts.** A chart for a head that is *not* its section's first cannot be
the section's canvas — the section already has one, with a fade tuned for it.
It is an inner chart instead: the canvas sits in the markup right before its
head, inside `.wrap`, marked `.section__viz--inner`, and names that head through
`spec.keepOut` (`"#neural + .section__head"` — the head right after it). No
chart uses it at the moment; the network did while the surface held the
toolkit section, and the machinery stays for the next time two charts share
a section.

```html
<canvas class="section__viz section__viz--inner" id="neural" aria-hidden="true"></canvas>
<div class="section__head reveal">…</div>
```

The stylesheet does the rest. Absolutely positioned with `top` at `auto`, the
canvas takes its *static position* — exactly where the flow would have put it,
just below the block before it — and runs a fixed depth (30rem) from there,
full bleed via `left: calc(50% - 50vw)`. Inside `.wrap`'s stacking context,
`z-index: -1` puts it behind the copy and above the section fade; so it gets no
fade of its own and must be a bounded chart that ends before whatever follows
its head. The harness measures the keep-out relative to the canvas rather than
its parent (a zero correction for a section's canvas, which starts at the
section's origin), and the head after an inner chart takes the same 64ch
measure a section's first head does. In band mode the same in-flow rule applies
as to any other canvas, which places it between the block before and its head.

A 30rem canvas is also a fraction of the pixels of a section-sized one, which
is worth having on a section as long as the toolkit.

That is better typography on its own (72ch is at the top of the comfortable
range), and it bought the charts about 110px each, which is the difference
between sitting in the right margin and sitting in the page.

One trap that comes with it: `ch` depends on the loaded font, so the text box
moves when the web font swaps in — and the charts are positioned against a
measurement of that box. The harness therefore re-measures on `document.fonts
.ready`, or the keep-out can be left describing the fallback font's layout
rather than the real one.

What is left of the scrim is the fade into whatever follows the head, driven by
custom properties so a section can tune it without touching the shared rule:

| property | default | purpose |
| --- | --- | --- |
| `--viz-ink` | `var(--page)` | fade colour; `.section--alt` swaps it to `var(--surface)` |
| `--viz-fade-a` / `--viz-fade-b` | `46%` / `62%` | where the chart starts and finishes dissolving |

About fades late, because its cards are opaque and cover whatever is left.
Experience fades early, because its timeline sits straight on the page and the
chart has to be gone before it starts.

### Band mode — phones and tablets

Below 1024px the copy fills most of the width and there is no clear band beside
it for a chart that must stay off the text. Rather than hide the canvas, the
stylesheet turns it into a **figure**: out of the backdrop position and laid in
flow above the section head at a fixed proportion (`aspect-ratio: 16 / 9`; the
surface and the tree get `4 / 3` because they are drawn tall on purpose), with the fade
switched off because there is nothing under it to dissolve into. The canvas is
already the first child of its section, so no markup moves.

The decision is published to the script rather than duplicated in it:

```css
.section__viz { --viz-mode: backdrop; }
@media (max-width: 1024px) { .section__viz { --viz-mode: band; … } }
```

The harness reads that property off the canvas on every resize and exposes it
as `env.mode`, so the breakpoint lives in the stylesheet and nowhere else, and
rotating a tablet across it flips the mode correctly. In band mode `env.keepOut`
is `null` — a figure sits above the copy, not beside it, and the measurement
would in any case be off by the section's top padding, since an in-flow canvas
no longer shares the section's origin. `softErase` on `null` is a no-op, so a
spec's draw code does not change.

What a spec does with it is one line at the top of its box function:

```js
if (env.mode === "band") return window.FZViz.bandRect(env, 1.5);
```

`bandRect(env, aspect)` is the whole canvas, inset so nothing ends on the canvas
edge, held to the chart's own proportion and centred — a band is wide and short
and most charts are not. The frontier asks for 1.5 (wider and the bullet turns
into a streak), the spider 1.7, the surface 1.0 (its footprint depth is tied to
its width, so a wider box runs the near corner off the bottom), the tree 1.45,
the network 1.6. Everything else
in the spec — the model, the draw, the erase — is untouched, and the desktop
path is not entered at all.

The hero does the same thing without the harness: `#network` carries the same
`--viz-mode`, and in band mode `network.js` moves the network into the clear
band between the nav and the copy — measured against `.hero__inner`, since how
much room that is depends on the height of the phone, and re-measured when the
web font settles — while the wide ellipse in `.hero::after` gives way to a soft
edge drawn on the copy's own box (`.hero__inner::before`), so it follows the
text rather than a guess at where the text is. On a short phone the band is
small and so is the network; bottom-aligning the hero copy on narrow screens
would buy it more room, and is the lever to reach for if that matters.

`network.js` predates the harness and still carries its own copy of the
lifecycle. It now shares the mode contract, the coarse-pointer paint cap and a
fixed-step clock (1/60 s steps on real time, so a 120Hz screen no longer runs it
at double speed), but it could still be moved onto `FZViz` with no visual change
whenever it is next touched.

## Colour

Deep navy with a steel-blue accent — restrained, and legible in both themes.

Every ink, accent and ramp step was contrast-checked against the surface it
actually renders on, in both themes. All text pairs clear WCAG AA (≥ 4.5:1); the
sequential ramp used by the heatmap and confusion matrix switches its label ink
after step 4, where the crossover measured out.

Sequential encoding is one blue hue, low → high. The charts carry a legend, per-cell
hover titles, and a `<details>` data table so nothing depends on colour alone.

## Type

All-sans, in the register of institutional finance rather than editorial design.

- **Libre Franklin** (Franklin Gothic lineage) for headings, the hero masthead and
  stat figures — Light 300 and SemiBold 600 carry the hierarchy.
- **Inter** for body copy, at 16px / 1.65 for long-form legibility.
- **IBM Plex Mono** for the small uppercase labels: eyebrows, tags, chart axes.

Figures are set with `font-variant-numeric: tabular-nums` so columns align.

## Theme

Dark-first. An explicit OS *light* preference flips it; the toggle overrides both
and persists to `localStorage`. Theme is applied by an inline `<head>` script
before first paint, so there is no flash.

## Local preview

Any static server works:

```bash
python -m http.server 8000    # then open http://localhost:8000
npx serve .
```

Opening `index.html` directly also works — nothing here needs a server.

## Editing content

All copy lives in `index.html`, in labelled sections (`<!-- ===== RESEARCH ===== -->`
and so on). The chart values are plain HTML — each heatmap cell carries its own
ramp step in a `style` attribute, and the same numbers repeat in the `<details>`
table beneath it. **If you change a number, change it in both places.**

## Adding new research

The research section is built to grow. Every item other than the featured thesis
is one `<article class="entry">` block inside `<div class="entries">`, and a
copy-paste template sits in an HTML comment directly above that list.

1. Copy an existing `.entry` block and paste it at the top of `<div class="entries">`.
2. Edit the meta line, title, description, link and tags. Delete any line the entry
   does not need — only `.entry__meta` and `.entry__title` are required.
3. Commit and push.

Nothing else needs touching. Section numbers are generated by CSS counters, the
reveal animation attaches to anything carrying `class="reveal"`, and the scroll-spy
reads whatever is in the nav. No CSS changes, no JS changes, no build step.

A piece that earns the full treatment — figures, method steps, a data table — is
built as `<article class="paper">` instead, using the thesis as the model.

### Adding a whole new section

Copy any `<section class="section" id="...">`, give it a fresh `id`, add a matching
`<li><a href="#id">…</a></li>` to the nav, and mark its eyebrow `data-auto`. Every
section number after it renumbers itself.

### Numbering

Section eyebrows (`01 — About`) and card labels (`/ 01`) are **generated**, never
typed. An eyebrow or card label opts in with `data-auto` and leaves its own text
empty; one that carries real text (`Method`, `/ MAY 2022`) simply omits the
attribute and is skipped by the counter.

## Licence

Code under the repository's MIT licence. Written content and CV material © Fan Zhu.
