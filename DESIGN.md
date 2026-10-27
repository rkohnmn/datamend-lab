---
color.primary: "#0F6E56"
color.secondary: "#D9381E"
color.surface: "#FFFFFF"
color.background: "#F6F4EE"
color.text: "#141619"
color.textMuted: "#525866"
color.border: "#D8D4C8"
color.error: "#C92A2A"
color.warning: "#B45309"
color.success: "#0F6E56"
color.accentHighlight: "#1D4ED8"
type.headline.fontFamily: "'Instrument Serif', 'Georgia', serif"
type.headline.fontSize: 28px
type.headline.fontWeight: 600
type.headline.lineHeight: 1.2
type.headline.letterSpacing: "-0.02em"
type.body.fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
type.body.fontSize: 15px
type.body.fontWeight: 400
type.body.lineHeight: 1.55
type.mono.fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
type.mono.fontSize: 13px
type.mono.fontWeight: 500
type.mono.lineHeight: 1.45
spacing.unit: 8px
spacing.xs: 4px
spacing.sm: 8px
spacing.md: 16px
spacing.lg: 24px
spacing.xl: 32px
radius.sm: 4px
radius.md: 6px
radius.lg: 10px
shadow.sm: "0 1px 2px rgba(20, 22, 25, 0.06)"
shadow.md: "0 4px 12px rgba(20, 22, 25, 0.08)"
---

## Overview

QuartetLab draws its visual identity from a 1970s Bell Labs statistical monograph paired with a Hewlett-Packard benchtop oscilloscope manual. The interface treats data synthesis and regression diagnostics as tactile laboratory instrumentation rather than decorative dashboard widgets. Warm archival paper stock (`{color.background}`) grounds the workspace, sharp India-ink rules (`{color.border}`) separate functional modules, phosphor-emerald traces (`{color.primary}`) plot ordinary least-squares fits, and vermilion diagnostic markers (`{color.secondary}`) flag high-leverage or high-Cook's-distance observations.

Every screen prioritizes immediate manipulation. A visitor lands directly on the synchronized dual-canvas workbench—bivariate scatter on the left, residual and normal quantile diagnostics on the right—backed by a live Gram-Schmidt exact-moment solver and a Minitab/R-standard regression output table.

## Colors

- **Background (`{color.background}`)**: Warm archival grid paper (`#F6F4EE` in light mode, `#0D1014` in dark instrument mode) reduces glare during extended classroom projection or problem-set authoring.
- **Surface (`{color.surface}`)**: Crisp card and canvas backing (`#FFFFFF` in light mode, `#151921` in dark mode) for plotting planes, computer regression output tables, and parameter controls.
- **Primary (`{color.primary}`)**: Phosphor emerald (`#0F6E56` in light mode, `#34D399` in dark mode) indicates the active OLS regression line, confidence bands, and primary action triggers.
- **Secondary (`{color.secondary}`)**: Vermilion (`#D9381E` in light mode, `#F87171` in dark mode) highlights residual vectors, Cook's distance halos ($D_i > 4/n$), and target-lock indicators.
- **Text (`{color.text}` & `{color.textMuted}`)**: Deep charcoal ink (`#141619`) for primary labels and equations, paired with slate (`#525866`) for secondary metadata. Both exceed WCAG AA contrast ratios (15.8:1 and 6.4:1 against `{color.surface}`).
- **Semantic States**: Error (`{color.error}`), Warning (`{color.warning}`), and Success (`{color.success}`) communicate matrix singularity warnings, high-leverage thresholds ($h_i > 4/n$), and exact-moment convergence.

## Typography

- **Headline (`{type.headline.fontFamily}`)**: Used for the workspace header, printable FRQ worksheet titles, and section headers. High-contrast serif letterforms evoke classic statistical textbooks (*The Practice of Statistics*, Tukey's *Exploratory Data Analysis*).
- **Body (`{type.body.fontFamily}`)**: Clean neo-grotesque sans-serif at 15px (`0.9375rem`) for UI controls, scenario descriptions, and diagnostic interpretations.
- **Monospace (`{type.mono.fontFamily}`)**: Strictly applied to all numeric inputs, summary moment badges ($\bar{x}, s_x, \bar{y}, s_y, r, R^2$), computer regression tables (`Coef`, `SE Coef`, `T`, `P`), TI-84 list outputs, and coordinate readouts using `font-variant-numeric: tabular-nums`.

## Layout

The layout scales from a base unit of `{spacing.unit}` (`8px`). On desktop viewports (`>= 1024px`), QuartetLab uses an asymmetric modular bento grid:
1. **Top Instrument Bar**: Preset selector, drawing/interaction mode toggle, Exact-Moment Solver bar, and theme/print actions.
2. **Primary Workbench (Left 7 Columns)**: High-DPI interactive scatter plot canvas above synchronized Residual ($e_i$ vs. $\hat{y}_i$) and Normal Q-Q diagnostic canvases.
3. **Diagnostic & Export Inspector (Right 5 Columns)**: Live Minitab/AP-style regression output table, Exact-Moment Target Sliders, Point-by-Point Diagnostic Data Grid ($x_i, y_i, \hat{y}_i, e_i, h_i, r_i, D_i$), and one-click exports (CSV, R, Python, TI-84, LaTeX, Printable FRQ Worksheet).

Breakpoints collapse the grid cleanly at `1024px` (stacked workbench and inspector) and `640px` (compact mobile controls with touch-friendly 44x44px hit targets and zero horizontal overflow down to `390px`).

## Elevation & Depth

QuartetLab relies on structural hairline borders (`1px solid {color.border}`) rather than heavy drop shadows.
- **Level 0 (Base)**: `{color.background}` page canvas.
- **Level 1 (Modules)**: `{color.surface}` cards with `{shadow.sm}` and `1px` structural borders.
- **Level 2 (Sticky Instrument Bar & Active Tooltips)**: `z-index: 20` with `{shadow.md}`.
- **Level 3 (Modals & Printable Worksheet Preview)**: `z-index: 50` with backdrop dim.

## Shapes

Corner radii follow a restrained technical scale: `{radius.sm}` (`4px`) for data badges, keyboard shortcut chips, and table cells; `{radius.md}` (`6px`) for buttons, inputs, and segmented controls; and `{radius.lg}` (`10px`) for outer module containers. Circular geometry (`9999px`) is reserved exclusively for data points and Cook's distance diagnostic halos on the plotting canvas.

## Components

### Buttons & Segmented Controls
- **Primary**: `{color.primary}` background, white text, `{radius.md}`. Hover darkens by 8%; active translates `1px` down; focus renders a `2px` offset ring (`{color.accentHighlight}`).
- **Secondary / Outline**: `{color.surface}` background, `1px solid {color.border}`, `{color.text}` label.
- **Segmented Mode Switcher**: Groups related canvas tools (Drag/Inspect, Brush Points, Erase Points, Lock Moments) inside a `{color.background}` track with a `{color.surface}` active pill.

### Plotting Canvases
- **Scatter Canvas**: Renders minor and major gridlines, mean crosshairs $(\bar{x}, \bar{y})$, OLS line, optional quadratic/exponential curve comparison, 95% confidence interval ribbon, and interactive points. Points exceeding Cook's distance $D_i > 4/n$ display a dashed vermilion halo.
- **Residual & Q-Q Canvases**: Synchronized horizontally with the scatter canvas; hovering or dragging a point in either canvas highlights the corresponding observation across all views and the data table.

### Regression & Data Tables
- **Computer Output Table**: Styled after standard Minitab and R outputs used on AP Statistics and undergraduate exams (`Predictor`, `Coef`, `SE Coef`, `T`, `P`, plus `S`, `R-Sq`, `R-Sq(adj)`).
- **Observation Grid**: Scrollable tabular-numeral grid with inline coordinate editing, point deletion, and diagnostic flags (`HIGH LEV`, `INFLUENTIAL`, `OUTLIER`).

## Do's and Don'ts

- **Do** use `font-variant-numeric: tabular-nums` on every live statistic and table cell so numbers never jitter when dragging points at 60fps.
- **Do** pair color-coded diagnostic warnings (vermilion for high Cook's distance, amber for high leverage) with explicit text badges and geometric markers (dashed rings, triangles) so meaning never depends on color alone.
- **Don't** push the interactive workbench below a marketing hero section; the application opens directly into the live dataset studio.
- **Don't** animate numeric readouts or canvas redraws during live pointer dragging; reserve `ease-out` transitions (`160ms`) for panel toggles, modal entrances, and preset morphs (disabled when `prefers-reduced-motion: reduce` is active).
