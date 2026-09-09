# fanzhu1998.github.io

Personal site for **Fan Zhu** — Associate Portfolio Manager at Parametric Portfolio
Associates (Morgan Stanley Investment Management).

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
and 24 on narrower screens. It pauses when scrolled out of view or when the tab is
hidden, and renders a single settled frame under `prefers-reduced-motion`.

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
